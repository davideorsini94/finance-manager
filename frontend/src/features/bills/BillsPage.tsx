import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronRight,
  FilePlus2,
  FileUp,
  Loader2,
  PencilLine,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { SparkLine } from '@/components/shared/animated/SparkLine';
import { AttachmentPreviewDialog } from '@/components/shared/AttachmentPreviewDialog';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/lib/utils/cn';
import {
  UTILITIES,
  combinedLast12,
  monthlySeries,
  overlappingBills,
  possibleDuplicates,
  providerHistory,
  unitPrices,
  utilitySummary,
  yearOverYear,
  yearlyTotals,
  type UtilityKind,
  type UtilitySummary,
} from './analytics';
import { billsApi, type UtilityBill } from './billsApi';
import { BillForm, modelLabel } from './BillForm';
import { CostStackChart, MonthlyChart, UnitPriceChart, YearOverYearChart } from './BillsCharts';
import {
  UTILITY_META,
  UtilityGlyph,
  UtilityStack,
  dayLabel,
  formatConsumption,
  formatPct,
  formatUnitPrice,
  monthTick,
  periodLabel,
  utilColor,
} from './utilities';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

type View = 'overview' | UtilityKind;

/**
 * Bollette di luce, gas e acqua: consumi e costi nel tempo. Sezione a sé,
 * indipendente da conti e movimenti (una bolletta pagata dal conto non entra
 * qui, e una bolletta caricata qui non crea movimenti).
 */
export function BillsPage() {
  const qc = useQueryClient();
  const isDemo = useUIStore((s) => s.demoData);
  const fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('overview');
  const [editing, setEditing] = useState<UtilityBill | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [pdfBill, setPdfBill] = useState<UtilityBill | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['utility-bills'],
    queryFn: billsApi.list,
    // Mentre un PDF è in lettura si ripolla: il risultato arriva dal background.
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'extracting') ? 2500 : false),
  });
  const bills = useMemo(() => query.data ?? [], [query.data]);

  const upload = useMutation({
    mutationFn: (file: File) => billsApi.upload(file),
    onMutate: () => setUploadError(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['utility-bills'], refetchType: 'all' }),
    onError: (e: Error) => setUploadError(e.message),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Il PDF supera i 10 MB');
      return;
    }
    upload.mutate(file);
  };

  const openForm = (bill: UtilityBill | null) => {
    setEditing(bill);
    setFormOpen(true);
  };

  const confirmed = bills.filter((b) => b.status === 'confirmed');
  const pending = bills.filter((b) => b.status !== 'confirmed');
  const summaries = useMemo(
    () => Object.fromEntries(UTILITIES.map((u) => [u, utilitySummary(bills, u)])) as Record<UtilityKind, UtilitySummary>,
    [bills],
  );
  const duplicates = useMemo(() => possibleDuplicates(bills), [bills]);

  // Se il servizio aperto non ha più bollette (l'ultima è stata eliminata) la
  // sua scheda sparisce: si torna alla panoramica invece di un dettaglio vuoto.
  useEffect(() => {
    if (view !== 'overview' && summaries[view].billCount === 0) setView('overview');
  }, [view, summaries]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="fm-large-title">Bollette</h1>
          <p className="mt-1 text-sm text-muted-foreground">Luce, gas e acqua: quanto consumi e quanto spendi nel tempo.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openForm(null)}>
            <PencilLine className="h-4 w-4" />
            <span className="hidden sm:inline">Inserisci a mano</span>
            <span className="sm:hidden">A mano</span>
          </Button>
          <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            Carica PDF
          </Button>
          <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPickFile} />
        </div>
      </header>

      {uploadError && (
        <p role="alert" className="rounded-xl bg-[hsl(var(--neg-soft))] px-4 py-3 text-sm text-[hsl(var(--neg))]">
          {uploadError}
        </p>
      )}

      {pending.length > 0 && <PendingBills bills={pending} onOpen={openForm} />}

      {query.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Caricamento…</CardContent>
        </Card>
      ) : confirmed.length === 0 ? (
        <EmptyState onUpload={() => fileInput.current?.click()} onManual={() => openForm(null)} hasPending={pending.length > 0} />
      ) : (
        <>
          <ViewPicker value={view} onChange={setView} summaries={summaries} />
          {view === 'overview' ? (
            <Overview bills={bills} summaries={summaries} onPick={setView} />
          ) : (
            <UtilityDetail bills={bills} utility={view} summary={summaries[view]} />
          )}
          <BillList
            bills={view === 'overview' ? confirmed : confirmed.filter((b) => b.lines.some((l) => l.utility === view))}
            duplicates={duplicates}
            onOpen={openForm}
          />
        </>
      )}

      <BillForm open={formOpen} onOpenChange={setFormOpen} bill={editing} onShowPdf={setPdfBill} />
      {pdfBill && (
        <AttachmentPreviewDialog
          open={!!pdfBill}
          onOpenChange={(o) => !o && setPdfBill(null)}
          attachments={[
            {
              id: pdfBill.id,
              filename: pdfBill.fileName ?? 'bolletta.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 0,
              createdAt: pdfBill.createdAt,
            },
          ]}
          contentUrl={(id) => (isDemo ? '/demo/bolletta-demo.pdf' : `${API_BASE}/utility-bills/${id}/file`)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ViewPicker({
  value,
  onChange,
  summaries,
}: {
  value: View;
  onChange: (v: View) => void;
  summaries: Record<UtilityKind, UtilitySummary>;
}) {
  const options: { key: View; label: string }[] = [
    { key: 'overview', label: 'Panoramica' },
    ...UTILITIES.filter((u) => summaries[u].billCount > 0).map((u) => ({ key: u as View, label: UTILITY_META[u].label })),
  ];
  return (
    <div role="group" aria-label="Servizio" className="fm-no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex rounded-full bg-foreground/[0.06] p-1">
        {options.map((o) => {
          const active = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.key)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-200',
                active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.key !== 'overview' && (
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: utilColor(o.key as UtilityKind) }} />
              )}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Overview({
  bills,
  summaries,
  onPick,
}: {
  bills: UtilityBill[];
  summaries: Record<UtilityKind, UtilitySummary>;
  onPick: (u: UtilityKind) => void;
}) {
  const present = UTILITIES.filter((u) => summaries[u].billCount > 0);
  const series = useMemo(
    () => Object.fromEntries(UTILITIES.map((u) => [u, monthlySeries(bills, u)])) as Record<UtilityKind, ReturnType<typeof monthlySeries>>,
    [bills],
  );
  const total12 = useMemo(() => combinedLast12(bills), [bills]);
  return (
    <>
      <div className={cn('grid gap-3', present.length === 3 ? 'md:grid-cols-3' : present.length === 2 ? 'sm:grid-cols-2' : '')}>
        {present.map((u) => (
          <SummaryCard key={u} summary={summaries[u]} onClick={() => onPick(u)} />
        ))}
      </div>
      <Card className="fm-card-in">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">Spesa mensile</h2>
              <p className="text-sm text-muted-foreground">Ogni bolletta ripartita sui mesi che copre</p>
            </div>
            {total12 && (
              <div className="text-right">
                <div className="text-xs text-muted-foreground">
                  {monthTick(total12.from)} – {monthTick(total12.to)}
                </div>
                <div className="text-xl font-semibold tracking-tight">
                  <MoneyAmount cents={total12.costCents} size="row" />
                </div>
              </div>
            )}
          </div>
          <CostStackChart series={series} />
          <Legend utilities={present} />
        </CardContent>
      </Card>
    </>
  );
}

function Legend({ utilities }: { utilities: UtilityKind[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      {utilities.map((u) => (
        <span key={u} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: utilColor(u) }} />
          {UTILITY_META[u].label}
        </span>
      ))}
    </div>
  );
}

/** Variazione colorata: per una spesa salire è il dato negativo. */
function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        up ? 'bg-[hsl(var(--neg-soft))] text-[hsl(var(--neg))]' : 'bg-[hsl(var(--pos-soft))] text-[hsl(var(--pos))]',
      )}
      title={`${label} rispetto ai 12 mesi precedenti`}
    >
      <Icon className="h-3 w-3" />
      {formatPct(value)}
    </span>
  );
}

/**
 * Card di un servizio: identità visiva propria (alone e icona in filigrana
 * nel suo colore), spesa degli ultimi 12 mesi, variazione, consumo e prezzo.
 */
function SummaryCard({ summary, onClick }: { summary: UtilitySummary; onClick?: () => void }) {
  const u = summary.utility;
  const meta = UTILITY_META[u];
  const Icon = meta.icon;
  const spark = summary.spark.filter((v): v is number => v !== null);
  return (
    <Card
      className={cn('fm-card-in relative overflow-hidden', onClick && 'fm-press cursor-pointer')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
      aria-label={onClick ? `Dettaglio ${meta.label}` : undefined}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full"
        style={{ background: `radial-gradient(circle, ${utilColor(u, 0.22)}, transparent 70%)` }}
      />
      <Icon
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-28 w-28"
        style={{ color: utilColor(u, 0.08) }}
        strokeWidth={1.5}
      />
      <CardContent className="relative space-y-3 p-5">
        <div className="flex items-center gap-3">
          <UtilityGlyph utility={u} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">{meta.label}</div>
            <div className="truncate text-xs text-muted-foreground">{summary.currentProvider ?? '—'}</div>
          </div>
          {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">
            {summary.windowFrom && summary.lastMonth
              ? `Spesa ${monthTick(summary.windowFrom)} – ${monthTick(summary.lastMonth)}`
              : 'Spesa'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[1.75rem] font-semibold leading-tight tracking-tight">
              {summary.last12CostCents === null ? '—' : <MoneyAmount cents={summary.last12CostCents} size="kpi" />}
            </span>
            <Delta value={summary.costDeltaPct} label="Spesa" />
          </div>
        </div>
        <div className="flex items-end justify-between gap-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[13px]">
            <dt className="text-muted-foreground">Consumo</dt>
            <dd className="text-right font-medium tabular-nums">{formatConsumption(u, summary.last12Consumption)}</dd>
            <dt className="text-muted-foreground">Prezzo medio</dt>
            <dd className="money-blur-target text-right font-medium tabular-nums">{formatUnitPrice(u, summary.unitPriceCents)}</dd>
          </dl>
          {spark.length > 1 && <SparkLine data={spark} color={utilColor(u)} width={84} height={30} />}
        </div>
      </CardContent>
    </Card>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-foreground/[0.06] p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-full px-3 py-1 text-[13px] font-medium transition-[background-color,color] duration-150',
            value === o.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function UtilityDetail({
  bills,
  utility,
  summary,
}: {
  bills: UtilityBill[];
  utility: UtilityKind;
  summary: UtilitySummary;
}) {
  const meta = UTILITY_META[utility];
  const [metric, setMetric] = useState<'consumption' | 'cost'>('consumption');
  const [mode, setMode] = useState<'monthly' | 'yoy'>('monthly');
  const series = useMemo(() => monthlySeries(bills, utility), [bills, utility]);
  const yoy = useMemo(() => yearOverYear(bills, utility, metric), [bills, utility, metric]);
  const prices = useMemo(() => unitPrices(bills, utility), [bills, utility]);
  const years = useMemo(() => yearlyTotals(bills, utility).reverse(), [bills, utility]);
  const providers = useMemo(() => providerHistory(bills, utility).reverse(), [bills, utility]);
  const overlaps = useMemo(() => overlappingBills(bills, utility), [bills, utility]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <SummaryCard summary={summary} />
        <Card className="fm-card-in">
          <CardContent className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4 lg:grid-cols-2">
            <Stat label="Costo al giorno" value={summary.dailyCostCents === null ? '—' : <MoneyAmount cents={Math.round(summary.dailyCostCents)} size="row" />} />
            <Stat label="Consumo al giorno" value={formatConsumption(utility, summary.dailyConsumption)} />
            <Stat label="Bollette" value={String(summary.billCount)} />
            <Stat label="Variazione consumo" value={summary.consumptionDeltaPct === null ? 'n.d.' : formatPct(summary.consumptionDeltaPct)} hint="12 mesi contro i 12 precedenti" />
          </CardContent>
        </Card>
      </div>

      {overlaps.length > 0 && (
        <p className="flex gap-2 rounded-xl bg-[hsl(var(--warn-soft))] px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warn))]" />
          {overlaps.length === 1 ? 'Due bollette coprono' : `${overlaps.length} coppie di bollette coprono`} lo stesso periodo:
          nei grafici i consumi si sommano. Se una è un conguaglio o un doppione, correggila o eliminala.
        </p>
      )}

      <Card className="fm-card-in">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight">
              {metric === 'consumption' ? `Consumi (${meta.unit})` : 'Spesa'}
              {mode === 'yoy' && yoy.year && <span className="font-normal text-muted-foreground"> · {yoy.year} e {yoy.year - 1}</span>}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Segmented
                label="Valore"
                value={metric}
                onChange={setMetric}
                options={[
                  { key: 'consumption', label: 'Consumo' },
                  { key: 'cost', label: 'Spesa' },
                ]}
              />
              <Segmented
                label="Confronto"
                value={mode}
                onChange={setMode}
                options={[
                  { key: 'monthly', label: 'Mesi' },
                  { key: 'yoy', label: 'Anno su anno' },
                ]}
              />
            </div>
          </div>
          {mode === 'monthly' ? (
            <MonthlyChart points={series.slice(-24)} utility={utility} metric={metric} />
          ) : yoy.year ? (
            <YearOverYearChart points={yoy.points} year={yoy.year} utility={utility} metric={metric} />
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="fm-card-in">
          <CardContent className="space-y-3 p-5">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">Prezzo per {meta.unit}</h2>
              <p className="text-sm text-muted-foreground">Bolletta per bolletta, tutto compreso. La linea tratteggiata segna un cambio di fornitore.</p>
            </div>
            {prices.length > 1 ? (
              <UnitPriceChart points={prices} utility={utility} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Servono almeno due bollette con consumo e costo.</p>
            )}
          </CardContent>
        </Card>

        <Card className="fm-card-in overflow-hidden">
          <CardContent className="p-0">
            <h2 className="px-5 pb-2 pt-5 text-[17px] font-semibold tracking-tight">Anno per anno</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-medium">Anno</th>
                    <th className="px-2 py-2 text-right font-medium">Consumo</th>
                    <th className="px-2 py-2 text-right font-medium">Spesa</th>
                    <th className="px-5 py-2 text-right font-medium">Prezzo medio</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => (
                    <tr key={y.year} className="border-t border-border/60">
                      <td className="px-5 py-2.5 font-medium">
                        {y.year}
                        {y.monthsCovered < 12 && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground" title="Mesi coperti da bollette">
                            {y.monthsCovered}/12 mesi
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{formatConsumption(utility, y.consumption)}</td>
                      <td className="px-2 py-2.5 text-right">{y.costCents === null ? '—' : <MoneyAmount cents={Math.round(y.costCents)} size="row" />}</td>
                      <td className="money-blur-target px-5 py-2.5 text-right tabular-nums">{formatUnitPrice(utility, y.unitPriceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {providers.length > 0 && (
        <Card className="fm-card-in">
          <CardContent className="space-y-3 p-5">
            <h2 className="text-[17px] font-semibold tracking-tight">Fornitori</h2>
            <ol className="relative space-y-3 border-l-2 pl-5" style={{ borderColor: utilColor(utility, 0.3) }}>
              {providers.map((p, i) => (
                <li key={`${p.provider}-${p.from}`} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-card"
                    style={{ backgroundColor: i === 0 ? utilColor(utility) : 'hsl(var(--muted-foreground) / 0.5)' }}
                  />
                  <div className="font-medium">{p.provider}</div>
                  <div className="text-xs text-muted-foreground">
                    {dayLabel(p.from)} – {dayLabel(p.to)} · {p.bills} {p.bills === 1 ? 'bolletta' : 'bollette'}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-lg font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

function PendingBills({ bills, onOpen }: { bills: UtilityBill[]; onOpen: (b: UtilityBill) => void }) {
  return (
    <Card className="fm-card-in overflow-hidden">
      <CardContent className="p-0">
        <h2 className="flex items-center gap-2 px-5 pb-1 pt-4 text-[15px] font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Da verificare
        </h2>
        <ul>
          {bills.map((b) => (
            <li key={b.id} className="border-t border-border/60 first:border-t-0">
              <button
                type="button"
                disabled={b.status === 'extracting'}
                onClick={() => onOpen(b)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
              >
                {b.status === 'extracting' ? (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[0.65rem] bg-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </span>
                ) : b.lines.length > 0 ? (
                  <UtilityStack utilities={b.lines.map((l) => l.utility)} />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[0.65rem] bg-muted">
                    <FilePlus2 className="h-4 w-4 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {b.status === 'extracting' ? 'Sto leggendo la bolletta…' : (b.provider ?? b.fileName ?? 'Bolletta')}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.status === 'extracting'
                      ? `${b.fileName ?? 'PDF'} · di solito meno di un minuto`
                      : b.status === 'failed'
                        ? (b.extractionError ?? 'Non letta: compila a mano')
                        : `${periodLabel(b.periodStart, b.periodEnd)}${b.extractionModel ? ` · ${modelLabel(b.extractionModel)}` : ''}`}
                  </span>
                </span>
                {b.status !== 'extracting' && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
                      b.status === 'failed' ? 'bg-[hsl(var(--warn-soft))] text-[hsl(var(--warn))]' : 'bg-accent text-accent-foreground',
                    )}
                  >
                    {b.status === 'failed' ? 'Compila' : 'Verifica'}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BillList({
  bills,
  duplicates,
  onOpen,
}: {
  bills: UtilityBill[];
  duplicates: Set<string>;
  onOpen: (b: UtilityBill) => void;
}) {
  const byYear = new Map<string, UtilityBill[]>();
  for (const b of bills) {
    const y = (b.periodEnd ?? b.createdAt).slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), b]);
  }
  const years = [...byYear.keys()].sort().reverse();
  return (
    <section className="space-y-3" aria-label="Elenco bollette">
      <h2 className="text-[17px] font-semibold tracking-tight">Bollette</h2>
      {years.map((y) => (
        <Card key={y} className="fm-card-in overflow-hidden">
          <CardContent className="p-0">
            <div className="px-5 pb-1 pt-3 text-xs font-medium text-muted-foreground">{y}</div>
            <ul>
              {byYear.get(y)!.map((b) => (
                <li key={b.id} className="border-t border-border/60 first:border-t-0">
                  <button
                    type="button"
                    onClick={() => onOpen(b)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <UtilityStack utilities={b.lines.map((l) => l.utility)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 truncate font-medium">{b.provider ?? 'Fornitore non indicato'}</span>
                        {b.totalCents !== null && (
                          <MoneyAmount cents={b.totalCents} size="row" className="shrink-0 font-semibold" />
                        )}
                      </span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{periodLabel(b.periodStart, b.periodEnd)}</span>
                        {b.lines.map((l) => (
                          <span key={l.utility} className="inline-flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: utilColor(l.utility) }} />
                            {formatConsumption(l.utility, l.consumption)}
                            {l.estimated && <span className="text-[hsl(var(--warn))]">stimata</span>}
                          </span>
                        ))}
                        {duplicates.has(b.id) && (
                          <span className="inline-flex items-center gap-1 text-[hsl(var(--warn))]">
                            <AlertTriangle className="h-3 w-3" /> possibile doppione
                          </span>
                        )}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function EmptyState({
  onUpload,
  onManual,
  hasPending,
}: {
  onUpload: () => void;
  onManual: () => void;
  hasPending: boolean;
}) {
  return (
    <Card className="fm-card-in relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(28rem 14rem at 15% 0%, ${utilColor('electricity', 0.14)}, transparent 70%),
            radial-gradient(28rem 14rem at 85% 10%, ${utilColor('gas', 0.12)}, transparent 70%),
            radial-gradient(28rem 14rem at 50% 110%, ${utilColor('water', 0.12)}, transparent 70%)`,
        }}
      />
      <CardContent className="relative flex flex-col items-center gap-5 px-6 py-12 text-center">
        <div className="flex gap-3">
          {UTILITIES.map((u) => (
            <UtilityGlyph key={u} utility={u} size="lg" />
          ))}
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">
            {hasPending ? 'Conferma la prima bolletta' : 'Carica la prima bolletta'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {hasPending
              ? 'Le bollette entrano nei grafici dopo che le hai verificate.'
              : 'Carica il PDF: leggo fornitore, periodo, consumi e costi di luce, gas e acqua, anche se sono nella stessa bolletta. Puoi sempre correggere o inserire tutto a mano.'}
          </p>
        </div>
        {!hasPending && (
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onUpload}>
              <FileUp className="h-4 w-4" /> Carica PDF
            </Button>
            <Button variant="outline" onClick={onManual}>
              <PencilLine className="h-4 w-4" /> Inserisci a mano
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
