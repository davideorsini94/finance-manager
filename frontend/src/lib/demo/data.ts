/**
 * Dataset finto per la modalità demo. È pensato per dare l'impressione di
 * un'app "popolata": 3 conti, 12 categorie, ~80 transazioni distribuite
 * negli ultimi 6 mesi, 3 budget, 2 obiettivi, 2 ricorrenze.
 *
 * Ogni record è generato in modo deterministico (seed fisso) così il demo
 * è riproducibile e le dashboard hanno sempre lo stesso aspetto.
 */

import type {
  Account,
  AttachmentSummary,
  AuthUser,
  Category,
  Transaction,
  TransactionType,
} from '@/types/domain';

const ME: AuthUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'demo@example.com',
  fullName: 'Mario Rossi',
  role: 'user',
  locale: 'it',
  isActive: true,
  favoriteAccountId: null,
  createdAt: '2024-01-15T10:00:00Z',
};

const OWNER_SUMMARY = { id: ME.id, email: ME.email, fullName: ME.fullName };

const ACCOUNTS: Account[] = [
  {
    id: '10000000-0000-0000-0000-000000000001',
    name: 'Conto principale',
    type: 'checking',
    currency: 'EUR',
    balanceCents: '420000',
    ownerId: ME.id,
    paymentAccountId: null,
    billingDay: null,
    color: '#3b82f6',
    icon: 'Wallet',
    archivedAt: null,
    createdAt: '2024-01-15T10:00:00Z',
    owner: OWNER_SUMMARY,
    members: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    name: 'Carta Visa',
    type: 'credit_card',
    currency: 'EUR',
    balanceCents: '-85000',
    ownerId: ME.id,
    paymentAccountId: '10000000-0000-0000-0000-000000000001',
    billingDay: 15,
    color: '#8b5cf6',
    icon: 'CreditCard',
    archivedAt: null,
    createdAt: '2024-02-01T10:00:00Z',
    owner: OWNER_SUMMARY,
    members: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000003',
    name: 'Contanti',
    type: 'cash',
    currency: 'EUR',
    balanceCents: '12000',
    ownerId: ME.id,
    paymentAccountId: null,
    billingDay: null,
    color: '#10b981',
    icon: 'Banknote',
    archivedAt: null,
    createdAt: '2024-01-20T10:00:00Z',
    owner: OWNER_SUMMARY,
    members: [],
  },
];

const CATEGORIES: Category[] = [
  { id: 'cat-stipendio', userId: ME.id, parentId: null, name: 'Stipendio', color: '#4f8d5e', icon: 'Briefcase', isIncome: true, sortOrder: 0, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-extra', userId: ME.id, parentId: null, name: 'Entrate extra', color: '#3a6b96', icon: 'Sparkles', isIncome: true, sortOrder: 1, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-casa', userId: ME.id, parentId: null, name: 'Casa', color: '#ae6a3c', icon: 'Home', isIncome: false, sortOrder: 0, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-affitto', userId: ME.id, parentId: 'cat-casa', name: 'Affitto', color: '#ae6a3c', icon: 'Home', isIncome: false, sortOrder: 0, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-utenze', userId: ME.id, parentId: 'cat-casa', name: 'Utenze', color: '#ae6a3c', icon: 'Zap', isIncome: false, sortOrder: 1, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-spesa', userId: ME.id, parentId: null, name: 'Spesa', color: '#6f5599', icon: 'ShoppingCart', isIncome: false, sortOrder: 1, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-trasporti', userId: ME.id, parentId: null, name: 'Trasporti', color: '#3a8c7c', icon: 'Car', isIncome: false, sortOrder: 2, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-ristoranti', userId: ME.id, parentId: null, name: 'Ristoranti', color: '#a68a38', icon: 'Utensils', isIncome: false, sortOrder: 3, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-svago', userId: ME.id, parentId: null, name: 'Svago', color: '#8e4f86', icon: 'Film', isIncome: false, sortOrder: 4, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-salute', userId: ME.id, parentId: null, name: 'Salute', color: '#50589b', icon: 'Heart', isIncome: false, sortOrder: 5, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-abbon', userId: ME.id, parentId: null, name: 'Abbonamenti', color: '#2f7f8e', icon: 'Repeat', isIncome: false, sortOrder: 6, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'cat-shopping', userId: ME.id, parentId: null, name: 'Shopping', color: '#7f8c3c', icon: 'ShoppingBag', isIncome: false, sortOrder: 7, createdAt: '2024-01-15T10:00:00Z' },
];

// Mulberry32 seedable PRNG
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TX_TEMPLATES: Array<{
  catId: string;
  desc: string;
  account: number;
  type: TransactionType;
  min: number;
  max: number;
  weight: number;
}> = [
  { catId: 'cat-stipendio', desc: 'Stipendio', account: 0, type: 'income', min: 220000, max: 240000, weight: 1 },
  { catId: 'cat-extra', desc: 'Bonifico extra', account: 0, type: 'income', min: 5000, max: 50000, weight: 1 },
  { catId: 'cat-affitto', desc: 'Affitto appartamento', account: 0, type: 'expense', min: 80000, max: 80000, weight: 1 },
  { catId: 'cat-utenze', desc: 'Bolletta luce', account: 0, type: 'expense', min: 4000, max: 9000, weight: 1 },
  { catId: 'cat-utenze', desc: 'Bolletta gas', account: 0, type: 'expense', min: 5000, max: 12000, weight: 1 },
  { catId: 'cat-utenze', desc: 'Internet fibra', account: 0, type: 'expense', min: 2999, max: 2999, weight: 1 },
  { catId: 'cat-spesa', desc: 'Esselunga', account: 1, type: 'expense', min: 3000, max: 12000, weight: 8 },
  { catId: 'cat-spesa', desc: 'Conad', account: 1, type: 'expense', min: 1500, max: 8000, weight: 5 },
  { catId: 'cat-spesa', desc: 'Mercato', account: 2, type: 'expense', min: 800, max: 3500, weight: 3 },
  { catId: 'cat-trasporti', desc: 'Benzina', account: 1, type: 'expense', min: 4000, max: 7500, weight: 4 },
  { catId: 'cat-trasporti', desc: 'Abbonamento ATM', account: 0, type: 'expense', min: 3500, max: 3500, weight: 1 },
  { catId: 'cat-trasporti', desc: 'Taxi', account: 1, type: 'expense', min: 800, max: 2500, weight: 2 },
  { catId: 'cat-ristoranti', desc: 'Pizzeria da Mario', account: 1, type: 'expense', min: 1500, max: 4500, weight: 4 },
  { catId: 'cat-ristoranti', desc: 'Sushi', account: 1, type: 'expense', min: 2500, max: 6000, weight: 2 },
  { catId: 'cat-ristoranti', desc: 'Bar colazione', account: 2, type: 'expense', min: 200, max: 600, weight: 6 },
  { catId: 'cat-svago', desc: 'Cinema', account: 1, type: 'expense', min: 800, max: 2500, weight: 2 },
  { catId: 'cat-svago', desc: 'Concerto', account: 1, type: 'expense', min: 3000, max: 8000, weight: 1 },
  { catId: 'cat-salute', desc: 'Farmacia', account: 1, type: 'expense', min: 1000, max: 3500, weight: 2 },
  { catId: 'cat-salute', desc: 'Visita medica', account: 0, type: 'expense', min: 5000, max: 15000, weight: 1 },
  { catId: 'cat-abbon', desc: 'Netflix', account: 1, type: 'expense', min: 1599, max: 1599, weight: 1 },
  { catId: 'cat-abbon', desc: 'Spotify', account: 1, type: 'expense', min: 1099, max: 1099, weight: 1 },
  { catId: 'cat-abbon', desc: 'Palestra', account: 0, type: 'expense', min: 4500, max: 4500, weight: 1 },
  { catId: 'cat-shopping', desc: 'Amazon', account: 1, type: 'expense', min: 1500, max: 9000, weight: 4 },
  { catId: 'cat-shopping', desc: 'Zalando', account: 1, type: 'expense', min: 3000, max: 12000, weight: 2 },
];

function pickWeighted<T extends { weight: number }>(rand: () => number, items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rand() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function generateTransactions(): Transaction[] {
  const out: Transaction[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCMonth(start.getUTCMonth() - 6);

  // Eventi ricorrenti mensili (stipendio, affitto, abbonamenti)
  const recurringTemplates = TX_TEMPLATES.filter((t) =>
    ['Stipendio', 'Affitto appartamento', 'Internet fibra', 'Netflix', 'Spotify', 'Palestra', 'Abbonamento ATM'].includes(t.desc),
  );
  for (let mo = 0; mo <= 6; mo++) {
    const date = new Date(start);
    date.setUTCMonth(date.getUTCMonth() + mo);
    if (date > today) break;
    let dayOffset = 1;
    for (const tpl of recurringTemplates) {
      const d = new Date(date);
      d.setUTCDate(dayOffset);
      dayOffset += 3;
      if (d > today) continue;
      out.push(buildTx(tpl, d, out.length, ((tpl.min + tpl.max) / 2) | 0));
    }
  }

  // Eventi sparsi (~10/mese)
  const eventTemplates = TX_TEMPLATES.filter((t) => !recurringTemplates.includes(t));
  const rand = rng(42);
  const span = Math.floor((today.getTime() - start.getTime()) / 86400_000);
  const total = 80;
  for (let i = 0; i < total; i++) {
    const dayOffset = Math.floor(rand() * span);
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    const tpl = pickWeighted(rand, eventTemplates);
    const amount = tpl.min + Math.floor(rand() * (tpl.max - tpl.min + 1));
    out.push(buildTx(tpl, d, out.length + 1000, amount));
  }

  out.sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));
  return out;
}

function buildTx(
  tpl: (typeof TX_TEMPLATES)[number],
  date: Date,
  seq: number,
  amount: number,
): Transaction {
  const acc = ACCOUNTS[tpl.account];
  const cat = CATEGORIES.find((c) => c.id === tpl.catId)!;
  const cents = tpl.type === 'income' ? amount : -amount;
  return {
    id: `demo-tx-${seq.toString().padStart(5, '0')}`,
    accountId: acc.id,
    userId: ME.id,
    amountCents: cents.toString(),
    type: tpl.type,
    categoryId: cat.id,
    description: tpl.desc,
    notes: null,
    transactionDate: date.toISOString().slice(0, 10),
    transferPairId: null,
    ccChargeId: null,
    recurringRuleId: null,
    importBatchId: null,
    isPending: false,
    category: { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon, isIncome: cat.isIncome },
    account: { id: acc.id, name: acc.name, type: acc.type },
    attachments: [] as AttachmentSummary[],
  };
}

const TRANSACTIONS = generateTransactions();

const BUDGETS = [
  { id: 'budget-1', userId: ME.id, categoryId: 'cat-spesa', month: monthStartIso(0), limitCents: '50000', createdAt: '2024-01-15T10:00:00Z', category: pickCat('cat-spesa') },
  { id: 'budget-2', userId: ME.id, categoryId: 'cat-ristoranti', month: monthStartIso(0), limitCents: '15000', createdAt: '2024-01-15T10:00:00Z', category: pickCat('cat-ristoranti') },
  { id: 'budget-3', userId: ME.id, categoryId: 'cat-svago', month: monthStartIso(0), limitCents: '10000', createdAt: '2024-01-15T10:00:00Z', category: pickCat('cat-svago') },
];

function pickCat(id: string) {
  const c = CATEGORIES.find((x) => x.id === id)!;
  return { id: c.id, name: c.name, color: c.color, icon: c.icon, isIncome: c.isIncome };
}

const GOALS = [
  {
    id: 'goal-1',
    userId: ME.id,
    accountId: ACCOUNTS[0].id,
    name: 'Vacanza estate',
    targetCents: '200000',
    currentCents: '85000',
    deadline: monthStartIso(3),
    isCompleted: false,
    createdAt: '2024-04-01T10:00:00Z',
  },
  {
    id: 'goal-2',
    userId: ME.id,
    accountId: ACCOUNTS[0].id,
    name: 'Fondo emergenza',
    targetCents: '500000',
    currentCents: '320000',
    deadline: null,
    isCompleted: false,
    createdAt: '2024-01-15T10:00:00Z',
  },
];

const RECURRING = [
  {
    id: 'rec-1',
    userId: ME.id,
    accountId: ACCOUNTS[0].id,
    categoryId: 'cat-stipendio',
    amountCents: '230000',
    type: 'income' as const,
    description: 'Stipendio',
    frequency: 'monthly',
    startDate: '2024-01-01',
    endDate: null,
    nextRunDate: nextMonthIso(1),
    isActive: true,
    createdAt: '2024-01-01T10:00:00Z',
    account: { id: ACCOUNTS[0].id, name: ACCOUNTS[0].name },
    category: pickCat('cat-stipendio'),
  },
  {
    id: 'rec-2',
    userId: ME.id,
    accountId: ACCOUNTS[0].id,
    categoryId: 'cat-affitto',
    amountCents: '80000',
    type: 'expense' as const,
    description: 'Affitto',
    frequency: 'monthly',
    startDate: '2024-01-05',
    endDate: null,
    nextRunDate: nextMonthIso(5),
    isActive: true,
    createdAt: '2024-01-01T10:00:00Z',
    account: { id: ACCOUNTS[0].id, name: ACCOUNTS[0].name },
    category: pickCat('cat-affitto'),
  },
];

function monthStartIso(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}

function nextMonthIso(day: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10);
}

export const demoDataset = {
  me: ME,
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  transactions: TRANSACTIONS,
  budgets: BUDGETS,
  goals: GOALS,
  recurring: RECURRING,
};

export type DemoDataset = typeof demoDataset;
