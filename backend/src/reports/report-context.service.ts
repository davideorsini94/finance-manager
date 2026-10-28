import { Injectable } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { CATEGORIZED_TRANSFER_WHERE, NOT_CATEGORIZED_TRANSFER_WHERE } from './transfer-category';

export interface AccountOverview {
  name: string;
  type: string;
  holders: number;
  currentBalanceCents: string;
  openingBalanceCents: string;
  closingBalanceCents: string;
  incomeCents: string;
  expenseCents: string;
  transfersInCents: string;
  transfersOutCents: string;
  txCount: number;
}

export interface TransferItem {
  date: string;
  fromAccount: string;
  toAccount: string;
  amountCents: string;
  /** Movimento con categoria "Giroconto" senza la gamba opposta abbinata. */
  unmatched?: boolean;
}

export interface ToVerifyItem {
  date: string;
  description: string | null;
  amountCents: string;
  accountName: string;
}

export interface RecurringItem {
  description: string | null;
  amountCents: string;
  type: string;
  frequency: string;
  accountName: string;
  toAccountName: string | null;
  categoryName: string | null;
}

/**
 * Dati "per conto" del report LLM: saldi, giroconti reali, movimenti da
 * verificare e regole ricorrenti. Tutto passa dall'ACL (conti accessibili,
 * non archiviati) e, se indicati, da `accountIds`.
 */
@Injectable()
export class ReportContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
  ) {}

  private accountWhere(userId: string, accountIds?: string[]): Prisma.AccountWhereInput {
    return {
      ...this.policy.accessibleAccountsWhere(userId),
      ...(accountIds && accountIds.length > 0 ? { id: { in: accountIds } } : {}),
    };
  }

  /**
   * Il saldo a DB è quello attuale e non coincide con la somma dei movimenti
   * (storico importato parziale): saldo finale = attuale − movimenti successivi
   * al periodo; saldo iniziale = finale − movimenti del periodo (giroconti
   * compresi). Le entrate/uscite con categoria "Giroconto" contano come
   * giroconti in entrata/uscita, non come entrate/uscite.
   */
  async accountsOverview(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
  ): Promise<AccountOverview[]> {
    const accounts = await this.prisma.account.findMany({
      where: this.accountWhere(userId, accountIds),
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        balanceCents: true,
        _count: { select: { members: true } },
      },
    });
    if (accounts.length === 0) return [];
    const ids = accounts.map((a) => a.id);
    const inPeriod = { accountId: { in: ids }, transactionDate: { gte: from, lte: to } };
    const transferLike = { OR: [{ type: TransactionType.transfer }, CATEGORIZED_TRANSFER_WHERE] };

    const [after, byType, trIn, trOut] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['accountId'],
        where: { accountId: { in: ids }, transactionDate: { gt: to } },
        _sum: { amountCents: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['accountId', 'type'],
        where: { ...inPeriod, AND: [NOT_CATEGORIZED_TRANSFER_WHERE] },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['accountId'],
        where: { ...inPeriod, ...transferLike, amountCents: { gt: 0n } },
        _sum: { amountCents: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['accountId'],
        where: { ...inPeriod, ...transferLike, amountCents: { lt: 0n } },
        _sum: { amountCents: true },
      }),
    ]);

    return accounts.map((a) => {
      const afterSum = after.find((r) => r.accountId === a.id)?._sum.amountCents ?? 0n;
      const rows = byType.filter((r) => r.accountId === a.id);
      const sumOf = (t: TransactionType) =>
        rows.find((r) => r.type === t)?._sum.amountCents ?? 0n;
      const closing = a.balanceCents - afterSum;
      const tIn = trIn.find((r) => r.accountId === a.id)?._sum.amountCents ?? 0n;
      const tOut = trOut.find((r) => r.accountId === a.id)?._sum.amountCents ?? 0n;
      const periodAll =
        sumOf(TransactionType.income) + sumOf(TransactionType.expense) + tIn + tOut;
      return {
        name: a.name,
        type: a.type,
        holders: a._count.members + 1,
        currentBalanceCents: a.balanceCents.toString(),
        openingBalanceCents: (closing - periodAll).toString(),
        closingBalanceCents: closing.toString(),
        incomeCents: sumOf(TransactionType.income).toString(),
        expenseCents: (-sumOf(TransactionType.expense)).toString(),
        transfersInCents: tIn.toString(),
        transfersOutCents: (-tOut).toString(),
        txCount: rows
          .filter((r) => r.type !== TransactionType.transfer)
          .reduce((acc, r) => acc + r._count._all, 0),
      };
    });
  }

  /**
   * Giroconti del periodo: quelli veri (movimenti accoppiati tra conti), una
   * riga per coppia, più le entrate/uscite con categoria "Giroconto", marcate
   * `unmatched` perché l'altra gamba non è abbinata.
   */
  async transfers(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
    limit = 40,
  ): Promise<TransferItem[]> {
    const accountFilter = this.accountWhere(userId, accountIds);
    const legs = await this.prisma.transaction.findMany({
      where: {
        type: TransactionType.transfer,
        transactionDate: { gte: from, lte: to },
        account: accountFilter,
      },
      orderBy: { transactionDate: 'asc' },
      select: {
        id: true,
        transferPairId: true,
        transactionDate: true,
        amountCents: true,
        account: { select: { name: true } },
      },
    });
    // `transferPairId` di una gamba è l'id dell'altra gamba.
    const otherIds = legs.map((l) => l.transferPairId).filter((p): p is string => !!p);
    const others = otherIds.length
      ? await this.prisma.transaction.findMany({
          where: { id: { in: otherIds }, account: this.accountWhere(userId) },
          select: { id: true, account: { select: { name: true } } },
        })
      : [];
    const otherName = (id: string | null) =>
      others.find((o) => o.id === id)?.account.name ?? 'altro conto';

    const seen = new Set<string>();
    const items: TransferItem[] = [];
    for (const l of legs) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      if (l.transferPairId) seen.add(l.transferPairId);
      const outgoing = l.amountCents < 0n;
      const mine = l.account.name;
      const theirs = otherName(l.transferPairId);
      items.push({
        date: l.transactionDate.toISOString().slice(0, 10),
        fromAccount: outgoing ? mine : theirs,
        toAccount: outgoing ? theirs : mine,
        amountCents: (outgoing ? -l.amountCents : l.amountCents).toString(),
      });
      if (items.length >= limit) break;
    }

    const loose = await this.prisma.transaction.findMany({
      where: {
        ...CATEGORIZED_TRANSFER_WHERE,
        transactionDate: { gte: from, lte: to },
        account: accountFilter,
      },
      orderBy: { transactionDate: 'asc' },
      take: limit,
      select: { transactionDate: true, amountCents: true, account: { select: { name: true } } },
    });
    for (const l of loose) {
      const outgoing = l.amountCents < 0n;
      items.push({
        date: l.transactionDate.toISOString().slice(0, 10),
        fromAccount: outgoing ? l.account.name : 'altro conto',
        toAccount: outgoing ? 'altro conto' : l.account.name,
        amountCents: (outgoing ? -l.amountCents : l.amountCents).toString(),
        unmatched: true,
      });
    }
    return items.sort((x, y) => x.date.localeCompare(y.date)).slice(0, limit * 2);
  }

  /** Entrate/uscite del periodo senza categoria: il "Da verificare". */
  async toVerify(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
    limit = 25,
  ): Promise<{ items: ToVerifyItem[]; total: number }> {
    const where: Prisma.TransactionWhereInput = {
      type: { not: TransactionType.transfer },
      categoryId: null,
      transactionDate: { gte: from, lte: to },
      account: this.accountWhere(userId, accountIds),
    };
    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { transactionDate: 'asc' },
        take: limit,
        select: {
          transactionDate: true,
          description: true,
          amountCents: true,
          account: { select: { name: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        date: r.transactionDate.toISOString().slice(0, 10),
        description: r.description,
        amountCents: r.amountCents.toString(),
        accountName: r.account.name,
      })),
    };
  }

  /** Regole ricorrenti attive su conti accessibili. */
  async recurringRules(
    userId: string,
    accountIds?: string[],
    limit = 30,
  ): Promise<RecurringItem[]> {
    const rows = await this.prisma.recurringRule.findMany({
      where: { isActive: true, account: this.accountWhere(userId, accountIds) },
      orderBy: { nextRunDate: 'asc' },
      take: limit,
      select: {
        description: true,
        amountCents: true,
        type: true,
        frequency: true,
        account: { select: { name: true } },
        toAccount: { select: { name: true } },
        category: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      description: r.description,
      amountCents: r.amountCents.toString(),
      type: r.type,
      frequency: r.frequency,
      accountName: r.account.name,
      toAccountName: r.toAccount?.name ?? null,
      categoryName: r.category?.name ?? null,
    }));
  }
}
