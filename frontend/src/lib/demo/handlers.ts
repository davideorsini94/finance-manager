/**
 * Router delle risposte demo: matcha l'URL della richiesta e produce
 * l'oggetto da serializzare. Quando il dataset non copre un endpoint,
 * ritorniamo `null` e il chiamante (interceptor in `client.ts`) lascia
 * passare la richiesta normalmente — ma in modalità demo accettiamo solo
 * GET, le mutation diventano un 200 vuoto così la UI non si rompe.
 */

import { demoDataset } from './data';
import type { Transaction } from '@/types/domain';

interface Ctx {
  pathname: string;
  search: URLSearchParams;
  method: string;
  /** Body JSON già parsato della richiesta (solo per metodi non-GET). */
  body?: unknown;
}

export function demoHandle(ctx: Ctx): unknown | null {
  const { pathname, search, method, body } = ctx;

  // Auth
  if (pathname === 'auth/me' || pathname.endsWith('/auth/me')) return demoDataset.me;
  if (pathname.endsWith('/auth/login')) return { ok: true };
  if (pathname.endsWith('/auth/refresh')) return { ok: true };
  if (pathname.endsWith('/auth/logout')) return { ok: true };

  // Accounts
  if (matches(pathname, 'accounts') && method === 'GET') {
    return demoDataset.accounts;
  }
  // Categories
  if (matches(pathname, 'categories') && method === 'GET') {
    return demoDataset.categories;
  }

  // Transactions list
  if (matches(pathname, 'transactions') && method === 'GET') {
    const all = demoDataset.transactions;
    const accountId = search.get('accountId');
    const categoryId = search.get('categoryId');
    // Il drill-down dei report filtra per `categoryIds` multipli e per `type`:
    // ignorarli mostrava movimenti di altre categorie e del verso sbagliato.
    const categoryIds = search.getAll('categoryIds');
    const accountIds = search.getAll('accountIds');
    const type = search.get('type');
    const from = search.get('from');
    const to = search.get('to');
    const q = (search.get('search') ?? '').toLowerCase();
    const limit = Number(search.get('limit') ?? '50');
    const page = Number(search.get('page') ?? '1');
    const filtered = all.filter((tx) => {
      if (accountId && tx.accountId !== accountId) return false;
      if (accountIds.length > 0 && !accountIds.includes(tx.accountId)) return false;
      if (categoryId && tx.categoryId !== categoryId) return false;
      if (categoryIds.length > 0 && !(tx.categoryId && categoryIds.includes(tx.categoryId)))
        return false;
      if (type && tx.type !== type) return false;
      if (from && tx.transactionDate < from) return false;
      if (to && tx.transactionDate > to) return false;
      if (q && !(tx.description ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
    const start = (page - 1) * limit;
    return { items: filtered.slice(start, start + limit), total: filtered.length, page, limit };
  }

  // Reports — dashboard
  if (matches(pathname, 'reports/dashboard') && method === 'GET') {
    const from = search.get('from') ?? isoDaysAgo(30);
    const to = search.get('to') ?? new Date().toISOString().slice(0, 10);
    return buildDashboard(from, to);
  }
  if (matches(pathname, 'reports/monthly') && method === 'GET') {
    const year = Number(search.get('year') ?? new Date().getFullYear());
    const month = Number(search.get('month') ?? new Date().getMonth() + 1);
    const from = `${year}-${pad(month)}-01`;
    const to = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
    return buildDashboard(from, to);
  }
  if (matches(pathname, 'reports/annual') && method === 'GET') {
    const year = Number(search.get('year') ?? new Date().getFullYear());
    return buildAnnual(year);
  }
  if (matches(pathname, 'reports/custom') && method === 'GET') {
    const from = search.get('from') ?? isoDaysAgo(90);
    const to = search.get('to') ?? new Date().toISOString().slice(0, 10);
    return buildDashboard(from, to);
  }
  // `reports/compare` (confronto periodi della pagina Report) — non coperto
  // finora: la richiesta usciva verso il backend e in demo tornava 401.
  if (matches(pathname, 'reports/compare') && method === 'GET') {
    return buildPeriodsCompare(search);
  }
  if (matches(pathname, 'reports/advanced/cashflow') && method === 'GET') {
    const months = Number(search.get('months') ?? '12');
    const forecastMonths = Number(search.get('forecastMonths') ?? '6');
    return buildCashflow(months, forecastMonths);
  }
  if (matches(pathname, 'reports/advanced/sankey') && method === 'GET') {
    return buildSankey();
  }
  if (matches(pathname, 'reports/advanced/compare') && method === 'GET') {
    return buildCompare(search.get('mode') === 'yoy' ? 'yoy' : 'mom');
  }

  // Budgets
  if (matches(pathname, 'budgets') && method === 'GET') {
    return buildBudgetsWithSpent();
  }

  // Goals
  if (matches(pathname, 'goals') && method === 'GET') {
    return demoDataset.goals;
  }

  // Recurring
  if (matches(pathname, 'recurring-rules') && method === 'GET') {
    return demoDataset.recurring;
  }
  if (matches(pathname, 'recurring') && method === 'GET') {
    return demoDataset.recurring;
  }

  // Notifications
  if (matches(pathname, 'notifications/preferences') && method === 'GET') {
    return [];
  }
  if (matches(pathname, 'notifications/unread-count') && method === 'GET') {
    return { count: 0 };
  }
  if (matches(pathname, 'notifications') && method === 'GET') {
    return { items: [], total: 0, unread: 0 };
  }

  // Imports
  if (matches(pathname, 'imports/templates') && method === 'GET') {
    return [];
  }
  if (matches(pathname, 'imports/batches') && method === 'GET') {
    return [];
  }

  // Sharing / invites
  if (pathname.endsWith('/invites/mine') && method === 'GET') return [];
  if (matches(pathname, 'accounts/.*/sharing/members') && method === 'GET') {
    return {
      account: {
        ownerId: demoDataset.me.id,
        name: demoDataset.accounts[0].name,
        owner: { id: demoDataset.me.id, email: demoDataset.me.email, fullName: demoDataset.me.fullName },
      },
      members: [],
      invites: [],
    };
  }

  // Chat
  if (matches(pathname, 'chat/sessions') && method === 'GET') return [];

  // LLM / Ollama (impostazioni) — ordine dal più specifico al più generico
  if (matches(pathname, 'settings/llm/catalog') && method === 'GET') {
    return { items: DEMO_LLM_CATALOG };
  }
  if (matches(pathname, 'settings/llm/pull-status') && method === 'GET') {
    return demoPullStatus();
  }
  if (matches(pathname, 'settings/llm/models/pull') && method === 'POST') {
    return demoStartPull(body);
  }
  if (matches(pathname, 'settings/llm/models') && method === 'DELETE') {
    return demoRemoveModel(pathname);
  }
  if (matches(pathname, 'settings/llm') && method === 'GET') {
    return demoLlmSettings();
  }
  if (matches(pathname, 'settings/llm') && method === 'PUT') {
    return demoSelectModel(body);
  }

  // Sync bancario — credenziali (admin)
  if (matches(pathname, 'settings/bank-sync/test') && method === 'POST') {
    return demoBankTest();
  }
  if (matches(pathname, 'settings/bank-sync') && method === 'GET') {
    return demoBankCredentialsStatus();
  }
  if (matches(pathname, 'settings/bank-sync') && method === 'PUT') {
    return demoSaveBankCredentials(body);
  }
  if (matches(pathname, 'settings/bank-sync') && method === 'DELETE') {
    demoBankCredentials = null;
    return { ok: true, demo: true };
  }

  // Sync bancario — istituti, connessioni, link (dal più specifico al generico)
  if (matches(pathname, 'bank-sync/institutions') && method === 'GET') {
    return { items: DEMO_INSTITUTIONS };
  }
  if (matches(pathname, 'bank-sync/callback') && method === 'POST') {
    return demoBankCallback(body);
  }
  // Rotte più specifiche di 'bank-sync/links' e 'bank-sync/sync': vanno
  // controllate per prime, altrimenti verrebbero intercettate dai match
  // generici più sotto (vedi `matches`, che fa anche prefix-match).
  if (matches(pathname, 'bank-sync/links/.*/sync') && method === 'POST') {
    return demoSyncLink(demoIdFromPath(pathname, -2));
  }
  if (matches(pathname, 'bank-sync/sync') && method === 'POST') {
    return demoSyncAll();
  }
  // Orari del sync automatico (max 4/giorno, quarti d'ora).
  if (matches(pathname, 'bank-sync/schedule') && method === 'GET') {
    return { times: demoBankSyncTimes };
  }
  if (matches(pathname, 'bank-sync/schedule') && method === 'PUT') {
    return demoUpdateSchedule(body);
  }
  // Coda di revisione (Fase 4): le rotte specifiche prima della generica,
  // altrimenti `matches` (prefix-match) le intercetta tutte.
  if (matches(pathname, 'bank-sync/review/count') && method === 'GET') {
    return { count: demoPendingReviewCount() };
  }
  if (matches(pathname, 'bank-sync/review/confirm') && method === 'POST') {
    return demoConfirmReview(body);
  }
  if (matches(pathname, 'bank-sync/review/ignore') && method === 'POST') {
    return demoIgnoreReview(body);
  }
  if (matches(pathname, 'bank-sync/review') && method === 'GET') {
    return demoReviewList(search.get('status'), search.get('page'), search.get('pageSize'));
  }
  if (matches(pathname, 'bank-sync/review') && method === 'PATCH') {
    return demoPatchReview(demoIdFromPath(pathname, -1), body);
  }
  if (matches(pathname, 'bank-sync/connections/.*/accounts') && method === 'GET') {
    return demoProviderAccounts(demoIdFromPath(pathname, -2));
  }
  // Rinnovo consenso (Fase 5): rotta specifica prima della generica POST
  // 'bank-sync/connections' (che crea una connessione nuova), stesso motivo
  // di /accounts sopra.
  if (matches(pathname, 'bank-sync/connections/.*/renew') && method === 'POST') {
    return demoRenewConnection(demoIdFromPath(pathname, -2));
  }
  if (matches(pathname, 'bank-sync/connections') && method === 'POST') {
    return demoCreateConnection(body);
  }
  if (matches(pathname, 'bank-sync/connections') && method === 'GET') {
    const id = demoIdFromPath(pathname, -1);
    if (id && id !== 'connections') {
      return demoConnectionView(id) ?? { items: [] };
    }
    return { items: demoConnections.map((c) => demoConnectionDto(c)) };
  }
  if (matches(pathname, 'bank-sync/connections') && method === 'DELETE') {
    return demoRemoveConnection(demoIdFromPath(pathname, -1));
  }
  if (matches(pathname, 'bank-sync/links') && method === 'POST') {
    return demoCreateLink(body);
  }
  if (matches(pathname, 'bank-sync/links') && method === 'PATCH') {
    return demoUpdateLink(demoIdFromPath(pathname, -1), body);
  }
  if (matches(pathname, 'bank-sync/links') && method === 'DELETE') {
    return demoRemoveLink(demoIdFromPath(pathname, -1));
  }

  // Backup / SMTP
  if (matches(pathname, 'smtp') && method === 'GET') return null;

  // Mutation: in demo non scriviamo — riportiamo ok
  if (method !== 'GET') {
    return { ok: true, demo: true };
  }

  return null;
}

function matches(pathname: string, pattern: string): boolean {
  // pathname può iniziare con "/api/" o solo "imports/templates" (ky relative)
  // Supporta wildcard ".*" semplice
  const stripped = pathname.replace(/^.*?\/api\//, '').replace(/^\/+/, '');
  if (pattern.includes('.*')) {
    return new RegExp(`^${pattern}$`).test(stripped);
  }
  return stripped === pattern || stripped.startsWith(`${pattern}?`) || stripped.startsWith(`${pattern}/`);
}

// ---------- helpers ----------

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}
function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function buildDashboard(from: string, to: string) {
  const txs = demoDataset.transactions.filter(
    (t) => t.transactionDate >= from && t.transactionDate <= to,
  );
  let income = 0n;
  let expense = 0n;
  for (const t of txs) {
    const c = BigInt(t.amountCents);
    if (t.type === 'income') income += c;
    else if (t.type === 'expense') expense += c < 0n ? -c : c;
  }
  const byCategory = byCategoryFlat(txs, 'expense');
  const byCategoryIncome = byCategoryFlat(txs, 'income');

  // Daily series
  const dailyMap = new Map<string, { incomeCents: bigint; expenseCents: bigint }>();
  for (const t of txs) {
    const d = t.transactionDate;
    const cur = dailyMap.get(d) ?? { incomeCents: 0n, expenseCents: 0n };
    const c = BigInt(t.amountCents);
    if (t.type === 'income') cur.incomeCents += c;
    else if (t.type === 'expense') cur.expenseCents += c < 0n ? -c : c;
    dailyMap.set(d, cur);
  }
  const days = Array.from(dailyMap.keys()).sort();
  let runningBalance = 0n;
  const daily = days.map((d) => {
    const x = dailyMap.get(d)!;
    runningBalance += x.incomeCents - x.expenseCents;
    return {
      date: d,
      incomeCents: x.incomeCents.toString(),
      expenseCents: x.expenseCents.toString(),
      balanceCents: runningBalance.toString(),
    };
  });

  return {
    from,
    to,
    totals: {
      incomeCents: income.toString(),
      expenseCents: expense.toString(),
      netCents: (income - expense).toString(),
      txCount: txs.length,
    },
    byCategory,
    // Le categorie demo sono piatte: gli alberi hanno solo nodi top-level.
    byCategoryTree: asCategoryTree(byCategory),
    byCategoryTreeIncome: asCategoryTree(byCategoryIncome),
    daily,
    recent: txs.slice(0, 10),
  };
}

/**
 * `reports/compare`: due periodi arbitrari con totali e categorie per verso
 * (`categories` uscite, `categoriesIncome` entrate — il selettore della pagina
 * Report sceglie quale mostrare).
 */
function buildPeriodsCompare(search: URLSearchParams) {
  const period = (fromKey: string, toKey: string, fallbackFrom: string) => {
    const from = search.get(fromKey) ?? fallbackFrom;
    const to = search.get(toKey) ?? new Date().toISOString().slice(0, 10);
    const txs = demoDataset.transactions.filter(
      (t) => t.transactionDate >= from && t.transactionDate <= to,
    );
    return {
      from,
      to,
      totals: buildDashboard(from, to).totals,
      categories: byCategoryFlat(txs, 'expense'),
      categoriesIncome: byCategoryFlat(txs, 'income'),
    };
  };
  return {
    period1: period('period1From', 'period1To', isoDaysAgo(60)),
    period2: period('period2From', 'period2To', isoDaysAgo(30)),
  };
}

/**
 * Aggregato per categoria (valore assoluto) del dataset demo. `type` sceglie il
 * verso: la dashboard usa uscite ed entrate per il selettore sulle card KPI.
 */
function byCategoryFlat(txs: Transaction[], type: 'expense' | 'income') {
  const byCatMap = new Map<
    string,
    { categoryId: string | null; categoryName: string; color: string | null; amountCents: bigint; count: number }
  >();
  for (const t of txs) {
    if (t.type !== type) continue;
    const id = t.categoryId ?? '__none__';
    const name = t.category?.name ?? 'Senza categoria';
    const color = t.category?.color ?? null;
    const cur = byCatMap.get(id) ?? { categoryId: t.categoryId, categoryName: name, color, amountCents: 0n, count: 0 };
    const c = BigInt(t.amountCents);
    cur.amountCents += c < 0n ? -c : c;
    cur.count++;
    byCatMap.set(id, cur);
  }
  return Array.from(byCatMap.values())
    .sort((a, b) => Number(b.amountCents - a.amountCents))
    .map((r) => ({ ...r, amountCents: r.amountCents.toString() }));
}

/** Riporta l'aggregato piatto nella forma ad albero attesa dalla dashboard. */
function asCategoryTree(items: ReturnType<typeof byCategoryFlat>) {
  return items.map((i) => ({
    categoryIds: i.categoryId ? [i.categoryId] : [],
    categoryName: i.categoryName,
    color: i.color,
    amountCents: i.amountCents,
    count: i.count,
    children: [],
  }));
}

function buildAnnual(year: number) {
  const byMonth: Array<{ month: number; incomeCents: string; expenseCents: string; netCents: string }> = [];
  let yearIncome = 0n;
  let yearExpense = 0n;
  for (let m = 1; m <= 12; m++) {
    const from = `${year}-${pad(m)}-01`;
    const to = `${year}-${pad(m)}-${pad(daysInMonth(year, m))}`;
    const txs = demoDataset.transactions.filter(
      (t) => t.transactionDate >= from && t.transactionDate <= to,
    );
    let inc = 0n;
    let exp = 0n;
    for (const t of txs) {
      const c = BigInt(t.amountCents);
      if (t.type === 'income') inc += c;
      else if (t.type === 'expense') exp += c < 0n ? -c : c;
    }
    yearIncome += inc;
    yearExpense += exp;
    byMonth.push({
      month: m,
      incomeCents: inc.toString(),
      expenseCents: exp.toString(),
      netCents: (inc - exp).toString(),
    });
  }
  const dash = buildDashboard(`${year}-01-01`, `${year}-12-31`);
  return {
    year,
    totals: dash.totals,
    byMonth,
    byCategory: dash.byCategory,
    // "Top categorie" del report annuale legge gli alberi (uscite/entrate).
    byCategoryTree: dash.byCategoryTree,
    byCategoryTreeIncome: dash.byCategoryTreeIncome,
  };
}

function buildBudgetsWithSpent() {
  const monthStart = (() => {
    const d = new Date();
    d.setUTCDate(1);
    return d.toISOString().slice(0, 10);
  })();
  return demoDataset.budgets.map((b) => {
    const txs = demoDataset.transactions.filter(
      (t) => t.categoryId === b.categoryId && t.transactionDate >= monthStart,
    );
    const spent = txs.reduce((s, t) => {
      const c = BigInt(t.amountCents);
      return s + (c < 0n ? -c : c);
    }, 0n);
    return { ...b, spentCents: spent.toString() };
  });
}

function buildCashflow(months: number, forecastMonths: number) {
  const today = new Date();
  today.setUTCDate(1);
  today.setUTCHours(0, 0, 0, 0);
  const history: Array<{ month: string; income: number; expense: number; net: number; isForecast: boolean }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCMonth(d.getUTCMonth() - i);
    const ym = d.toISOString().slice(0, 7);
    const from = `${ym}-01`;
    const lastDay = pad(daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1));
    const to = `${ym}-${lastDay}`;
    const txs = demoDataset.transactions.filter((t) => t.transactionDate >= from && t.transactionDate <= to);
    let inc = 0;
    let exp = 0;
    for (const t of txs) {
      const c = Number(t.amountCents);
      if (t.type === 'income') inc += c / 100;
      else if (t.type === 'expense') exp += Math.abs(c) / 100;
    }
    history.push({ month: ym, income: inc, expense: exp, net: inc - exp, isForecast: false });
  }
  const forecast: Array<{ month: string; income: number; expense: number; net: number; isForecast: boolean }> = [];
  // Proiezione: media degli ultimi 3 mesi
  const recent = history.slice(-3);
  const avgIncome = recent.reduce((s, r) => s + r.income, 0) / Math.max(1, recent.length);
  const avgExpense = recent.reduce((s, r) => s + r.expense, 0) / Math.max(1, recent.length);
  for (let i = 1; i <= forecastMonths; i++) {
    const d = new Date(today);
    d.setUTCMonth(d.getUTCMonth() + i);
    const ym = d.toISOString().slice(0, 7);
    forecast.push({ month: ym, income: avgIncome, expense: avgExpense, net: avgIncome - avgExpense, isForecast: true });
  }
  let bal = 4200; // saldo iniziale fittizio
  const cumulativeBalance = [...history, ...forecast].map((p) => {
    bal += p.net;
    return { month: p.month, balance: bal, isForecast: p.isForecast };
  });
  return { history, forecast, cumulativeBalance };
}

function buildSankey() {
  const monthStart = (() => {
    const d = new Date();
    d.setUTCDate(1);
    return d.toISOString().slice(0, 10);
  })();
  const txs = demoDataset.transactions.filter((t) => t.transactionDate >= monthStart);
  const incomeByCat = new Map<string, { name: string; total: number }>();
  const expenseByCat = new Map<string, { name: string; total: number }>();
  for (const t of txs) {
    const id = t.categoryId ?? 'none';
    const name = t.category?.name ?? 'Senza categoria';
    const c = Math.abs(Number(t.amountCents)) / 100;
    if (t.type === 'income') {
      const cur = incomeByCat.get(id) ?? { name, total: 0 };
      cur.total += c;
      incomeByCat.set(id, cur);
    } else if (t.type === 'expense') {
      const cur = expenseByCat.get(id) ?? { name, total: 0 };
      cur.total += c;
      expenseByCat.set(id, cur);
    }
  }
  const totalIncome = [...incomeByCat.values()].reduce((s, r) => s + r.total, 0);
  const totalExpense = [...expenseByCat.values()].reduce((s, r) => s + r.total, 0);
  const savings = Math.max(0, totalIncome - totalExpense);
  const nodes: Array<{ id: string; label: string; kind: string }> = [{ id: 'pool', label: 'Budget', kind: 'pool' }];
  const links: Array<{ source: string; target: string; value: number }> = [];
  for (const [id, v] of incomeByCat) {
    const nid = `i:${id}`;
    nodes.push({ id: nid, label: v.name, kind: 'income' });
    links.push({ source: nid, target: 'pool', value: v.total });
  }
  for (const [id, v] of expenseByCat) {
    const nid = `e:${id}`;
    nodes.push({ id: nid, label: v.name, kind: 'expense' });
    links.push({ source: 'pool', target: nid, value: v.total });
  }
  if (savings > 0) {
    nodes.push({ id: 'savings', label: 'Risparmio', kind: 'savings' });
    links.push({ source: 'pool', target: 'savings', value: savings });
  }
  return { nodes, links, period: { from: monthStart.slice(0, 7), to: new Date().toISOString().slice(0, 7) } };
}

function buildCompare(mode: 'mom' | 'yoy') {
  const today = new Date();
  today.setUTCDate(1);
  today.setUTCHours(0, 0, 0, 0);
  const ref = today;
  const prev = new Date(ref);
  if (mode === 'yoy') prev.setUTCFullYear(prev.getUTCFullYear() - 1);
  else prev.setUTCMonth(prev.getUTCMonth() - 1);

  const aggregateMonth = (d: Date) => {
    const ym = d.toISOString().slice(0, 7);
    const from = `${ym}-01`;
    const to = `${ym}-${pad(daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1))}`;
    const txs = demoDataset.transactions.filter((t) => t.transactionDate >= from && t.transactionDate <= to);
    const map = new Map<string, { name: string; expense: number; income: number }>();
    for (const t of txs) {
      const id = t.categoryId ?? '__none__';
      const cur = map.get(id) ?? { name: t.category?.name ?? 'Senza categoria', expense: 0, income: 0 };
      const c = Math.abs(Number(t.amountCents)) / 100;
      if (t.type === 'income') cur.income += c;
      else if (t.type === 'expense') cur.expense += c;
      map.set(id, cur);
    }
    return { ym, map };
  };
  const cur = aggregateMonth(ref);
  const prv = aggregateMonth(prev);
  const allCats = new Set<string>([...cur.map.keys(), ...prv.map.keys()]);
  const rows = [...allCats]
    .map((id) => {
      const c = cur.map.get(id) ?? { name: 'Senza categoria', expense: 0, income: 0 };
      const p = prv.map.get(id) ?? { name: c.name, expense: 0, income: 0 };
      return {
        categoryId: id,
        categoryName: c.name,
        currentExpense: c.expense,
        previousExpense: p.expense,
        currentIncome: c.income,
        previousIncome: p.income,
        deltaExpense: c.expense - p.expense,
        deltaPctExpense: p.expense > 0 ? ((c.expense - p.expense) / p.expense) * 100 : null,
      };
    })
    .sort((a, b) => b.currentExpense - a.currentExpense);
  return {
    mode,
    currentLabel: cur.ym,
    previousLabel: prv.ym,
    rows,
    totals: {
      currentExpense: rows.reduce((s, r) => s + r.currentExpense, 0),
      previousExpense: rows.reduce((s, r) => s + r.previousExpense, 0),
      currentIncome: rows.reduce((s, r) => s + r.currentIncome, 0),
      previousIncome: rows.reduce((s, r) => s + r.previousIncome, 0),
    },
  };
}

// ---------- LLM / Ollama ----------
// Catalogo statico (identico a quello reale, vedi LlmSettingsCard) + un
// piccolo stato in-memory che simula installazione/attivazione/download,
// così la card ha un comportamento credibile anche in modalità demo.

const DEMO_LLM_CATALOG = [
  {
    tag: 'qwen2.5:7b-instruct-q4_K_M',
    displayName: 'Qwen 2.5 7B Instruct',
    downloadSize: '4.7 GB',
    ramRequired: '~6 GB',
    description:
      'Modello di default: buon equilibrio tra qualità di categorizzazione e velocità su CPU.',
    overLimit: false,
  },
  {
    tag: 'llama3.1:8b-instruct-q4_K_M',
    displayName: 'Llama 3.1 8B Instruct',
    downloadSize: '4.9 GB',
    ramRequired: '~6.5 GB',
    description:
      'Modello generalista Meta, buone capacità di ragionamento sulle causali dei movimenti.',
    overLimit: false,
  },
  {
    tag: 'mistral:7b-instruct-v0.3-q4_K_M',
    displayName: 'Mistral 7B Instruct v0.3',
    downloadSize: '4.4 GB',
    ramRequired: '~6 GB',
    description: 'Alternativa leggera e veloce, risposte più concise.',
    overLimit: false,
  },
  {
    tag: 'gemma2:9b-instruct-q4_K_M',
    displayName: 'Gemma 2 9B Instruct',
    downloadSize: '5.4 GB',
    ramRequired: '~9 GB',
    description:
      'Qualità superiore ma occupa quasi tutta la RAM del container: valuta lo spazio disponibile prima di installarlo.',
    overLimit: false,
  },
  {
    tag: 'qwen2.5:3b-instruct-q4_K_M',
    displayName: 'Qwen 2.5 3B Instruct',
    downloadSize: '2.0 GB',
    ramRequired: '~3 GB',
    description: 'Modello compatto e veloce, precisione minore su categorie ambigue.',
    overLimit: false,
  },
  {
    tag: 'phi3.5:3.8b-mini-instruct-q4_K_M',
    displayName: 'Phi 3.5 Mini Instruct',
    downloadSize: '2.2 GB',
    ramRequired: '~3.5 GB',
    description:
      'Modello Microsoft compatto, buon compromesso qualità/dimensione su hardware limitato.',
    overLimit: false,
  },
] as const;

const DEMO_DEFAULT_MODEL = 'qwen2.5:7b-instruct-q4_K_M';
let demoInstalledModels: string[] = [DEMO_DEFAULT_MODEL];
let demoActiveModel: string = DEMO_DEFAULT_MODEL;
let demoPull: { model: string; startedAt: number } | null = null;
const DEMO_PULL_DURATION_MS = 10_000; // download "finto" compresso a 10s

function demoSizeBytes(tag: string): number {
  const item = DEMO_LLM_CATALOG.find((c) => c.tag === tag);
  const m = item?.downloadSize.match(/([\d.]+)/);
  return m ? Math.round(parseFloat(m[1]) * 1_000_000_000) : 4_500_000_000;
}

function demoModelFromBody(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'model' in body) {
    const m = (body as { model?: unknown }).model;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}

function demoLlmSettings() {
  return {
    activeModel: demoActiveModel,
    source: 'db' as const,
    serverOk: true,
    installed: demoInstalledModels.map((tag) => ({
      name: tag,
      sizeBytes: demoSizeBytes(tag),
      parameterSize: tag.match(/(\d+(?:\.\d+)?b)/i)?.[1]?.toUpperCase(),
      quantization: 'Q4_K_M',
      modifiedAt: '2026-01-15T09:00:00.000Z',
    })),
  };
}

function demoPullStatus() {
  if (!demoPull) return { active: false };
  const elapsed = Date.now() - demoPull.startedAt;
  if (elapsed >= DEMO_PULL_DURATION_MS) {
    const { model } = demoPull;
    demoPull = null;
    if (!demoInstalledModels.includes(model)) demoInstalledModels.push(model);
    return { active: false, model, done: true, percent: 100 };
  }
  const percent = Math.min(99, Math.round((elapsed / DEMO_PULL_DURATION_MS) * 100));
  const total = demoSizeBytes(demoPull.model);
  return {
    active: true,
    model: demoPull.model,
    status: 'Download in corso (demo)…',
    percent,
    completedBytes: Math.round((percent / 100) * total),
    totalBytes: total,
  };
}

function demoStartPull(body: unknown) {
  const model = demoModelFromBody(body);
  if (model && DEMO_LLM_CATALOG.some((c) => c.tag === model) && !demoInstalledModels.includes(model)) {
    demoPull = { model, startedAt: Date.now() };
  }
  // Contratto reale: 202 { started: true } (409/400 non simulati in demo).
  return { started: true };
}

function demoRemoveModel(pathname: string) {
  const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '');
  demoInstalledModels = demoInstalledModels.filter((m) => m !== name);
  if (demoActiveModel === name) {
    demoActiveModel = demoInstalledModels[0] ?? DEMO_DEFAULT_MODEL;
  }
  return { ok: true, demo: true };
}

function demoSelectModel(body: unknown) {
  const model = demoModelFromBody(body);
  if (model && demoInstalledModels.includes(model)) {
    demoActiveModel = model;
  }
  return { activeModel: demoActiveModel };
}

// ---------- Sync bancario (demo) ----------
//
// Stato in-memory come per il pull LLM: il ciclo di vita di una connessione
// (pending → linked) è simulato con un timer, così il polling del wizard
// funziona anche senza backend.

const DEMO_INSTITUTIONS = [
  {
    name: 'Intesa Sanpaolo',
    country: 'IT',
    logo: null,
    maximumConsentValidity: 7_776_000,
    psuTypes: ['personal', 'business'],
  },
  {
    name: 'Fineco Bank',
    country: 'IT',
    logo: null,
    maximumConsentValidity: 7_776_000,
    psuTypes: ['personal'],
  },
  {
    name: 'Banco Desio',
    country: 'IT',
    logo: null,
    maximumConsentValidity: 7_776_000,
    psuTypes: ['personal', 'business'],
  },
  {
    name: 'Fideuram',
    country: 'IT',
    logo: null,
    maximumConsentValidity: 5_184_000,
    psuTypes: ['personal'],
  },
  {
    name: 'Revolut',
    country: 'IT',
    logo: null,
    maximumConsentValidity: 7_776_000,
    psuTypes: ['personal'],
  },
] as const;

interface DemoBankLink {
  id: string;
  accountId: string;
  accountName: string;
  providerAccountId: string;
  iban: string | null;
  currency: string;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  /** Saldo dichiarato dalla banca all'ultimo sync (Fase 5), in centesimi. */
  lastBalanceCents: string | null;
  lastBalanceAt: string | null;
}

interface DemoBankConnection {
  id: string;
  institutionName: string;
  institutionLogo: string | null;
  status: 'pending' | 'linked' | 'expired' | 'suspended' | 'revoked' | 'error';
  consentExpiresAt: string | null;
  createdAt: string;
  links: DemoBankLink[];
  /** Timestamp di creazione: dopo qualche secondo il consenso diventa `linked`. */
  pendingSince: number;
}

const DEMO_CONSENT_DELAY_MS = 5_000; // "autorizzazione in banca" compressa a 5s

let demoBankCredentials: { appId: string } | null = {
  appId: 'a1b2c3d4-5566-7788-99aa-bbccddeeff00',
};

let demoConnections: DemoBankConnection[] = [
  {
    id: 'bank-conn-demo-1',
    institutionName: 'Intesa Sanpaolo',
    institutionLogo: null,
    status: 'linked',
    consentExpiresAt: new Date(Date.now() + 62 * 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 28 * 86_400_000).toISOString(),
    links: [
      {
        id: 'bank-link-demo-1',
        accountId: demoDataset.accounts[0].id,
        accountName: demoDataset.accounts[0].name,
        providerAccountId: 'bank-conn-demo-1-acc-1',
        iban: 'IT60X0542811101000000123456',
        currency: 'EUR',
        syncEnabled: true,
        lastSyncAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        // Saldo banca diverso da quello app: mostra la riconciliazione (badge ambra).
        lastBalanceCents: '424250',
        lastBalanceAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      },
      {
        id: 'bank-link-demo-2',
        accountId: demoDataset.accounts[2].id,
        accountName: demoDataset.accounts[2].name,
        providerAccountId: 'bank-conn-demo-1-acc-2',
        iban: 'IT28W8000000292100645211151',
        currency: 'EUR',
        syncEnabled: true,
        lastSyncAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        // Saldo banca allineato a quello app: mostra "Saldo allineato ✓".
        lastBalanceCents: demoDataset.accounts[2].balanceCents,
        lastBalanceAt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      },
    ],
    pendingSince: 0,
  },
];

let demoBankSeq = 1;

/** Sincronizzazioni manuali residue oggi (Fase 3): 4/utente/giorno, in-memory. */
let demoSyncQuotaRemaining = 4;

/** Tetto di orari di sync automatico (limite PSD2), come lato backend. */
const DEMO_MAX_SYNC_TIMES = 4;

/** Orari del sync automatico (`User.bankSyncTimes`): default di sistema. */
let demoBankSyncTimes: string[] = ['06:00'];

/** Replica di `PUT bank-sync/schedule`: valida, deduplica e ordina. */
function demoUpdateSchedule(body: unknown) {
  const raw = ((body ?? {}) as { times?: unknown }).times;
  const list = Array.isArray(raw) ? raw : [];
  const valid = list.filter(
    (t): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):(00|15|30|45)$/.test(t),
  );
  demoBankSyncTimes = [...new Set(valid)].sort().slice(0, DEMO_MAX_SYNC_TIMES);
  return { times: demoBankSyncTimes };
}

function demoStripPath(pathname: string): string {
  return pathname
    .replace(/^.*?\/api\//, '')
    .replace(/^\/+/, '')
    .split('?')[0];
}

/** Segmento del path per indice negativo (-1 = ultimo). */
function demoIdFromPath(pathname: string, index: number): string {
  const parts = demoStripPath(pathname).split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length + index] ?? '');
}

function demoMaskAppId(appId: string): string {
  if (appId.length <= 8) return `${appId.slice(0, 2)}…`;
  return `${appId.slice(0, 4)}…${appId.slice(-4)}`;
}

function demoBankCredentialsStatus() {
  return {
    hasCredentials: !!demoBankCredentials,
    appIdMasked: demoBankCredentials ? demoMaskAppId(demoBankCredentials.appId) : null,
  };
}

function demoSaveBankCredentials(body: unknown) {
  const appId =
    body && typeof body === 'object' && typeof (body as { appId?: unknown }).appId === 'string'
      ? (body as { appId: string }).appId
      : 'demo-app-id';
  demoBankCredentials = { appId };
  return demoBankCredentialsStatus();
}

function demoBankTest() {
  return demoBankCredentials
    ? { ok: true, message: 'Connessione riuscita (demo): 5 banche disponibili per l’Italia.' }
    : { ok: false, message: 'Credenziali non configurate.' };
}

function demoBankCallback(body: unknown) {
  const state =
    body && typeof body === 'object' && typeof (body as { state?: unknown }).state === 'string'
      ? (body as { state: string }).state
      : null;
  // In demo lo `state` coincide con l'id della connessione (vedi authUrl):
  // completare il callback la porta subito a `linked`.
  const conn =
    demoConnections.find((c) => c.id === state) ??
    demoConnections.find((c) => c.status === 'pending');
  if (conn) conn.pendingSince = 0;
  return { ok: true };
}

/** Applica la transizione pending → linked simulata dal timer. */
function demoSettleConnection(conn: DemoBankConnection): DemoBankConnection {
  if (conn.status === 'pending' && Date.now() - conn.pendingSince >= DEMO_CONSENT_DELAY_MS) {
    conn.status = 'linked';
    conn.consentExpiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
  }
  return conn;
}

function demoConnectionDto(conn: DemoBankConnection) {
  const c = demoSettleConnection(conn);
  return {
    id: c.id,
    institutionName: c.institutionName,
    institutionLogo: c.institutionLogo,
    status: c.status,
    consentExpiresAt: c.consentExpiresAt,
    createdAt: c.createdAt,
    links: c.links,
  };
}

function demoConnectionView(id: string) {
  const conn = demoConnections.find((c) => c.id === id);
  return conn ? demoConnectionDto(conn) : null;
}

function demoCreateConnection(body: unknown) {
  const b = (body ?? {}) as { aspspName?: string; institutionLogo?: string };
  const id = `bank-conn-demo-${++demoBankSeq}`;
  demoConnections = [
    ...demoConnections,
    {
      id,
      institutionName: b.aspspName ?? 'Banca demo',
      institutionLogo: b.institutionLogo ?? null,
      status: 'pending',
      consentExpiresAt: null,
      createdAt: new Date().toISOString(),
      links: [],
      pendingSince: Date.now(),
    },
  ];
  return {
    connectionId: id,
    // In demo non esiste una banca da aprire: la pagina di callback finta
    // conferma subito e il polling vede lo stato cambiare da solo.
    authUrl: `${window.location.origin}/bank-sync/callback?code=demo-code&state=${id}`,
  };
}

/**
 * Rinnovo del consenso (Fase 5): riporta la connessione a `pending` con una
 * nuova `authUrl` finta, riusando lo stesso id — il callback demo la fa
 * ripassare a `linked` esattamente come una prima autorizzazione (vedi
 * `demoBankCallback` / `demoSettleConnection`). I link esistenti restano
 * come sono: la demo non simula rimappature o conti persi.
 */
function demoRenewConnection(connectionId: string) {
  const conn = demoConnections.find((c) => c.id === connectionId);
  if (conn) {
    conn.status = 'pending';
    conn.pendingSince = Date.now();
  }
  return {
    connectionId,
    authUrl: `${window.location.origin}/bank-sync/callback?code=demo-code&state=${connectionId}`,
  };
}

function demoProviderAccounts(connectionId: string) {
  const conn = demoConnections.find((c) => c.id === connectionId);
  if (!conn) return { items: [] };
  const linked = new Set(conn.links.map((l) => l.providerAccountId));
  const items = [
    {
      uid: `${conn.id}-acc-1`,
      iban: 'IT60X0542811101000000123456',
      name: 'Conto Corrente',
      currency: 'EUR',
      alreadyLinked: linked.has(`${conn.id}-acc-1`),
    },
    {
      uid: `${conn.id}-acc-2`,
      iban: 'IT28W8000000292100645211151',
      name: 'Conto Deposito',
      currency: 'EUR',
      alreadyLinked: linked.has(`${conn.id}-acc-2`),
    },
  ];
  return { items };
}

function demoCreateLink(body: unknown) {
  const b = (body ?? {}) as {
    connectionId?: string;
    providerAccountId?: string;
    accountId?: string;
    newAccount?: { name?: string };
  };
  const conn = demoConnections.find((c) => c.id === b.connectionId);
  const existing = demoDataset.accounts.find((a) => a.id === b.accountId);
  const link: DemoBankLink = {
    id: `bank-link-demo-${++demoBankSeq}`,
    accountId: existing?.id ?? `demo-account-${demoBankSeq}`,
    accountName: existing?.name ?? b.newAccount?.name ?? 'Nuovo conto',
    providerAccountId: b.providerAccountId ?? 'unknown',
    iban: b.providerAccountId?.endsWith('acc-2')
      ? 'IT28W8000000292100645211151'
      : 'IT60X0542811101000000123456',
    currency: 'EUR',
    syncEnabled: true,
    lastSyncAt: null,
    lastBalanceCents: null,
    lastBalanceAt: null,
  };
  if (conn) conn.links = [...conn.links, link];
  return { link };
}

function demoUpdateLink(linkId: string, body: unknown) {
  const enabled =
    body && typeof body === 'object' && typeof (body as { syncEnabled?: unknown }).syncEnabled === 'boolean'
      ? (body as { syncEnabled: boolean }).syncEnabled
      : true;
  for (const conn of demoConnections) {
    const link = conn.links.find((l) => l.id === linkId);
    if (link) {
      link.syncEnabled = enabled;
      return { link };
    }
  }
  return { link: null };
}

function demoRemoveLink(linkId: string) {
  for (const conn of demoConnections) {
    conn.links = conn.links.filter((l) => l.id !== linkId);
  }
  return { ok: true, demo: true };
}

function demoRemoveConnection(connectionId: string) {
  demoConnections = demoConnections.filter((c) => c.id !== connectionId);
  return { ok: true, demo: true };
}

// ---------- Sync bancario — sincronizzazione manuale (demo, Fase 3) ----------

function demoConsumeSyncQuota(): number {
  demoSyncQuotaRemaining = Math.max(0, demoSyncQuotaRemaining - 1);
  return demoSyncQuotaRemaining;
}

/** Risultato plausibile per un conto: aggiorna anche `lastSyncAt` e la coda di revisione. */
function demoSyncResultForLink(link: DemoBankLink) {
  const fetched = 3 + Math.floor(Math.random() * 8);
  const duplicates = Math.floor(Math.random() * Math.min(fetched, 3));
  const staged = Math.max(0, fetched - duplicates);
  link.lastSyncAt = new Date().toISOString();
  // Le righe finiscono davvero in coda: il contatore e la pagina di revisione
  // restano coerenti anche in demo.
  demoStageRows(link, staged);
  return {
    linkId: link.id,
    accountId: link.accountId,
    accountName: link.accountName,
    fetched,
    staged,
    duplicates,
    skippedCurrency: 0,
    // Riga plausibile non ancora contabilizzata dalla banca: esercita la UI
    // dedicata (SyncSummaryPanel) anche in modalità demo.
    skippedPending: 1,
    error: null,
  };
}

function demoSyncAll() {
  const quotaRemaining = demoConsumeSyncQuota();
  const results = demoConnections
    .filter((c) => c.status === 'linked')
    .flatMap((c) => c.links.filter((l) => l.syncEnabled))
    .map((l) => demoSyncResultForLink(l));
  return { results, quotaRemaining };
}

function demoSyncLink(linkId: string) {
  const quotaRemaining = demoConsumeSyncQuota();
  for (const conn of demoConnections) {
    const link = conn.links.find((l) => l.id === linkId);
    if (link) {
      return { result: demoSyncResultForLink(link), quotaRemaining };
    }
  }
  return {
    result: {
      linkId,
      accountId: '',
      accountName: 'Conto',
      fetched: 0,
      staged: 0,
      duplicates: 0,
      skippedCurrency: 0,
      error: 'Conto collegato non trovato.',
    },
    quotaRemaining,
  };
}

// ---------- Sync bancario — coda di revisione (demo, Fase 4) ----------

type DemoReviewStatus = 'pending_review' | 'duplicate' | 'ignored';

/**
 * Riga di staging in memoria. Il campo `matchedStagedId` replica il pairing
 * reciproco del backend: il DTO lo espande in `pair` leggendo la controparte.
 */
interface DemoReviewItem {
  id: string;
  linkId: string;
  accountId: string;
  accountName: string;
  accountColor: string | null;
  effectiveDate: string;
  amountCents: string;
  currency: string;
  description: string | null;
  counterparty: string | null;
  status: DemoReviewStatus;
  suggestedType: 'income' | 'expense' | 'transfer' | null;
  suggestedConfidence: number | null;
  suggestedCategoryId: string | null;
  finalCategory: { id: string; name: string; color: string | null } | null;
  matchedStagedId: string | null;
  duplicateOf: { transactionId: string; description: string | null; transactionDate: string } | null;
}

function demoCategoryRef(id: string | null) {
  if (!id) return null;
  const c = demoDataset.categories.find((x) => x.id === id);
  return c ? { id: c.id, name: c.name, color: c.color } : null;
}

/** Riga di staging costruita a partire da un conto del dataset demo. */
function demoStagedRow(
  id: string,
  accountIndex: number,
  cents: number,
  description: string,
  daysAgo: number,
  categoryId: string | null,
  confidence: number | null,
  extra: Partial<DemoReviewItem> = {},
): DemoReviewItem {
  const account = demoDataset.accounts[accountIndex];
  return {
    id,
    linkId: 'bank-link-demo-1',
    accountId: account.id,
    accountName: account.name,
    accountColor: account.color,
    effectiveDate: isoDaysAgo(daysAgo),
    amountCents: String(cents),
    currency: 'EUR',
    description,
    counterparty: null,
    status: 'pending_review',
    suggestedType: cents >= 0 ? 'income' : 'expense',
    suggestedConfidence: confidence,
    suggestedCategoryId: categoryId,
    finalCategory: demoCategoryRef(categoryId),
    matchedStagedId: null,
    duplicateOf: null,
    ...extra,
  };
}

let demoReviewItems: DemoReviewItem[] = [
  demoStagedRow('staged-demo-1', 0, -4520, 'ESSELUNGA VIA ROMA 12 MILANO', 1, 'cat-spesa', 0.94),
  demoStagedRow('staged-demo-2', 0, -1299, 'NETFLIX.COM ABBONAMENTO', 1, 'cat-abbon', 0.89),
  demoStagedRow('staged-demo-3', 0, 228500, 'STIPENDIO ACME SPA', 2, 'cat-stipendio', 0.97, {
    counterparty: 'ACME S.p.A.',
  }),
  // Coppia giroconto già accoppiata dal transfer-matcher.
  demoStagedRow('staged-demo-4', 0, -15000, 'PAGAMENTO SALDO CARTA VISA', 2, null, null, {
    suggestedType: 'transfer',
    matchedStagedId: 'staged-demo-5',
  }),
  demoStagedRow('staged-demo-5', 1, 15000, 'ACCREDITO PAGAMENTO CARTA', 2, null, null, {
    suggestedType: 'transfer',
    matchedStagedId: 'staged-demo-4',
  }),
  demoStagedRow('staged-demo-6', 0, -6790, 'Q8 STAZIONE DI SERVIZIO A4', 3, 'cat-trasporti', 0.72),
  demoStagedRow('staged-demo-7', 0, -2350, 'FARMACIA COMUNALE 3', 3, 'cat-salute', 0.58),
  // Sotto la soglia di confidenza: nessuna categoria proposta.
  demoStagedRow('staged-demo-8', 0, -1180, 'BAR CENTRALE', 4, null, null),
  // Probabile duplicato di un movimento inserito a mano.
  demoStagedRow('staged-demo-9', 0, -4990, 'AMAZON.IT ORDINE 402-1180', 5, 'cat-shopping', 0.81, {
    status: 'duplicate',
    duplicateOf: {
      transactionId: 'demo-tx-00042',
      description: 'Amazon — cuffie bluetooth',
      transactionDate: isoDaysAgo(6),
    },
  }),
];

/** Movimenti generati dai sync manuali demo (rotazione su questo pool). */
const DEMO_REVIEW_TEMPLATES: Array<{ desc: string; cents: number; cat: string | null; conf: number | null }> = [
  { desc: 'CONAD CITY VIA VERDI', cents: -3210, cat: 'cat-spesa', conf: 0.91 },
  { desc: 'AMAZON.IT ORDINE 403-2274', cents: -2599, cat: 'cat-shopping', conf: 0.84 },
  { desc: 'ATM MILANO ABBONAMENTO MENSILE', cents: -3900, cat: 'cat-trasporti', conf: 0.77 },
  { desc: 'RISTORANTE DA LUIGI', cents: -4550, cat: 'cat-ristoranti', conf: 0.69 },
  { desc: 'ENEL ENERGIA BOLLETTA LUCE', cents: -8740, cat: 'cat-utenze', conf: 0.93 },
  { desc: 'BONIFICO DA M. ROSSI', cents: 12000, cat: 'cat-extra', conf: 0.61 },
  { desc: 'PARAFARMACIA SAN PAOLO', cents: -1890, cat: null, conf: null },
];

let demoReviewSeq = 100;

/** Aggiunge in coda `count` righe plausibili per il conto appena sincronizzato. */
function demoStageRows(link: DemoBankLink, count: number) {
  const account = demoDataset.accounts.find((a) => a.id === link.accountId);
  const accountIndex = account ? demoDataset.accounts.indexOf(account) : 0;
  for (let i = 0; i < count; i++) {
    const t = DEMO_REVIEW_TEMPLATES[demoReviewSeq % DEMO_REVIEW_TEMPLATES.length];
    demoReviewSeq += 1;
    const row = demoStagedRow(
      `staged-demo-${demoReviewSeq}`,
      accountIndex,
      t.cents,
      t.desc,
      i % 5,
      t.cat,
      t.conf,
    );
    row.linkId = link.id;
    demoReviewItems = [row, ...demoReviewItems];
  }
}

function demoPendingReviewCount(): number {
  return demoReviewItems.filter((i) => i.status === 'pending_review').length;
}

function demoReviewDto(item: DemoReviewItem) {
  const mate = item.matchedStagedId
    ? demoReviewItems.find((i) => i.id === item.matchedStagedId)
    : undefined;
  return {
    id: item.id,
    linkId: item.linkId,
    accountId: item.accountId,
    accountName: item.accountName,
    accountColor: item.accountColor,
    effectiveDate: item.effectiveDate,
    amountCents: item.amountCents,
    currency: item.currency,
    description: item.description,
    counterparty: item.counterparty,
    status: item.status,
    suggestedType: item.suggestedType,
    suggestedConfidence: item.suggestedConfidence,
    suggestedCategoryId: item.suggestedCategoryId,
    finalCategory: item.finalCategory,
    pair: mate
      ? {
          stagedId: mate.id,
          accountId: mate.accountId,
          accountName: mate.accountName,
          effectiveDate: mate.effectiveDate,
          amountCents: mate.amountCents,
        }
      : null,
    duplicateOf: item.duplicateOf,
  };
}

function demoReviewList(status: string | null, pageRaw: string | null, pageSizeRaw: string | null) {
  const wanted: DemoReviewStatus =
    status === 'duplicate' || status === 'ignored' ? status : 'pending_review';
  // Stessi default e clamp del backend (DEFAULT_REVIEW_PAGE_SIZE=50, max 200).
  const pageSize = Math.min(Math.max(Math.trunc(Number(pageSizeRaw)) || 50, 1), 200);
  const page = Math.max(Math.trunc(Number(pageRaw)) || 1, 1);
  const all = demoReviewItems
    .filter((i) => i.status === wanted)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const items = all.slice((page - 1) * pageSize, page * pageSize).map(demoReviewDto);
  // `total` è il conteggio pieno (non paginato), come nell'API reale.
  return { items, total: all.length, page, pageSize };
}

/** Spaia la riga e riporta entrambe le gambe al tipo derivato dal segno. */
function demoUnpairRow(item: DemoReviewItem) {
  const mate = item.matchedStagedId
    ? demoReviewItems.find((i) => i.id === item.matchedStagedId)
    : undefined;
  if (mate) {
    mate.matchedStagedId = null;
    mate.suggestedType = Number(mate.amountCents) >= 0 ? 'income' : 'expense';
  }
  item.matchedStagedId = null;
  item.suggestedType = Number(item.amountCents) >= 0 ? 'income' : 'expense';
}

function demoPatchReview(id: string, body: unknown) {
  const item = demoReviewItems.find((i) => i.id === id);
  if (!item) return { item: null };
  const b = (body ?? {}) as {
    categoryId?: string | null;
    type?: 'income' | 'expense';
    pairWithStagedId?: string | null;
    ignore?: boolean;
    restore?: boolean;
  };

  if ('categoryId' in b) {
    item.finalCategory = demoCategoryRef(b.categoryId ?? null);
  }
  if ((b.type === 'income' || b.type === 'expense') && !item.matchedStagedId) {
    item.suggestedType = b.type;
  }
  if ('pairWithStagedId' in b) {
    if (b.pairWithStagedId) {
      const other = demoReviewItems.find((i) => i.id === b.pairWithStagedId);
      if (other) {
        demoUnpairRow(item);
        demoUnpairRow(other);
        item.matchedStagedId = other.id;
        other.matchedStagedId = item.id;
        item.suggestedType = 'transfer';
        other.suggestedType = 'transfer';
      }
    } else {
      demoUnpairRow(item);
    }
  }
  if (b.ignore) {
    demoUnpairRow(item);
    item.status = 'ignored';
  }
  if (b.restore) {
    item.status = 'pending_review';
    item.duplicateOf = null;
  }
  return { item: demoReviewDto(item) };
}

/**
 * Replica di `POST bank-sync/review/ignore`: le coppie si ignorano intere
 * (l'altra gamba entra d'ufficio, come fa il backend in `ignoreMany`).
 */
function demoIgnoreReview(body: unknown) {
  const raw = (body ?? {}) as { ids?: unknown };
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((x): x is string => typeof x === 'string') : [];

  // Le controparti si raccolgono PRIMA di spaiare, altrimenti il pairing
  // azzerato da demoUnpairRow le renderebbe introvabili.
  const targets = new Set<string>();
  for (const id of ids) {
    const item = demoReviewItems.find((i) => i.id === id);
    if (!item) continue;
    targets.add(item.id);
    if (item.matchedStagedId) targets.add(item.matchedStagedId);
  }

  let ignored = 0;
  for (const id of targets) {
    const item = demoReviewItems.find((i) => i.id === id);
    if (!item) continue;
    demoUnpairRow(item);
    item.status = 'ignored';
    ignored += 1;
  }
  return { ignored, errors: [] };
}

function demoConfirmReview(body: unknown) {
  const raw = (body ?? {}) as { ids?: unknown };
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((x): x is string => typeof x === 'string') : [];

  // Come il backend: le coppie entrano intere anche se in `ids` c'è una gamba sola.
  const targets = new Set<string>();
  let resolved = 0;
  for (const id of ids) {
    const item = demoReviewItems.find((i) => i.id === id && i.status === 'pending_review');
    if (!item) continue;
    resolved += 1;
    targets.add(item.id);
    if (item.matchedStagedId) targets.add(item.matchedStagedId);
  }

  let transfers = 0;
  for (const id of targets) {
    const item = demoReviewItems.find((i) => i.id === id);
    // Una sola volta per coppia: conta la gamba con id "minore".
    if (item?.matchedStagedId && targets.has(item.matchedStagedId) && item.id < item.matchedStagedId) {
      transfers += 1;
    }
  }

  const confirmed = targets.size;
  demoReviewItems = demoReviewItems.filter((i) => !targets.has(i.id));
  return { confirmed, transfers, skipped: ids.length - resolved, errors: [] };
}
