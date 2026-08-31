import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/utils/currency';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { formatDate } from '@/lib/utils/date';
import { AccountMultiSelect } from '@/components/shared/AccountMultiSelect';
import { CategoryMultiSelect } from '@/components/shared/CategoryMultiSelect';
import { accountsApi } from '@/features/accounts/accountsApi';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { sortByName } from '@/lib/utils/sort';
import { reportsApi, type CategoryNode, type CategoryBreakdownItem } from './dashboardApi';
import { IncomeExpenseBar } from './charts/IncomeExpenseBar';
import { CategoryPieChart } from './charts/CategoryPieChart';
import { BalanceArea } from './charts/BalanceArea';
import { AnimatedNumber } from '@/components/shared/animated/AnimatedNumber';
import { SparkLine } from '@/components/shared/animated/SparkLine';
import { StaggerList } from '@/components/shared/animated/StaggerList';
import { Skeleton } from '@/components/shared/animated/Skeleton';
import { cn } from '@/lib/utils/cn';
import { revealIfOffscreen } from '@/lib/utils/reveal';
import { FLOW_UI, FlowHint, flowSelectProps, type Flow } from './flow';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

const PRESETS = [
  { label: '7g', days: 7 },
  { label: '30g', days: 30 },
  { label: '90g', days: 90 },
  { label: 'YTD', days: -1 },
];

export function DashboardPage() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  // Toggle "categoria padre" (aggregato) vs "dettaglio sottocategorie".
  const [categoryDetail, setCategoryDetail] = useState(false);
  // Le card KPI Entrate/Uscite fanno da selettore per la card "per categoria":
  // default uscite (vista storica della dashboard).
  const [flow, setFlow] = useState<Flow>('expense');
  const breakdownRef = useRef<HTMLDivElement>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  });
  const accounts = useMemo(
    () => sortByName(accountsQuery.data ?? []),
    [accountsQuery.data],
  );

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });
  const categories = useMemo(
    () => sortByName(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );

  const dashboardQuery = useQuery({
    // ordino account/category ids per avere una cache key stabile a prescindere
    // dall'ordine in cui l'utente ha selezionato i filtri
    queryKey: ['dashboard', from, to, [...accountIds].sort(), [...categoryIds].sort()],
    queryFn: () =>
      reportsApi.dashboard(
        from,
        to,
        accountIds.length > 0 ? accountIds : undefined,
        categoryIds.length > 0 ? categoryIds : undefined,
      ),
    // I totali e il saldo dipendono dalle transazioni: refetch fresh ad
    // ogni mount per non mostrare valori obsoleti dopo un giroconto/movimento.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const data = dashboardQuery.data;

  // Il filtro per categoria mostra SOLO le categorie padre: selezionarne una
  // ingloba (lato backend) anche i movimenti delle sue sottocategorie.
  const parentCategories = useMemo(
    () => categories.filter((c) => c.parentId === null),
    [categories],
  );

  // Breakdown per il grafico/lista: albero scelto dal flusso (uscite/entrate),
  // appiattito in base al toggle padre/sottocategorie. Entrambi gli alberi
  // arrivano già filtrati per conti, periodo e categorie selezionati in alto.
  const categoryTree = flow === 'income' ? data?.byCategoryTreeIncome : data?.byCategoryTree;
  const categoryBreakdown = useMemo(
    () => buildCategoryBreakdown(categoryTree ?? [], categoryDetail),
    [categoryTree, categoryDetail],
  );

  /** Cambia flusso dal click su una card KPI, mostrando la card del dettaglio. */
  const selectFlow = (next: Flow) => {
    setFlow(next);
    revealIfOffscreen(breakdownRef.current);
  };

  const setPreset = (days: number) => {
    if (days < 0) {
      setFrom(`${new Date().getFullYear()}-01-01`);
      setTo(new Date().toISOString().slice(0, 10));
    } else {
      setFrom(isoDaysAgo(days));
      setTo(new Date().toISOString().slice(0, 10));
    }
  };

  return (
    <div className="space-y-6 relative">
      {/* Hero glow decorativo dietro l'header */}
      <div className="fm-hero-glow" aria-hidden />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 relative">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Panoramica finanziaria del periodo selezionato
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountMultiSelect
            accounts={accounts}
            value={accountIds}
            onChange={setAccountIds}
          />
          <CategoryMultiSelect
            categories={parentCategories}
            value={categoryIds}
            onChange={setCategoryIds}
          />
          {PRESETS.map((p) => (
            <Button key={p.label} variant="outline" size="sm" onClick={() => setPreset(p.days)}>
              {p.label}
            </Button>
          ))}
          {/* Su mobile gli input data riempiono lo spazio disponibile invece di
              una larghezza fissa che, affiancata, sforava lo schermo. */}
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-w-[8.5rem] flex-1 sm:w-36 sm:flex-none"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-w-[8.5rem] flex-1 sm:w-36 sm:flex-none"
          />
        </div>
      </div>

      {/* KPI cards — Entrate/Uscite selezionano il flusso della card "per categoria" */}
      <StaggerList className="grid gap-4 md:grid-cols-3">
        <KpiCard
          label="Entrate"
          value={data ? Number(data.totals.incomeCents) / 100 : null}
          valueClassName="text-[hsl(var(--pos))]"
          spark={
            data?.daily && data.daily.length > 1
              ? data.daily.map((d) => Number(d.incomeCents) / 100)
              : undefined
          }
          sparkColor="hsl(var(--pos))"
          select={{
            active: flow === 'income',
            onSelect: () => selectFlow('income'),
            selectedClassName: FLOW_UI.income.selected,
            hint: 'Mostra le entrate per categoria',
          }}
        />
        <KpiCard
          label="Uscite"
          value={data ? Number(data.totals.expenseCents) / 100 : null}
          valueClassName="text-[hsl(var(--neg))]"
          spark={
            data?.daily && data.daily.length > 1
              ? data.daily.map((d) => Math.abs(Number(d.expenseCents)) / 100)
              : undefined
          }
          sparkColor="hsl(var(--neg))"
          select={{
            active: flow === 'expense',
            onSelect: () => selectFlow('expense'),
            selectedClassName: FLOW_UI.expense.selected,
            hint: 'Mostra le spese per categoria',
          }}
        />
        <KpiCard
          label="Netto"
          value={data ? Number(data.totals.netCents) / 100 : null}
          valueClassName={
            data && Number(data.totals.netCents) >= 0
              ? 'text-[hsl(var(--pos))]'
              : 'text-[hsl(var(--neg))]'
          }
          spark={
            data?.daily && data.daily.length > 1
              ? data.daily.map((d) => (Number(d.incomeCents) + Number(d.expenseCents)) / 100)
              : undefined
          }
          sparkColor="hsl(var(--primary))"
        />
      </StaggerList>

      <StaggerList className="grid gap-4 lg:grid-cols-2">
        <Card className="fm-glass fm-card-in">
          <CardHeader>
            <CardTitle className="text-base">Andamento patrimonio</CardTitle>
            <CardDescription>Saldo cumulativo nel periodo</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? <BalanceArea data={data.daily} /> : <Skel />}
          </CardContent>
        </Card>

        <Card ref={breakdownRef} className="fm-glass fm-card-in scroll-mt-4">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{FLOW_UI[flow].categoryTitle}</CardTitle>
                <CardDescription>
                  {categoryDetail ? 'Dettaglio sottocategorie' : 'Per categoria padre'} nel periodo
                </CardDescription>
              </div>
              {/* Radio: aggrega per padre oppure mostra il dettaglio dei figli. */}
              <div
                role="radiogroup"
                aria-label="Livello di dettaglio categorie"
                className="inline-flex shrink-0 rounded-md border p-0.5 text-xs"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!categoryDetail}
                  onClick={() => setCategoryDetail(false)}
                  className={cn(
                    'rounded px-2 py-1 transition-colors',
                    !categoryDetail
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Padre
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={categoryDetail}
                  onClick={() => setCategoryDetail(true)}
                  className={cn(
                    'rounded px-2 py-1 transition-colors',
                    categoryDetail
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Sottocategorie
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {data ? (
              <>
                <CategoryPieChart data={categoryBreakdown} emptyLabel={FLOW_UI[flow].emptyChart} />
                <CategoryBreakdownList items={categoryBreakdown} />
              </>
            ) : (
              <Skel />
            )}
          </CardContent>
        </Card>

        <Card className="fm-glass fm-card-in lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Entrate vs uscite</CardTitle>
            <CardDescription>Per giornata</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? <IncomeExpenseBar data={data.daily} /> : <Skel />}
          </CardContent>
        </Card>
      </StaggerList>

      <Card className="fm-glass fm-card-in">
        <CardHeader>
          <CardTitle className="text-base">Ultime operazioni</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!data || data.recent.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">Nessun movimento.</p>
          ) : (
            <ul className="divide-y fm-stagger">
              {data.recent.map((tx) => {
                const cents = Number(tx.amountCents);
                return (
                  <li
                    key={tx.id}
                    className="fm-card-in flex items-center gap-3 p-3 sm:px-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {tx.description || (tx.category?.name ?? 'Movimento')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(tx.transactionDate)} · {tx.account.name}
                        {tx.category && ` · ${tx.category.name}`}
                      </p>
                    </div>
                    <MoneyAmount cents={cents} size="row" colored className="font-semibold" />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Skel() {
  return <Skeleton height={260} rounded="md" />;
}

interface KpiCardProps {
  label: string;
  /** null finché i dati non sono arrivati (mostra "—"). */
  value: number | null;
  valueClassName: string;
  spark?: number[];
  sparkColor: string;
  /** Se presente la card fa da selettore per la vista "per categoria" sotto. */
  select?: {
    active: boolean;
    onSelect: () => void;
    /** Classi di evidenziazione a card selezionata (outline: vedi FLOW_UI). */
    selectedClassName: string;
    hint: string;
  };
}

/**
 * Card KPI del periodo. Con `select` diventa cliccabile (e raggiungibile da
 * tastiera): Entrate/Uscite scelgono il flusso mostrato dalla torta per categoria.
 */
function KpiCard({ label, value, valueClassName, spark, sparkColor, select }: KpiCardProps) {
  return (
    <Card
      className={cn(
        'fm-glass fm-card-in relative overflow-hidden',
        select && 'cursor-pointer transition-shadow hover:shadow-md',
        select?.active && select.selectedClassName,
      )}
      {...(select ? flowSelectProps(select) : {})}
    >
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] font-semibold">
          {label}
          {select && <FlowHint active={select.active} />}
        </CardDescription>
        <CardTitle className={cn('text-3xl', valueClassName)}>
          {value !== null ? (
            <AnimatedNumber
              value={value}
              render={(n) => <MoneyAmount cents={Math.round(n * 100)} size="kpi" />}
            />
          ) : (
            '—'
          )}
        </CardTitle>
      </CardHeader>
      {spark && spark.length > 1 && (
        <div className="absolute bottom-3 right-3 opacity-60">
          <SparkLine data={spark} color={sparkColor} width={110} height={32} />
        </div>
      )}
    </Card>
  );
}

/**
 * Trasforma l'albero (uscite o entrate) in una lista piatta per grafico/legenda:
 *  - detail = false → una voce per categoria padre (totale figli incluso)
 *  - detail = true  → una voce per ogni sottocategoria (i padri senza figli
 *    restano come voce singola), con etichetta "Padre · Figlio".
 */
function buildCategoryBreakdown(tree: CategoryNode[], detail: boolean): CategoryBreakdownItem[] {
  if (!detail) {
    return tree.map((n) => ({
      categoryId: n.categoryIds[0] ?? null,
      categoryName: n.categoryName,
      color: n.color,
      amountCents: n.amountCents,
      count: n.count,
    }));
  }
  return tree.flatMap((n) =>
    n.children.length === 0
      ? [
          {
            categoryId: n.categoryIds[0] ?? null,
            categoryName: n.categoryName,
            color: n.color,
            amountCents: n.amountCents,
            count: n.count,
          },
        ]
      : n.children.map((c) => ({
          categoryId: c.categoryIds[0] ?? null,
          categoryName: `${n.categoryName} · ${c.categoryName}`,
          color: c.color ?? n.color,
          amountCents: c.amountCents,
          count: c.count,
        })),
  );
}

const BREAKDOWN_PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

/** Lista categorie (legenda con importi) sotto il grafico, rispetta il toggle. */
function CategoryBreakdownList({ items }: { items: CategoryBreakdownItem[] }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort(
    (a, b) => Number(BigInt(b.amountCents) - BigInt(a.amountCents)),
  );
  return (
    <ul className="mt-4 space-y-1.5 border-t pt-3">
      {sorted.map((c, i) => (
        <li
          key={`${c.categoryId ?? 'none'}-${i}`}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: c.color ?? BREAKDOWN_PALETTE[i % BREAKDOWN_PALETTE.length] }}
            />
            <span className="truncate">{c.categoryName}</span>
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatCents(Number(c.amountCents))}
          </span>
        </li>
      ))}
    </ul>
  );
}
