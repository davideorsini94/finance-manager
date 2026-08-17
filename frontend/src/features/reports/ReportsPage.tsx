import { useMemo, useRef, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ChevronRight, Loader2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AccountMultiSelect } from '@/components/shared/AccountMultiSelect';
import { accountsApi } from '@/features/accounts/accountsApi';
import { sortByName } from '@/lib/utils/sort';
import {
  reportsApi,
  type CategoryBreakdownItem,
  type CategoryNode,
} from '@/features/dashboard/dashboardApi';
import {
  FLOW_UI,
  FlowHint,
  flowSelectProps,
  type Flow,
} from '@/features/dashboard/flow';
import { transactionsApi } from '@/features/transactions/transactionsApi';
import { formatCents } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';
import { revealIfOffscreen } from '@/lib/utils/reveal';
import type { PageResult, Transaction } from '@/types/domain';

type Mode = 'annual' | 'monthly' | 'compare';

/** Contesto periodo/conti/flusso propagato al drill-down dei singoli movimenti. */
interface DrillContext {
  from: string;
  to: string;
  accountIds: string[];
  accountIdsKey: string[];
  /** Uscite o entrate: filtra le transazioni del drill-down e i testi. */
  flow: Flow;
}

const PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export function ReportsPage() {
  const [mode, setMode] = useState<Mode>('annual');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  // Come sulla dashboard: le card KPI Entrate/Uscite scelgono il verso degli
  // aggregati per categoria (default uscite). Vale per tutte le modalità.
  const [flow, setFlow] = useState<Flow>('expense');
  const breakdownRef = useRef<HTMLDivElement>(null);

  /** Cambia flusso dal click su una card, mostrando il dettaglio per categoria. */
  const selectFlow = (next: Flow) => {
    setFlow(next);
    revealIfOffscreen(breakdownRef.current);
  };
  /** Props delle due card KPI cliccabili, uguali in tutte le modalità. */
  const kpiSelect = (target: Flow) => ({
    active: flow === target,
    onSelect: () => selectFlow(target),
    hint: `Mostra le ${FLOW_UI[target].name} per categoria`,
  });

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const twoMonthsAgo = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);

  const [p1From, setP1From] = useState(twoMonthsAgo);
  const [p1To, setP1To] = useState(monthAgo);
  const [p2From, setP2From] = useState(monthAgo);
  const [p2To, setP2To] = useState(today);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  });
  const accounts = useMemo(
    () => sortByName(accountsQuery.data ?? []),
    [accountsQuery.data],
  );
  // Cache key stabile a prescindere dall'ordine di selezione
  const accountIdsKey = useMemo(() => [...accountIds].sort(), [accountIds]);

  const annualQuery = useQuery({
    queryKey: ['report', 'annual', year, accountIdsKey],
    queryFn: () =>
      reportsApi.annual(year, accountIds.length > 0 ? accountIds : undefined),
    enabled: mode === 'annual',
  });

  const monthlyQuery = useQuery({
    queryKey: ['report', 'monthly', year, month, accountIdsKey],
    queryFn: () =>
      reportsApi.monthly(year, month, accountIds.length > 0 ? accountIds : undefined),
    enabled: mode === 'monthly',
  });

  // Periodo/conti propagati ai drill-down per filtrare le singole transazioni.
  const annualCtx: DrillContext = {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    accountIds,
    accountIdsKey,
    flow,
  };
  const monthlyCtx: DrillContext = {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: monthlyQuery.data?.to?.slice(0, 10) ?? lastDayOfMonth(year, month),
    accountIds,
    accountIdsKey,
    flow,
  };

  const compareQuery = useQuery({
    queryKey: ['report', 'compare', p1From, p1To, p2From, p2To, accountIdsKey],
    queryFn: () =>
      reportsApi.compare(
        p1From,
        p1To,
        p2From,
        p2To,
        accountIds.length > 0 ? accountIds : undefined,
      ),
    enabled: mode === 'compare',
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Report</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AccountMultiSelect
            accounts={accounts}
            value={accountIds}
            onChange={setAccountIds}
          />
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="annual">Riepilogo annuale</SelectItem>
              <SelectItem value="monthly">Riepilogo mensile</SelectItem>
              <SelectItem value="compare">Confronto periodi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {mode === 'annual' && (
        <>
          <div className="flex items-center gap-2">
            <Label htmlFor="year">Anno</Label>
            <Input
              id="year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || year)}
              className="w-32"
            />
          </div>

          {annualQuery.data && (
            <div className="space-y-4">
              {/* Entrate/Uscite selezionano il verso di "Top categorie" */}
              <div className="grid gap-4 md:grid-cols-3">
                <KpiCard
                  label="Entrate"
                  value={annualQuery.data.totals.incomeCents}
                  tone="emerald"
                  select={kpiSelect('income')}
                />
                <KpiCard
                  label="Uscite"
                  value={annualQuery.data.totals.expenseCents}
                  tone="red"
                  select={kpiSelect('expense')}
                />
                <KpiCard label="Netto" value={annualQuery.data.totals.netCents} tone="primary" />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Mensile</CardTitle>
                  <CardDescription>Entrate e uscite per ogni mese</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={annualQuery.data.byMonth.map((m) => ({
                        month: monthLabel(m.month),
                        Entrate: Number(m.incomeCents) / 100,
                        Uscite: Number(m.expenseCents) / 100,
                        Netto: Number(m.netCents) / 100,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" fontSize={12} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={12} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 'var(--radius)',
                          color: 'hsl(var(--popover-foreground))',
                        }}
                        itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                        labelStyle={{ color: 'hsl(var(--popover-foreground))', fontWeight: 600 }}
                        formatter={(value: number) => formatCents(value * 100)}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Entrate" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Uscite" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card ref={breakdownRef} className="scroll-mt-4">
                <CardHeader>
                  <CardTitle className="text-base">
                    Top categorie · {FLOW_UI[flow].name}
                  </CardTitle>
                  <CardDescription>
                    Clicca una categoria per espandere le sottocategorie e i singoli movimenti
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CategoryTree
                    data={
                      flow === 'income'
                        ? annualQuery.data.byCategoryTreeIncome
                        : annualQuery.data.byCategoryTree
                    }
                    ctx={annualCtx}
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {mode === 'monthly' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="m-year">Anno</Label>
            <Input
              id="m-year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || year)}
              className="w-28"
            />
            <Label htmlFor="m-month">Mese</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger id="m-month" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {monthName(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {monthlyQuery.data && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <KpiCard
                  label="Entrate"
                  value={monthlyQuery.data.totals.incomeCents}
                  tone="emerald"
                  select={kpiSelect('income')}
                />
                <KpiCard
                  label="Uscite"
                  value={monthlyQuery.data.totals.expenseCents}
                  tone="red"
                  select={kpiSelect('expense')}
                />
                <KpiCard label="Netto" value={monthlyQuery.data.totals.netCents} tone="primary" />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Andamento giornaliero</CardTitle>
                  <CardDescription>Entrate e uscite per ogni giorno del mese</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={monthlyQuery.data.daily.map((d) => ({
                        day: d.date.slice(8, 10),
                        Entrate: Number(d.incomeCents) / 100,
                        Uscite: Number(d.expenseCents) / 100,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="day" fontSize={12} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={12} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 'var(--radius)',
                          color: 'hsl(var(--popover-foreground))',
                        }}
                        itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                        labelStyle={{ color: 'hsl(var(--popover-foreground))', fontWeight: 600 }}
                        formatter={(value: number) => formatCents(value * 100)}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Entrate" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Uscite" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card ref={breakdownRef} className="scroll-mt-4">
                <CardHeader>
                  <CardTitle className="text-base">
                    Top categorie · {FLOW_UI[flow].name}
                  </CardTitle>
                  <CardDescription>
                    Clicca una categoria per espandere le sottocategorie e i singoli movimenti
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CategoryTree
                    data={
                      flow === 'income'
                        ? monthlyQuery.data.byCategoryTreeIncome
                        : monthlyQuery.data.byCategoryTree
                    }
                    ctx={monthlyCtx}
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {mode === 'compare' && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Periodo 1</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Input type="date" value={p1From} onChange={(e) => setP1From(e.target.value)} />
                <Input type="date" value={p1To} onChange={(e) => setP1To(e.target.value)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Periodo 2</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Input type="date" value={p2From} onChange={(e) => setP2From(e.target.value)} />
                <Input type="date" value={p2To} onChange={(e) => setP2To(e.target.value)} />
              </CardContent>
            </Card>
          </div>

          {compareQuery.data && (
            <>
              {/* Anche qui Entrate/Uscite sono cliccabili: cambiano la torta di
                  ENTRAMBE le colonne, così il confronto resta omogeneo. */}
              <div ref={breakdownRef} className="grid gap-4 md:grid-cols-2 scroll-mt-4">
                <ComparisonColumn
                  title="Periodo 1"
                  totals={compareQuery.data.period1.totals}
                  categories={
                    flow === 'income'
                      ? compareQuery.data.period1.categoriesIncome
                      : compareQuery.data.period1.categories
                  }
                  flow={flow}
                  onSelectFlow={selectFlow}
                />
                <ComparisonColumn
                  title="Periodo 2"
                  totals={compareQuery.data.period2.totals}
                  categories={
                    flow === 'income'
                      ? compareQuery.data.period2.categoriesIncome
                      : compareQuery.data.period2.categories
                  }
                  flow={flow}
                  onSelectFlow={selectFlow}
                />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Delta totali</CardTitle>
                </CardHeader>
                <CardContent>
                  <DeltaRow
                    label="Entrate"
                    a={compareQuery.data.period1.totals.incomeCents}
                    b={compareQuery.data.period2.totals.incomeCents}
                  />
                  <DeltaRow
                    label="Uscite"
                    a={compareQuery.data.period1.totals.expenseCents}
                    b={compareQuery.data.period2.totals.expenseCents}
                  />
                  <DeltaRow
                    label="Netto"
                    a={compareQuery.data.period1.totals.netCents}
                    b={compareQuery.data.period2.totals.netCents}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Card KPI del report. Con `select` diventa cliccabile (e raggiungibile da
 * tastiera): Entrate/Uscite scelgono il verso di "Top categorie", come sulla
 * dashboard.
 */
function KpiCard({
  label,
  value,
  tone,
  select,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'red' | 'primary';
  select?: { active: boolean; hint: string; onSelect: () => void };
}) {
  const cls =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'red'
        ? 'text-red-600 dark:text-red-400'
        : '';
  return (
    <Card
      className={cn(
        select && 'cursor-pointer transition-shadow hover:shadow-md',
        select?.active && `ring-2 ${tone === 'emerald' ? FLOW_UI.income.ring : FLOW_UI.expense.ring}`,
      )}
      {...(select ? flowSelectProps(select) : {})}
    >
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          {label}
          {select && <FlowHint active={select.active} />}
        </CardDescription>
        <CardTitle className={`text-2xl tabular-nums ${cls}`}>{formatCents(value)}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function ComparisonColumn({
  title,
  totals,
  categories,
  flow,
  onSelectFlow,
}: {
  title: string;
  totals: { incomeCents: string; expenseCents: string; netCents: string };
  categories: CategoryBreakdownItem[];
  flow: Flow;
  onSelectFlow: (next: Flow) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <TotalCell
            label="Entrate"
            value={totals.incomeCents}
            valueClassName="text-emerald-600 dark:text-emerald-400"
            select={{
              active: flow === 'income',
              hint: 'Mostra le entrate per categoria',
              onSelect: () => onSelectFlow('income'),
            }}
            activeClassName="bg-emerald-500/10 ring-1 ring-emerald-500/40"
          />
          <TotalCell
            label="Uscite"
            value={totals.expenseCents}
            valueClassName="text-red-600 dark:text-red-400"
            select={{
              active: flow === 'expense',
              hint: 'Mostra le spese per categoria',
              onSelect: () => onSelectFlow('expense'),
            }}
            activeClassName="bg-red-500/10 ring-1 ring-red-500/40"
          />
          <TotalCell label="Netto" value={totals.netCents} />
        </div>
        <div className="h-[200px]">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center pt-12">
              {FLOW_UI[flow].emptyChart}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories.slice(0, 6).map((c) => ({
                    name: c.categoryName,
                    value: Number(c.amountCents) / 100,
                    color: c.color,
                  }))}
                  dataKey="value"
                  innerRadius={40}
                  outerRadius={75}
                >
                  {categories.slice(0, 6).map((c, i) => (
                    <Cell key={i} fill={c.color ?? PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 'var(--radius)',
                    color: 'hsl(var(--popover-foreground))',
                  }}
                  itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                  labelStyle={{ color: 'hsl(var(--popover-foreground))', fontWeight: 600 }}
                  formatter={(value: number) => formatCents(value * 100)}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Cella di un totale nella colonna di confronto. Con `select` è un `<button>`
 * che cambia il verso della torta sotto (in questa modalità non ci sono card KPI
 * grandi: il click sta sui totali).
 */
function TotalCell({
  label,
  value,
  valueClassName,
  select,
  activeClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  select?: { active: boolean; hint: string; onSelect: () => void };
  activeClassName?: string;
}) {
  const content = (
    <>
      <p className="text-muted-foreground">{label}</p>
      <p className={cn('font-semibold tabular-nums', valueClassName)}>{formatCents(value)}</p>
    </>
  );
  if (!select) return <div className="rounded-md px-1 py-1">{content}</div>;
  return (
    <button
      type="button"
      onClick={select.onSelect}
      aria-pressed={select.active}
      title={select.hint}
      className={cn(
        'rounded-md px-1 py-1 transition-colors',
        select.active ? activeClassName : 'hover:bg-muted/60',
      )}
    >
      {content}
    </button>
  );
}

/**
 * Lista gerarchica delle categorie: categorie padre → sottocategorie → singoli
 * movimenti (uscite o entrate secondo `ctx.flow`). Ogni livello si espande al click.
 */
function CategoryTree({ data, ctx }: { data: CategoryNode[]; ctx: DrillContext }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Nessun dato.</p>;
  const total = data.reduce((acc, c) => acc + Number(c.amountCents), 0);
  return (
    <ul className="space-y-1">
      {data.map((node, i) => (
        <CategoryRow
          key={node.categoryIds[0] ?? `${node.categoryName}-${i}`}
          node={node}
          total={total}
          ctx={ctx}
        />
      ))}
    </ul>
  );
}

function CategoryRow({
  node,
  total,
  ctx,
}: {
  node: CategoryNode;
  total: number;
  ctx: DrillContext;
}) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  // Foglia drillabile fino alle singole spese (la voce "Senza categoria" senza
  // figli non è drillabile perché non filtrabile per categoria nulla).
  const isDrillable = !hasChildren && node.categoryIds.length > 0;
  const canExpand = hasChildren || isDrillable;
  const pct = total > 0 ? (Number(node.amountCents) / total) * 100 : 0;

  const txQuery = useQuery({
    // `ctx.flow` fa parte della chiave: uscite ed entrate della stessa categoria
    // sono due risultati diversi e non devono condividere la cache.
    queryKey: ['report-tx', node.categoryIds, ctx.from, ctx.to, ctx.accountIdsKey, ctx.flow],
    queryFn: () =>
      transactionsApi.list({
        categoryIds: node.categoryIds,
        type: ctx.flow,
        from: ctx.from,
        to: ctx.to,
        accountIds: ctx.accountIds.length > 0 ? ctx.accountIds : undefined,
        limit: 100,
      }),
    enabled: open && isDrillable,
  });

  return (
    <li>
      <button
        type="button"
        onClick={() => canExpand && setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left ${
          canExpand ? 'hover:bg-muted/60 cursor-pointer' : 'cursor-default'
        }`}
        aria-expanded={canExpand ? open : undefined}
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            canExpand ? '' : 'opacity-0'
          } ${open ? 'rotate-90' : ''}`}
        />
        <span
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: node.color ?? 'hsl(var(--muted-foreground))' }}
        />
        <span className="flex-1 truncate text-sm">{node.categoryName}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{pct.toFixed(0)}%</span>
        <span className="font-medium tabular-nums w-24 text-right">
          {formatCents(node.amountCents)}
        </span>
      </button>

      {open && hasChildren && (
        <ul className="ml-4 border-l pl-2 space-y-1">
          {node.children.map((child, i) => (
            <CategoryRow
              key={child.categoryIds[0] ?? `${node.categoryName}-direct-${i}`}
              node={child}
              total={Number(node.amountCents)}
              ctx={ctx}
            />
          ))}
        </ul>
      )}

      {open && isDrillable && (
        <div className="ml-4 border-l pl-2">
          <TransactionRows query={txQuery} flow={ctx.flow} />
        </div>
      )}
    </li>
  );
}

function TransactionRows({
  query,
  flow,
}: {
  query: UseQueryResult<PageResult<Transaction>>;
  flow: Flow;
}) {
  const plural = FLOW_UI[flow].itemsPlural;
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Caricamento {plural}…
      </div>
    );
  }
  if (query.isError) {
    return <p className="px-2 py-2 text-sm text-red-600 dark:text-red-400">Errore nel caricamento.</p>;
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return <p className="px-2 py-2 text-sm text-muted-foreground">{FLOW_UI[flow].noneLabel}</p>;
  }
  const total = query.data?.total ?? items.length;
  return (
    <ul className="py-1">
      {items.map((tx) => (
        <li
          key={tx.id}
          className="flex items-center gap-3 px-2 py-1.5 text-sm border-b last:border-0"
        >
          <span className="text-xs text-muted-foreground tabular-nums w-20 shrink-0">
            {formatDate(tx.transactionDate)}
          </span>
          <span className="flex-1 truncate">
            {tx.description || <span className="text-muted-foreground">—</span>}
          </span>
          <span className="text-xs text-muted-foreground truncate max-w-[8rem] hidden sm:inline">
            {tx.account?.name}
          </span>
          <span className="font-medium tabular-nums w-24 text-right">
            {formatCents(String(Math.abs(Number(tx.amountCents))))}
          </span>
        </li>
      ))}
      {total > items.length && (
        <li className="px-2 py-1.5 text-xs text-muted-foreground">
          …e altre {total - items.length} {plural} (mostrate le {items.length} più recenti)
        </li>
      )}
    </ul>
  );
}

function DeltaRow({ label, a, b }: { label: string; a: string; b: string }) {
  const aN = Number(a);
  const bN = Number(b);
  const diff = bN - aN;
  const pct = aN !== 0 ? (diff / Math.abs(aN)) * 100 : 0;
  const tone = diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${tone}`}>
        {diff >= 0 ? '+' : ''}
        {formatCents(diff)} ({pct.toFixed(1)}%)
      </span>
    </div>
  );
}

function monthLabel(m: number): string {
  return ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][m - 1];
}

function monthName(m: number): string {
  return [
    'Gennaio',
    'Febbraio',
    'Marzo',
    'Aprile',
    'Maggio',
    'Giugno',
    'Luglio',
    'Agosto',
    'Settembre',
    'Ottobre',
    'Novembre',
    'Dicembre',
  ][m - 1];
}

/** Ultimo giorno del mese in formato ISO `YYYY-MM-DD`. */
function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}
