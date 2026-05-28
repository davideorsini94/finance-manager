import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';

export interface PeriodTotals {
  incomeCents: string;
  expenseCents: string;
  netCents: string;
  txCount: number;
}

export interface CategoryBreakdownItem {
  categoryId: string | null;
  categoryName: string;
  color: string | null;
  amountCents: string;
  count: number;
}

export interface DailyPoint {
  date: string;
  incomeCents: string;
  expenseCents: string;
  balanceCents: string; // saldo cumulativo (somma transazioni fino a quel giorno)
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
  ) {}

  private accessibleTxWhere(
    userId: string,
    extra: Partial<Prisma.TransactionWhereInput> = {},
    accountIds?: string[],
  ): Prisma.TransactionWhereInput {
    // L'AccountPolicy filtra ai soli conti a cui l'utente ha accesso. Se
    // l'utente specifica `accountIds`, restringiamo ulteriormente: id non
    // accessibili semplicemente non rientrano nel WHERE → niente dati.
    return {
      account: this.policy.accessibleAccountsWhere(userId),
      ...(accountIds && accountIds.length > 0 ? { accountId: { in: accountIds } } : {}),
      ...extra,
    };
  }

  /**
   * Totali entrata/uscita/netto in un periodo.
   * I giroconti vengono esclusi (sono interni e non rappresentano denaro entrante/uscente reale).
   * `accountIds` (opz.) restringe a un sottoinsieme di conti.
   */
  async periodTotals(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
  ): Promise<PeriodTotals> {
    const where = this.accessibleTxWhere(
      userId,
      {
        transactionDate: { gte: from, lte: to },
        type: { not: TransactionType.transfer },
      },
      accountIds,
    );

    const [income, expense, count] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...where, type: TransactionType.income },
        _sum: { amountCents: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...where, type: TransactionType.expense },
        _sum: { amountCents: true },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const inc = income._sum.amountCents ?? 0n;
    const exp = expense._sum.amountCents ?? 0n;

    return {
      incomeCents: inc.toString(),
      expenseCents: (-exp).toString(), // exp è negativo, ritorno il valore assoluto
      netCents: (inc + exp).toString(),
      txCount: count,
    };
  }

  /**
   * Spesa raggruppata per categoria, escluse uscite senza categoria? Le includiamo come "Senza categoria".
   * Solo type=expense.
   */
  async categoryBreakdown(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
  ): Promise<CategoryBreakdownItem[]> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: this.accessibleTxWhere(
        userId,
        {
          type: TransactionType.expense,
          transactionDate: { gte: from, lte: to },
        },
        accountIds,
      ),
      _sum: { amountCents: true },
      _count: { _all: true },
    });

    const ids = grouped.map((g) => g.categoryId).filter((id): id is string => !!id);
    const categories = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, color: true },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));

    return grouped
      .map((g) => {
        const cat = g.categoryId ? byId.get(g.categoryId) : undefined;
        const amount = -(g._sum.amountCents ?? 0n);
        return {
          categoryId: g.categoryId,
          categoryName: cat?.name ?? 'Senza categoria',
          color: cat?.color ?? null,
          amountCents: amount.toString(),
          count: g._count._all,
        };
      })
      .filter((g) => BigInt(g.amountCents) !== 0n)
      .sort((a, b) => Number(BigInt(b.amountCents) - BigInt(a.amountCents)));
  }

  /**
   * Time-series giornaliera per il periodo. Restituisce per ogni giorno entrate, uscite,
   * e saldo cumulativo (somma di tutte le transazioni fino al giorno incluso).
   * Per dashboard è meglio usare questo a granularità giornaliera per ≤90 giorni.
   */
  async dailyTimeSeries(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
  ): Promise<DailyPoint[]> {
    const transactions = await this.prisma.transaction.findMany({
      where: this.accessibleTxWhere(
        userId,
        {
          type: { not: TransactionType.transfer },
          transactionDate: { gte: from, lte: to },
        },
        accountIds,
      ),
      select: { amountCents: true, type: true, transactionDate: true },
      orderBy: { transactionDate: 'asc' },
    });

    // Calcola saldo iniziale (somma di tutto prima di `from`, inclusi giroconti per coerenza)
    const opening = await this.prisma.transaction.aggregate({
      where: this.accessibleTxWhere(
        userId,
        { transactionDate: { lt: from } },
        accountIds,
      ),
      _sum: { amountCents: true },
    });
    let cumulative = opening._sum.amountCents ?? 0n;

    const buckets = new Map<string, { income: bigint; expense: bigint }>();
    for (const tx of transactions) {
      const key = tx.transactionDate.toISOString().slice(0, 10);
      const b = buckets.get(key) ?? { income: 0n, expense: 0n };
      if (tx.type === TransactionType.income) b.income += tx.amountCents;
      else if (tx.type === TransactionType.expense) b.expense += tx.amountCents; // negativo
      buckets.set(key, b);
    }

    const points: DailyPoint[] = [];
    const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      const b = buckets.get(key) ?? { income: 0n, expense: 0n };
      cumulative += b.income + b.expense;
      points.push({
        date: key,
        incomeCents: b.income.toString(),
        expenseCents: (-b.expense).toString(),
        balanceCents: cumulative.toString(),
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return points;
  }

  /**
   * Aggregato mensile per un anno. Ritorna 12 punti.
   */
  async monthlyAggregates(userId: string, year: number, accountIds?: string[]) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));

    const txs = await this.prisma.transaction.findMany({
      where: this.accessibleTxWhere(
        userId,
        {
          type: { not: TransactionType.transfer },
          transactionDate: { gte: from, lt: to },
        },
        accountIds,
      ),
      select: { amountCents: true, type: true, transactionDate: true },
    });

    const buckets = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      incomeCents: 0n,
      expenseCents: 0n,
    }));

    for (const tx of txs) {
      const m = tx.transactionDate.getUTCMonth();
      if (tx.type === TransactionType.income) buckets[m].incomeCents += tx.amountCents;
      else buckets[m].expenseCents += tx.amountCents; // negativo
    }

    return buckets.map((b) => ({
      month: b.month,
      incomeCents: b.incomeCents.toString(),
      expenseCents: (-b.expenseCents).toString(),
      netCents: (b.incomeCents + b.expenseCents).toString(),
    }));
  }

  async comparePeriods(
    userId: string,
    p1: { from: Date; to: Date },
    p2: { from: Date; to: Date },
    accountIds?: string[],
  ) {
    const [p1Totals, p2Totals, p1Cats, p2Cats] = await Promise.all([
      this.periodTotals(userId, p1.from, p1.to, accountIds),
      this.periodTotals(userId, p2.from, p2.to, accountIds),
      this.categoryBreakdown(userId, p1.from, p1.to, accountIds),
      this.categoryBreakdown(userId, p2.from, p2.to, accountIds),
    ]);
    return {
      period1: { ...p1, totals: p1Totals, categories: p1Cats },
      period2: { ...p2, totals: p2Totals, categories: p2Cats },
    };
  }

  /**
   * Dati aggregati per la dashboard: totali periodo + breakdown categorie + serie giornaliera.
   * Default: ultimi 30 giorni.
   * `accountIds` (opz.) restringe i dati a uno o più conti specifici.
   */
  async dashboard(
    userId: string,
    fromStr?: string,
    toStr?: string,
    accountIds?: string[],
  ) {
    const today = new Date();
    const to = toStr ? new Date(toStr) : today;
    const from = fromStr
      ? new Date(fromStr)
      : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totals, byCategory, daily, recent] = await Promise.all([
      this.periodTotals(userId, from, to, accountIds),
      this.categoryBreakdown(userId, from, to, accountIds),
      this.dailyTimeSeries(userId, from, to, accountIds),
      this.prisma.transaction.findMany({
        where: this.accessibleTxWhere(userId, {}, accountIds),
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        include: {
          category: { select: { id: true, name: true, color: true, icon: true, isIncome: true } },
          account: { select: { id: true, name: true, type: true } },
          attachments: { select: { id: true } },
        },
      }),
    ]);

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      accountIds: accountIds ?? null,
      totals,
      byCategory,
      daily,
      recent,
    };
  }
}
