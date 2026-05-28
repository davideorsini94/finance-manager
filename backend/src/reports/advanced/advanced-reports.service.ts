import { Injectable } from '@nestjs/common';
import { Prisma, RecurrenceFreq, TransactionType } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';

/** Frammento SQL `AND t.account_id IN (...)` o stringa vuota se il filtro è assente. */
function accountIdFilterSql(accountIds?: string[]) {
  if (!accountIds || accountIds.length === 0) return Prisma.empty;
  return Prisma.sql`AND t.account_id IN (${Prisma.join(accountIds.map((id) => Prisma.sql`${id}::uuid`))})`;
}

export interface CashflowPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
  isForecast: boolean;
}

export interface CashflowResult {
  history: CashflowPoint[];
  forecast: CashflowPoint[];
  cumulativeBalance: { month: string; balance: number; isForecast: boolean }[];
}

@Injectable()
export class AdvancedReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async cashflow(
    userId: string,
    months: number,
    forecastMonths: number,
    accountIds?: string[],
  ): Promise<CashflowResult> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startHistory = monthStart(addMonths(today, -months + 1));
    const accountFilter = accountIdFilterSql(accountIds);

    const txs = await this.prisma.$queryRaw<Array<{ ym: string; type: string; total: bigint }>>`
      SELECT to_char(t.transaction_date, 'YYYY-MM') AS ym,
             t.type::text AS type,
             SUM(ABS(t.amount_cents))::bigint AS total
      FROM transactions t
      WHERE t.user_id = ${userId}::uuid
        AND t.transaction_date >= ${startHistory}
        AND t.type != 'transfer'
        ${accountFilter}
      GROUP BY 1, 2
      ORDER BY 1
    `;

    const historyMap = new Map<string, CashflowPoint>();
    for (let i = 0; i < months; i++) {
      const m = ymKey(addMonths(startHistory, i));
      historyMap.set(m, { month: m, income: 0, expense: 0, net: 0, isForecast: false });
    }
    for (const r of txs) {
      const point = historyMap.get(r.ym);
      if (!point) continue;
      const eur = Number(r.total) / 100;
      if (r.type === 'income') point.income += eur;
      else point.expense += eur;
      point.net = point.income - point.expense;
    }

    const forecast: CashflowPoint[] = [];
    if (forecastMonths > 0) {
      const rules = await this.prisma.recurringRule.findMany({
        where: {
          userId,
          isActive: true,
          ...(accountIds && accountIds.length > 0 ? { accountId: { in: accountIds } } : {}),
        },
        select: {
          amountCents: true,
          type: true,
          frequency: true,
          nextRunDate: true,
          endDate: true,
        },
      });
      for (let i = 1; i <= forecastMonths; i++) {
        const m = monthStart(addMonths(today, i));
        const next = monthStart(addMonths(today, i + 1));
        let income = 0,
          expense = 0;
        for (const r of rules) {
          if (r.endDate && r.endDate < m) continue;
          const occurrences = countOccurrencesInRange(r.nextRunDate, r.frequency, m, next);
          const amount = (Number(r.amountCents) * occurrences) / 100;
          if (r.type === TransactionType.income) income += amount;
          else if (r.type === TransactionType.expense) expense += amount;
        }
        forecast.push({
          month: ymKey(m),
          income,
          expense,
          net: income - expense,
          isForecast: true,
        });
      }
    }

    const accounts = await this.prisma.account.findMany({
      where: {
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        archivedAt: null,
        ...(accountIds && accountIds.length > 0 ? { id: { in: accountIds } } : {}),
      },
      select: { balanceCents: true },
    });
    const baseInitial = accounts.reduce((s, a) => s + Number(a.balanceCents) / 100, 0);

    const history = Array.from(historyMap.values());
    const allPoints = [...history, ...forecast];
    const cumulativeBalance: CashflowResult['cumulativeBalance'] = [];
    let balance = baseInitial;
    for (const p of allPoints) {
      balance += p.net;
      cumulativeBalance.push({ month: p.month, balance, isForecast: p.isForecast });
    }

    return { history, forecast, cumulativeBalance };
  }

  async comparePeriods(
    userId: string,
    mode: 'mom' | 'yoy',
    month?: string,
    accountIds?: string[],
  ) {
    const ref = month ? new Date(`${month}-01T00:00:00Z`) : monthStart(new Date());
    const prev = mode === 'yoy' ? addMonths(ref, -12) : addMonths(ref, -1);

    const [curr, prevAgg] = await Promise.all([
      this.aggregateByCategory(userId, ref, addMonths(ref, 1), accountIds),
      this.aggregateByCategory(userId, prev, addMonths(prev, 1), accountIds),
    ]);

    const allCats = new Set<string>([...curr.keys(), ...prevAgg.keys()]);
    const rows = Array.from(allCats)
      .map((catId) => {
        const c = curr.get(catId) ?? { name: 'Senza categoria', income: 0, expense: 0 };
        const p = prevAgg.get(catId) ?? { name: c.name, income: 0, expense: 0 };
        return {
          categoryId: catId,
          categoryName: c.name,
          currentExpense: c.expense,
          previousExpense: p.expense,
          currentIncome: c.income,
          previousIncome: p.income,
          deltaExpense: c.expense - p.expense,
          deltaPctExpense:
            p.expense > 0 ? ((c.expense - p.expense) / p.expense) * 100 : null,
        };
      })
      .sort((a, b) => b.currentExpense - a.currentExpense);

    return {
      mode,
      currentLabel: ymKey(ref),
      previousLabel: ymKey(prev),
      rows,
      totals: {
        currentExpense: rows.reduce((s, r) => s + r.currentExpense, 0),
        previousExpense: rows.reduce((s, r) => s + r.previousExpense, 0),
        currentIncome: rows.reduce((s, r) => s + r.currentIncome, 0),
        previousIncome: rows.reduce((s, r) => s + r.previousIncome, 0),
      },
    };
  }

  private async aggregateByCategory(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
  ) {
    const accountFilter = accountIdFilterSql(accountIds);
    const rows = await this.prisma.$queryRaw<
      Array<{ catid: string | null; name: string | null; type: string; total: bigint }>
    >`
      SELECT c.id::text AS catid, c.name, t.type::text AS type, SUM(ABS(t.amount_cents))::bigint AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ${userId}::uuid
        AND t.transaction_date >= ${from}
        AND t.transaction_date < ${to}
        AND t.type != 'transfer'
        ${accountFilter}
      GROUP BY c.id, c.name, t.type
    `;
    const map = new Map<string, { name: string; income: number; expense: number }>();
    for (const r of rows) {
      const id = r.catid ?? '__none__';
      const cur = map.get(id) ?? { name: r.name ?? 'Senza categoria', income: 0, expense: 0 };
      const eur = Number(r.total) / 100;
      if (r.type === 'income') cur.income += eur;
      else cur.expense += eur;
      map.set(id, cur);
    }
    return map;
  }

  async sankey(userId: string, fromStr?: string, toStr?: string, accountIds?: string[]) {
    const to = toStr ? new Date(`${toStr}T00:00:00Z`) : addMonths(monthStart(new Date()), 1);
    const from = fromStr ? new Date(`${fromStr}T00:00:00Z`) : addMonths(to, -1);
    const accountFilter = accountIdFilterSql(accountIds);

    const incomeRows = await this.prisma.$queryRaw<
      Array<{ catid: string | null; name: string | null; total: bigint }>
    >`
      SELECT c.id::text AS catid, c.name, SUM(t.amount_cents)::bigint AS total
      FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ${userId}::uuid AND t.type = 'income'
        AND t.transaction_date >= ${from} AND t.transaction_date < ${to}
        ${accountFilter}
      GROUP BY c.id, c.name
    `;
    const expenseRows = await this.prisma.$queryRaw<
      Array<{ catid: string | null; name: string | null; total: bigint }>
    >`
      SELECT c.id::text AS catid, c.name, SUM(ABS(t.amount_cents))::bigint AS total
      FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ${userId}::uuid AND t.type = 'expense'
        AND t.transaction_date >= ${from} AND t.transaction_date < ${to}
        ${accountFilter}
      GROUP BY c.id, c.name
    `;

    const totalIncome = incomeRows.reduce((s, r) => s + Number(r.total), 0);
    const totalExpense = expenseRows.reduce((s, r) => s + Number(r.total), 0);
    const savings = Math.max(0, totalIncome - totalExpense);

    const nodes: { id: string; label: string; kind: 'income' | 'pool' | 'expense' | 'savings' }[] =
      [{ id: 'pool', label: 'Budget', kind: 'pool' }];
    const links: { source: string; target: string; value: number }[] = [];

    for (const r of incomeRows) {
      const id = `i:${r.catid ?? 'none'}`;
      nodes.push({ id, label: r.name ?? 'Entrate', kind: 'income' });
      links.push({ source: id, target: 'pool', value: Number(r.total) / 100 });
    }
    for (const r of expenseRows) {
      const id = `e:${r.catid ?? 'none'}`;
      nodes.push({ id, label: r.name ?? 'Senza categoria', kind: 'expense' });
      links.push({ source: 'pool', target: id, value: Number(r.total) / 100 });
    }
    if (savings > 0) {
      nodes.push({ id: 'savings', label: 'Risparmio', kind: 'savings' });
      links.push({ source: 'pool', target: 'savings', value: savings / 100 });
    }
    return { nodes, links, period: { from: ymKey(from), to: ymKey(to) } };
  }

  async exportReport(userId: string, format: 'pdf' | 'xlsx', fromStr?: string, toStr?: string) {
    if (format === 'pdf') {
      const compare = await this.comparePeriods(userId, 'mom');
      const sankey = await this.sankey(userId, fromStr, toStr);
      const cashflow = await this.cashflow(userId, 12, 6);
      return { kind: 'pdf-data', compare, sankey, cashflow };
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Finance Manager';

    const compare = await this.comparePeriods(userId, 'mom');
    const cashflow = await this.cashflow(userId, 12, 6);

    const sCash = wb.addWorksheet('Cashflow');
    sCash.addRow(['Mese', 'Entrate', 'Uscite', 'Netto', 'Saldo cumulativo', 'Forecast?']);
    for (const p of [...cashflow.history, ...cashflow.forecast]) {
      const cum = cashflow.cumulativeBalance.find((c) => c.month === p.month);
      sCash.addRow([p.month, p.income, p.expense, p.net, cum?.balance ?? 0, p.isForecast ? 'sì' : '']);
    }
    sCash.getColumn(2).numFmt = '€#,##0.00';
    sCash.getColumn(3).numFmt = '€#,##0.00';
    sCash.getColumn(4).numFmt = '€#,##0.00';
    sCash.getColumn(5).numFmt = '€#,##0.00';
    sCash.getRow(1).font = { bold: true };

    const sCmp = wb.addWorksheet('Confronto categorie');
    sCmp.addRow([
      'Categoria',
      `Spesa ${compare.currentLabel}`,
      `Spesa ${compare.previousLabel}`,
      'Δ €',
      'Δ %',
    ]);
    for (const r of compare.rows) {
      sCmp.addRow([
        r.categoryName,
        r.currentExpense,
        r.previousExpense,
        r.deltaExpense,
        r.deltaPctExpense ?? '',
      ]);
    }
    sCmp.getColumn(2).numFmt = '€#,##0.00';
    sCmp.getColumn(3).numFmt = '€#,##0.00';
    sCmp.getColumn(4).numFmt = '€#,##0.00';
    sCmp.getColumn(5).numFmt = '0.0"%"';
    sCmp.getRow(1).font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    return {
      kind: 'xlsx',
      filename: `report-${ymKey(new Date())}.xlsx`,
      base64: Buffer.from(buffer).toString('base64'),
    };
  }
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}
function ymKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}
function countOccurrencesInRange(start: Date, freq: RecurrenceFreq, from: Date, to: Date): number {
  let count = 0;
  let cursor = new Date(start);
  while (cursor < to) {
    if (cursor >= from) count++;
    cursor = bumpDate(cursor, freq);
    if (count > 100) break;
  }
  return count;
}
function bumpDate(d: Date, freq: RecurrenceFreq): Date {
  const c = new Date(d);
  switch (freq) {
    case 'daily':
      c.setUTCDate(c.getUTCDate() + 1);
      break;
    case 'weekly':
      c.setUTCDate(c.getUTCDate() + 7);
      break;
    case 'biweekly':
      c.setUTCDate(c.getUTCDate() + 14);
      break;
    case 'monthly':
      c.setUTCMonth(c.getUTCMonth() + 1);
      break;
    case 'quarterly':
      c.setUTCMonth(c.getUTCMonth() + 3);
      break;
    case 'yearly':
      c.setUTCFullYear(c.getUTCFullYear() + 1);
      break;
  }
  return c;
}
