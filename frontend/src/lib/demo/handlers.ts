/**
 * Router delle risposte demo: matcha l'URL della richiesta e produce
 * l'oggetto da serializzare. Quando il dataset non copre un endpoint,
 * ritorniamo `null` e il chiamante (interceptor in `client.ts`) lascia
 * passare la richiesta normalmente — ma in modalità demo accettiamo solo
 * GET, le mutation diventano un 200 vuoto così la UI non si rompe.
 */

import { demoDataset } from './data';

interface Ctx {
  pathname: string;
  search: URLSearchParams;
  method: string;
}

export function demoHandle(ctx: Ctx): unknown | null {
  const { pathname, search, method } = ctx;

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
    const from = search.get('from');
    const to = search.get('to');
    const q = (search.get('search') ?? '').toLowerCase();
    const limit = Number(search.get('limit') ?? '50');
    const page = Number(search.get('page') ?? '1');
    const filtered = all.filter((tx) => {
      if (accountId && tx.accountId !== accountId) return false;
      if (categoryId && tx.categoryId !== categoryId) return false;
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
  const byCatMap = new Map<
    string,
    { categoryId: string | null; categoryName: string; color: string | null; amountCents: bigint; count: number }
  >();
  for (const t of txs) {
    if (t.type !== 'expense') continue;
    const id = t.categoryId ?? '__none__';
    const name = t.category?.name ?? 'Senza categoria';
    const color = t.category?.color ?? null;
    const cur = byCatMap.get(id) ?? { categoryId: t.categoryId, categoryName: name, color, amountCents: 0n, count: 0 };
    const c = BigInt(t.amountCents);
    cur.amountCents += c < 0n ? -c : c;
    cur.count++;
    byCatMap.set(id, cur);
  }
  const byCategory = Array.from(byCatMap.values())
    .sort((a, b) => Number(b.amountCents - a.amountCents))
    .map((r) => ({ ...r, amountCents: r.amountCents.toString() }));

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
    daily,
    recent: txs.slice(0, 10),
  };
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
