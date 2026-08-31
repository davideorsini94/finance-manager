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

/**
 * Verso del flusso di cassa per gli aggregati per categoria: uscite (default,
 * storico) oppure entrate. La dashboard usa entrambi per il selettore
 * "Entrate / Uscite" sulle card KPI.
 */
export type CategoryFlow = 'expense' | 'income';

/**
 * Nodo gerarchico della spesa per categoria. I nodi top-level sono le categorie
 * padre (o le categorie senza padre); `children` contiene le sottocategorie con
 * spesa nel periodo. Un nodo foglia (`children` vuoto) con `categoryId` valorizzato
 * è "drillabile": il frontend può recuperare le singole transazioni per quel
 * `categoryId` nel periodo.
 */
export interface CategoryNode {
  /**
   * ID delle categorie rappresentate dal nodo. È un array perché i nodi vengono
   * unificati per nome: su conti condivisi più utenti hanno categorie omonime
   * (id diversi) che confluiscono nello stesso nodo. Usato per il drill-down
   * sulle singole transazioni. Vuoto per il nodo "Senza categoria".
   */
  categoryIds: string[];
  categoryName: string;
  color: string | null;
  amountCents: string;
  count: number;
  children: CategoryNode[];
}

export interface DailyPoint {
  date: string;
  incomeCents: string;
  expenseCents: string;
  balanceCents: string; // saldo cumulativo (somma transazioni fino a quel giorno)
}

/** Movimento "grosso" del periodo, usato dal report LLM per le anomalie. */
export interface TopTransaction {
  date: string;
  description: string | null;
  amountCents: string;
  categoryName: string | null;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
  ) {}

  /**
   * I movimenti di uscita più grandi del periodo. Serve al report LLM per
   * poter citare spese specifiche: passa dall'ACL come tutti gli altri
   * aggregati, quindi non può mai pescare da conti non accessibili.
   */
  async topTransactions(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
    limit = 15,
  ): Promise<TopTransaction[]> {
    const rows = await this.prisma.transaction.findMany({
      where: this.accessibleTxWhere(
        userId,
        {
          transactionDate: { gte: from, lte: to },
          type: TransactionType.expense,
        },
        accountIds,
      ),
      // Le uscite sono negative a DB: la più grande è la più negativa.
      orderBy: { amountCents: 'asc' },
      take: limit,
      select: {
        transactionDate: true,
        description: true,
        amountCents: true,
        category: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      date: r.transactionDate.toISOString().slice(0, 10),
      description: r.description,
      amountCents: r.amountCents.toString(),
      categoryName: r.category?.name ?? null,
    }));
  }

  private accessibleTxWhere(
    userId: string,
    extra: Partial<Prisma.TransactionWhereInput> = {},
    accountIds?: string[],
    categoryIds?: string[],
  ): Prisma.TransactionWhereInput {
    // L'AccountPolicy filtra ai soli conti a cui l'utente ha accesso. Se
    // l'utente specifica `accountIds`, restringiamo ulteriormente: id non
    // accessibili semplicemente non rientrano nel WHERE → niente dati.
    // `categoryIds` (opz.) restringe alle sole transazioni con una di quelle
    // categorie.
    return {
      account: this.policy.accessibleAccountsWhere(userId),
      ...(accountIds && accountIds.length > 0 ? { accountId: { in: accountIds } } : {}),
      ...(categoryIds && categoryIds.length > 0 ? { categoryId: { in: categoryIds } } : {}),
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
    categoryIds?: string[],
  ): Promise<PeriodTotals> {
    const where = this.accessibleTxWhere(
      userId,
      {
        transactionDate: { gte: from, lte: to },
        type: { not: TransactionType.transfer },
      },
      accountIds,
      categoryIds,
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
   * Importi raggruppati per categoria (lista piatta); i movimenti senza categoria
   * confluiscono in "Senza categoria". `flow` sceglie il verso: `expense`
   * (default, comportamento storico) oppure `income`. Importi sempre in valore
   * assoluto.
   */
  async categoryBreakdown(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
    categoryIds?: string[],
    flow: CategoryFlow = 'expense',
  ): Promise<CategoryBreakdownItem[]> {
    const isIncome = flow === 'income';
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: this.accessibleTxWhere(
        userId,
        {
          type: isIncome ? TransactionType.income : TransactionType.expense,
          transactionDate: { gte: from, lte: to },
        },
        accountIds,
        categoryIds,
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
        const sum = g._sum.amountCents ?? 0n;
        const amount = isIncome ? sum : -sum; // le uscite sono negative a DB
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
   * Importi raggruppati in modo gerarchico: categorie padre al primo livello, con
   * le sottocategorie (e l'eventuale importo assegnato direttamente al padre) nei
   * `children`. I movimenti senza categoria confluiscono in un nodo "Senza
   * categoria". Pensato per la sezione "Top categorie" del report e per la torta
   * della dashboard, dove l'utente può espandere padre → sottocategorie.
   *
   * `flow` sceglie il verso: `expense` (default, comportamento storico) oppure
   * `income`. Gli importi tornano sempre in valore assoluto — le uscite sono
   * negative a DB, le entrate positive.
   */
  async categoryBreakdownTree(
    userId: string,
    from: Date,
    to: Date,
    accountIds?: string[],
    categoryIds?: string[],
    flow: CategoryFlow = 'expense',
  ): Promise<CategoryNode[]> {
    const isIncome = flow === 'income';
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: this.accessibleTxWhere(
        userId,
        {
          type: isIncome ? TransactionType.income : TransactionType.expense,
          transactionDate: { gte: from, lte: to },
        },
        accountIds,
        categoryIds,
      ),
      _sum: { amountCents: true },
      _count: { _all: true },
    });

    // Risolviamo le categorie per `id` (NON per `userId`): su conti condivisi
    // le transazioni possono appartenere a un altro utente e usare categorie di
    // quell'utente — vanno comunque risolte, come fa categoryBreakdown(). Oltre
    // alle categorie con spesa, carichiamo anche i rispettivi padri.
    const directIds = grouped
      .map((g) => g.categoryId)
      .filter((id): id is string => !!id);
    const directCats = directIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: directIds } },
          select: { id: true, name: true, color: true, parentId: true },
        })
      : [];
    const parentIds = directCats
      .map((c) => c.parentId)
      .filter((id): id is string => !!id && !directIds.includes(id));
    const parentCats = parentIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, name: true, color: true, parentId: true },
        })
      : [];
    const catById = new Map([...directCats, ...parentCats].map((c) => [c.id, c]));

    // Unifichiamo per NOME normalizzato (non per id): utenti diversi su conti
    // condivisi hanno categorie omonime con id diversi, che vanno mostrate come
    // un'unica voce. Ogni accumulatore tiene l'insieme degli id confluiti, usato
    // poi per il drill-down sulle singole transazioni.
    const norm = (s: string) => s.trim().toLowerCase();
    interface SubAcc {
      name: string;
      color: string | null;
      ids: Set<string>;
      amount: bigint;
      count: number;
    }
    interface TopAcc {
      name: string;
      color: string | null;
      directIds: Set<string>; // id categorie con spesa diretta sul top-level
      direct: bigint;
      directCount: number;
      subs: Map<string, SubAcc>; // chiave: nome sottocategoria normalizzato
    }
    const NONE_KEY = ' none';
    const tops = new Map<string, TopAcc>();
    const ensureTop = (key: string, name: string, color: string | null): TopAcc => {
      let t = tops.get(key);
      if (!t) {
        t = { name, color, directIds: new Set(), direct: 0n, directCount: 0, subs: new Map() };
        tops.set(key, t);
      } else if (!t.color && color) {
        t.color = color; // adotta il primo colore disponibile tra le omonime
      }
      return t;
    };

    for (const g of grouped) {
      const sum = g._sum.amountCents ?? 0n;
      const amount = isIncome ? sum : -sum; // le uscite sono negative → valore assoluto
      if (amount === 0n) continue;
      const count = g._count._all;
      const cat = g.categoryId ? catById.get(g.categoryId) : undefined;

      if (!g.categoryId || !cat) {
        // Nessuna categoria (o categoria non più esistente): nodo "Senza categoria".
        const t = ensureTop(NONE_KEY, 'Senza categoria', null);
        t.direct += amount;
        t.directCount += count;
      } else if (!cat.parentId) {
        // Categoria top-level: spesa diretta sul padre/standalone.
        const t = ensureTop(norm(cat.name), cat.name, cat.color);
        t.direct += amount;
        t.directCount += count;
        t.directIds.add(cat.id);
      } else {
        // Sottocategoria: confluisce nel padre (unificato per nome).
        const parent = catById.get(cat.parentId);
        const parentName = parent?.name ?? 'Senza categoria';
        const t = ensureTop(norm(parentName), parentName, parent?.color ?? null);
        const subKey = norm(cat.name);
        let sub = t.subs.get(subKey);
        if (!sub) {
          sub = { name: cat.name, color: cat.color, ids: new Set(), amount: 0n, count: 0 };
          t.subs.set(subKey, sub);
        } else if (!sub.color && cat.color) {
          sub.color = cat.color;
        }
        sub.amount += amount;
        sub.count += count;
        sub.ids.add(cat.id);
      }
    }

    const nodes: CategoryNode[] = [];
    for (const t of tops.values()) {
      const subs = [...t.subs.values()];
      let total = t.direct;
      let count = t.directCount;
      let children: CategoryNode[] = [];

      if (subs.length > 0) {
        children = subs.map((s) => ({
          categoryIds: [...s.ids],
          categoryName: s.name,
          color: s.color,
          amountCents: s.amount.toString(),
          count: s.count,
          children: [],
        }));
        total += subs.reduce((acc, s) => acc + s.amount, 0n);
        count += subs.reduce((acc, s) => acc + s.count, 0);
        // Se il padre ha anche movimenti assegnati direttamente, li mostriamo come
        // voce a sé drillabile (id = id delle categorie padre coinvolte).
        if (t.direct > 0n) {
          children.push({
            categoryIds: [...t.directIds],
            categoryName: isIncome ? 'Entrate dirette' : 'Spese dirette',
            color: t.color,
            amountCents: t.direct.toString(),
            count: t.directCount,
            children: [],
          });
        }
        children.sort((a, b) => Number(BigInt(b.amountCents) - BigInt(a.amountCents)));
      }

      nodes.push({
        categoryIds: [...t.directIds],
        categoryName: t.name,
        color: t.color,
        amountCents: total.toString(),
        count,
        children,
      });
    }

    return nodes
      .filter((n) => BigInt(n.amountCents) !== 0n)
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
    categoryIds?: string[],
  ): Promise<DailyPoint[]> {
    const transactions = await this.prisma.transaction.findMany({
      where: this.accessibleTxWhere(
        userId,
        {
          type: { not: TransactionType.transfer },
          transactionDate: { gte: from, lte: to },
        },
        accountIds,
        categoryIds,
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
        categoryIds,
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
    // `categoriesIncome` accanto a `categories`: il selettore Entrate/Uscite
    // della pagina Report cambia solo la vista, senza rifare la richiesta.
    const [p1Totals, p2Totals, p1Cats, p2Cats, p1CatsIn, p2CatsIn] = await Promise.all([
      this.periodTotals(userId, p1.from, p1.to, accountIds),
      this.periodTotals(userId, p2.from, p2.to, accountIds),
      this.categoryBreakdown(userId, p1.from, p1.to, accountIds),
      this.categoryBreakdown(userId, p2.from, p2.to, accountIds),
      this.categoryBreakdown(userId, p1.from, p1.to, accountIds, undefined, 'income'),
      this.categoryBreakdown(userId, p2.from, p2.to, accountIds, undefined, 'income'),
    ]);
    return {
      period1: { ...p1, totals: p1Totals, categories: p1Cats, categoriesIncome: p1CatsIn },
      period2: { ...p2, totals: p2Totals, categories: p2Cats, categoriesIncome: p2CatsIn },
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
    categoryIds?: string[],
  ) {
    const today = new Date();
    const to = toStr ? new Date(toStr) : today;
    const from = fromStr
      ? new Date(fromStr)
      : new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Il filtro per categoria dalla dashboard arriva come categorie PADRE:
    // includiamo anche tutte le sottocategorie così "filtra per X" ingloba i
    // movimenti dei figli di X (categorie a 2 livelli → basta un'espansione).
    const effectiveCategoryIds = await this.expandWithChildren(userId, categoryIds);

    // Calcoliamo entrambi gli alberi (uscite + entrate) in un colpo: il selettore
    // Entrate/Uscite della dashboard cambia solo la vista, senza refetch.
    const [totals, byCategory, byCategoryTree, byCategoryTreeIncome, daily, recent] =
      await Promise.all([
        this.periodTotals(userId, from, to, accountIds, effectiveCategoryIds),
        this.categoryBreakdown(userId, from, to, accountIds, effectiveCategoryIds),
        this.categoryBreakdownTree(userId, from, to, accountIds, effectiveCategoryIds),
        this.categoryBreakdownTree(userId, from, to, accountIds, effectiveCategoryIds, 'income'),
        this.dailyTimeSeries(userId, from, to, accountIds, effectiveCategoryIds),
        this.prisma.transaction.findMany({
          where: this.accessibleTxWhere(userId, {}, accountIds, effectiveCategoryIds),
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
      categoryIds: categoryIds ?? null,
      totals,
      byCategory,
      byCategoryTree,
      // Stesso albero, ma sulle entrate: vista "Entrate per categoria" della dashboard.
      byCategoryTreeIncome,
      daily,
      recent,
    };
  }

  /**
   * Espande una lista di id categoria includendo le sottocategorie dirette
   * (categorie con `parentId` in `categoryIds`). Le categorie sono a 2 livelli,
   * quindi una sola espansione è sufficiente. Restituisce undefined se l'input
   * è vuoto (nessun filtro).
   */
  private async expandWithChildren(
    userId: string,
    categoryIds?: string[],
  ): Promise<string[] | undefined> {
    if (!categoryIds || categoryIds.length === 0) return categoryIds;
    const children = await this.prisma.category.findMany({
      where: { userId, parentId: { in: categoryIds } },
      select: { id: true },
    });
    return [...new Set([...categoryIds, ...children.map((c) => c.id)])];
  }
}
