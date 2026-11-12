import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { dayLabel } from '@/lib/utils/date';
import { AccountMultiSelect } from '@/components/shared/AccountMultiSelect';
import { CategoryMultiSelect } from '@/components/shared/CategoryMultiSelect';
import { accountsApi } from '@/features/accounts/accountsApi';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { sortByName } from '@/lib/utils/sort';
import { reportsApi, type CategoryNode, type CategoryBreakdownItem } from './dashboardApi';
import { IncomeExpenseBar } from './charts/IncomeExpenseBar';
import { CategoryPieChart, FALLBACK_PALETTE, pieSlices } from './charts/CategoryPieChart';
import { BalanceArea } from './charts/BalanceArea';
import { StaggerList } from '@/components/shared/animated/StaggerList';
import { PeriodSummary } from '@/components/shared/PeriodSummary';
import { DateRangeChip } from '@/components/shared/DateRangeChip';
import { EmptyState } from '@/components/shared/EmptyState';
import { GroupHeader } from '@/components/shared/GroupHeader';
import { TxRowContent, groupByDay } from '@/features/transactions/TxRowContent';
import { Link } from '@tanstack/react-router';
import { Receipt } from 'lucide-react';
import { Skeleton } from '@/components/shared/animated/Skeleton';
import { cn } from '@/lib/utils/cn';
import { revealIfOffscreen } from '@/lib/utils/reveal';
import { FLOW_UI, type Flow } from './flow';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

type Preset = '7' | '30' | '90' | 'ytd';

const PRESETS: { value: Preset; label: string }[] = [
  { value: '7', label: '7g' },
  { value: '30', label: '30g' },
  { value: '90', label: '90g' },
  { value: 'ytd', label: 'Anno' },
];

/** Intervallo di un preset: ultimi N giorni o dall'inizio dell'anno. */
function presetRange(p: Preset): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10);
  if (p === 'ytd') return { from: `${new Date().getFullYear()}-01-01`, to };
  return { from: isoDaysAgo(Number(p)), to };
}

/** Periodo precedente della stessa durata, per la variazione del netto. */
function previousRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00Z`).getTime();
  const t = new Date(`${to}T00:00:00Z`).getTime();
  const len = t - f + 86400_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(f - len), to: iso(f - 86400_000) };
}

export function DashboardPage() {
  const [preset, setPresetState] = useState<Preset | null>('30');
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

  // Stesso filtro sul periodo precedente: solo per la variazione del netto.
  const prev = previousRange(from, to);
  const previousQuery = useQuery({
    queryKey: ['dashboard', prev.from, prev.to, [...accountIds].sort(), [...categoryIds].sort()],
    queryFn: () =>
      reportsApi.dashboard(
        prev.from,
        prev.to,
        accountIds.length > 0 ? accountIds : undefined,
        categoryIds.length > 0 ? categoryIds : undefined,
      ),
    enabled: !!data,
  });

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

  const setPreset = (p: Preset) => {
    const r = presetRange(p);
    setPresetState(p);
    setFrom(r.from);
    setTo(r.to);
  };

  return (
    <div className="space-y-6 relative">
      {/* Hero glow decorativo dietro l'header */}
      <div className="fm-hero-glow" aria-hidden />
      <div className="relative flex flex-col gap-3">
        <h1 className="fm-large-title">Dashboard</h1>
        <Segmented
          ariaLabel="Periodo"
          options={PRESETS}
          value={preset}
          onChange={setPreset}
          className="w-full sm:w-auto sm:self-start"
        />
        {/* Filtri in chip su UNA riga scorrevole (su mobile); il periodo
            personalizzato si sceglie dalla chip delle date. I popover sono in
            portal, lo scroll orizzontale non li taglia. */}
        <div className="fm-no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto pb-1 pl-4 pr-8 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:[mask-image:none]">
          <AccountMultiSelect accounts={accounts} value={accountIds} onChange={setAccountIds} />
          <CategoryMultiSelect
            categories={parentCategories}
            value={categoryIds}
            onChange={setCategoryIds}
          />
          <DateRangeChip
            from={from}
            to={to}
            onChange={(r) => {
              setPresetState(null);
              if (r.from) setFrom(r.from);
              if (r.to) setTo(r.to);
            }}
          />
        </div>
      </div>

      <PeriodSummary
        totals={data?.totals}
        previous={previousQuery.data?.totals}
        netLabel="Netto del periodo"
        previousLabel="sul periodo prima"
        netSpark={
          data?.daily && data.daily.length > 1
            ? cumulativeNet(data.daily)
            : undefined
        }
        flow={flow}
        onSelectFlow={selectFlow}
      />

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
                className="inline-flex shrink-0 rounded-full bg-muted p-0.5 text-xs font-medium"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!categoryDetail}
                  onClick={() => setCategoryDetail(false)}
                  className={cn(
                    'rounded-full px-2.5 py-1 transition-colors',
                    !categoryDetail
                      ? 'bg-card text-foreground shadow-sm'
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
                    'rounded-full px-2.5 py-1 transition-colors',
                    categoryDetail
                      ? 'bg-card text-foreground shadow-sm'
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
                {categoryBreakdown.length === 0 ? (
                  <CategoryPieChart data={categoryBreakdown} emptyLabel={FLOW_UI[flow].emptyChart} />
                ) : (
                  <div className="grid items-center gap-5 sm:grid-cols-[180px_1fr]">
                    <CategoryPieChart
                      data={categoryBreakdown}
                      centerLabel={flow === 'income' ? 'Entrate' : 'Uscite'}
                    />
                    <CategoryBreakdownList items={categoryBreakdown} />
                  </div>
                )}
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

      <section className="fm-card-in">
        <div className="mb-1 flex items-baseline justify-between px-1">
          <h2 className="text-base font-semibold">Ultime operazioni</h2>
          <Link to="/transactions" className="text-sm font-medium text-primary hover:underline">
            Vedi tutte
          </Link>
        </div>
        {!data ? (
          <Skel />
        ) : data.recent.length === 0 ? (
          <Card>
            <EmptyState
              icon={Receipt}
              title="Nessun movimento"
              description="I movimenti che aggiungi o che arrivano dalla banca compaiono qui."
            />
          </Card>
        ) : (
          groupByDay(data.recent).map((g) => (
            <div key={g.day} className="mt-3">
              <GroupHeader label={dayLabel(g.day)} />
              <Card className="overflow-hidden">
                <ul className="divide-y">
                  {g.items.map((tx) => (
                    <li key={tx.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                      <TxRowContent tx={tx} />
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/** Netto progressivo giorno per giorno: la linea finisce sul netto del periodo. */
function cumulativeNet(daily: { incomeCents: string; expenseCents: string }[]): number[] {
  let acc = 0;
  return daily.map((d) => (acc += (Number(d.incomeCents) - Number(d.expenseCents)) / 100));
}

function Skel() {
  return <Skeleton height={260} rounded="md" />;
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

/**
 * Legenda accanto alla ciambella: stesse voci e stessi colori delle fette
 * (prime 8 + "Altro"), con importo, quota e barra di peso.
 */
function CategoryBreakdownList({ items }: { items: CategoryBreakdownItem[] }) {
  if (items.length === 0) return null;
  const slices = pieSlices(items);
  const total = slices.reduce((acc, c) => acc + c.cents, 0) || 1;
  return (
    <ul className="space-y-2.5">
      {slices.map((c, i) => {
        const color = c.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length];
        const share = c.cents / total;
        return (
          <li key={`${c.name}-${i}`} className="text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                <span className="text-xs text-muted-foreground">{Math.round(share * 100)}%</span>
                <MoneyAmount cents={c.cents} size="inline" className="font-medium" />
              </span>
            </div>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, background: color }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
