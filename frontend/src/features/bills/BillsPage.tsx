import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Home,
  Loader2,
  PencilLine,
  RefreshCw,
  Settings2,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/shared/confirm';
import { Card, CardContent } from '@/components/ui/card';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { SparkLine } from '@/components/shared/animated/SparkLine';
import { AttachmentPreviewDialog } from '@/components/shared/AttachmentPreviewDialog';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/lib/utils/cn';
import {
  UTILITIES,
  averageEnergyPrice,
  billYears,
  energyPrices,
  combinedLast12,
  monthlyTotalsOfYear,
  yearlySummary,
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
import { billsApi, householdsApi, type Household, type UtilityBill } from './billsApi';
import { BillForm, modelLabel } from './BillForm';
import { CostStackChart, MonthlyChart, UnitPriceChart, YearCompareChart, YearOverYearChart } from './BillsCharts';
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

/** Bollette per pagina nell'elenco. */
const BILLS_PAGE_SIZE = 10;

/**
 * Editor condiviso tra l'ingresso e la pagina di un'abitazione: form della
 * bolletta e anteprima del PDF.
 */
function useBillEditor(households: Household[]) {
  const isDemo = useUIStore((s) => s.demoData);
  const [editing, setEditing] = useState<UtilityBill | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [pdfBill, setPdfBill] = useState<UtilityBill | null>(null);
  const openForm = (bill: UtilityBill | null) => {
    setEditing(bill);
    setFormOpen(true);
  };
  const editor = (
    <>
      <BillForm open={formOpen} onOpenChange={setFormOpen} bill={editing} households={households} onShowPdf={setPdfBill} />
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
    </>
  );
  return { openForm, editor };
}

function useBillsData() {
  const bills = useQuery({
    queryKey: ['utility-bills'],
    queryFn: billsApi.list,
    // Mentre un PDF è in lettura si ripolla: il risultato arriva dal background.
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'extracting') ? 2500 : false),
  });
  const households = useQuery({
    queryKey: ['utility-bills', 'households'],
    queryFn: householdsApi.list,
    // Le abitazioni nascono dalle letture: si aggiornano insieme alle bollette.
    refetchInterval: () => (bills.data?.some((b) => b.status === 'extracting') ? 2500 : false),
  });
  return {
    bills: bills.data ?? [],
    households: households.data ?? [],
    isLoading: bills.isLoading || households.isLoading,
  };
}

/**
 * Bollette di luce, gas e acqua. Sezione indipendente da conti e movimenti.
 * L'ingresso raccoglie il caricamento (PDF o a mano), le bollette da
 * verificare e le abitazioni; le statistiche stanno dentro ogni abitazione.
 */
export function BillsPage() {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { bills, households, isLoading } = useBillsData();
  const { openForm, editor } = useBillEditor(households);

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

  const confirmed = bills.filter((b) => b.status === 'confirmed');
  const pending = bills.filter((b) => b.status !== 'confirmed');
  const unassigned = confirmed.filter((b) => !b.householdId);
  const shown = households.filter((h) => confirmed.some((b) => b.householdId === h.id));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="fm-large-title">Bollette</h1>
          <p className="mt-1 text-sm text-muted-foreground">Luce, gas e acqua delle tue abitazioni, nel tempo.</p>
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

      {pending.length > 0 && <PendingBills bills={pending} households={households} onOpen={openForm} />}

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Caricamento…</CardContent>
        </Card>
      ) : confirmed.length === 0 ? (
        <EmptyState onUpload={() => fileInput.current?.click()} onManual={() => openForm(null)} hasPending={pending.length > 0} />
      ) : (
        <section className="space-y-3" aria-label="Abitazioni">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 className="text-[17px] font-semibold tracking-tight">Abitazioni</h2>
            <span className="text-xs text-muted-foreground">Riconosciute dall’indirizzo di fornitura delle bollette</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((h) => (
              <HouseholdCard key={h.id} id={h.id} name={h.name} address={h.address} bills={confirmed.filter((b) => b.householdId === h.id)} />
            ))}
            {unassigned.length > 0 && (
              <HouseholdCard id="none" name="Senza abitazione" address="Bollette senza indirizzo riconosciuto: aprile e scegli l’abitazione" bills={unassigned} muted />
            )}
          </div>
        </section>
      )}

      {editor}
    </div>
  );
}

/** Card di un'abitazione nell'ingresso: servizi, spesa recente, ripartizione. */
function HouseholdCard({
  id,
  name,
  address,
  bills,
  muted,
}: {
  id: string;
  name: string;
  address: string | null;
  bills: UtilityBill[];
  muted?: boolean;
}) {
  const total = useMemo(() => combinedLast12(bills), [bills]);
  const utilities = UTILITIES.filter((u) => bills.some((b) => b.lines.some((l) => l.utility === u)));
  const shares = useMemo(() => {
    if (!total) return [];
    return UTILITIES.map((u) => {
      let cents = 0;
      for (const p of monthlySeries(bills, u)) {
        if (p.month >= total.from && p.month <= total.to && p.costCents !== null) cents += p.costCents;
      }
      return { u, cents };
    }).filter((x) => x.cents > 0);
  }, [bills, total]);
  const sum = shares.reduce((s, x) => s + x.cents, 0);
  return (
    <Link
      to="/bills/$householdId"
      params={{ householdId: id }}
      className="fm-press group block rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="fm-card-in relative h-full overflow-hidden">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={cn(
                'grid h-11 w-11 shrink-0 place-items-center rounded-2xl',
                muted ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
              )}
              style={
                muted
                  ? undefined
                  : {
                      backgroundImage: 'linear-gradient(160deg, hsl(0 0% 100% / 0.28), hsl(0 0% 100% / 0) 60%)',
                      boxShadow: 'inset 0 1px 0 hsl(0 0% 100% / 0.3), 0 4px 12px -4px hsl(var(--primary) / 0.5)',
                    }
              }
            >
              <Home className="h-5 w-5" strokeWidth={2.1} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold tracking-tight">{name}</div>
              {address && <div className="line-clamp-2 text-xs text-muted-foreground">{address}</div>}
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">
                {total ? `Spesa ${monthTick(total.from)} – ${monthTick(total.to)}` : 'Spesa'}
              </div>
              <div className="text-[1.5rem] font-semibold leading-tight tracking-tight">
                {total ? <MoneyAmount cents={total.costCents} size="row" /> : '—'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {utilities.length > 0 && <UtilityStack utilities={utilities} />}
            </div>
          </div>
          {sum > 0 && (
            <div>
              {/* Ripartizione della spesa tra i servizi, nella finestra mostrata sopra. */}
              <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                {shares.map((x) => (
                  <span key={x.u} style={{ width: `${(x.cents / sum) * 100}%`, backgroundColor: utilColor(x.u) }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {shares.map((x) => (
                  <span key={x.u} className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: utilColor(x.u) }} />
                    {UTILITY_META[x.u].label} {Math.round((x.cents / sum) * 100)}%
                  </span>
                ))}
                <span className="ml-auto">
                  {bills.length} {bills.length === 1 ? 'bolletta' : 'bollette'}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Pagina di un'abitazione: statistiche delle sue forniture e le sue bollette.
 * Il caricamento resta nell'ingresso; qui si consulta e si correggono le
 * bollette già confermate. `none` = bollette senza abitazione.
 */
export function HouseholdPage() {
  const { householdId } = useParams({ strict: false }) as { householdId?: string };
  const { bills, households, isLoading } = useBillsData();
  const { openForm, editor } = useBillEditor(households);
  const [view, setView] = useState<View>('overview');
  const [manageOpen, setManageOpen] = useState(false);
  const isNone = householdId === 'none';
  const household = households.find((h) => h.id === householdId) ?? null;

  const scoped = useMemo(
    () => bills.filter((b) => b.status === 'confirmed' && (isNone ? !b.householdId : b.householdId === householdId)),
    [bills, householdId, isNone],
  );
  const summaries = useMemo(
    () => Object.fromEntries(UTILITIES.map((u) => [u, utilitySummary(scoped, u)])) as Record<UtilityKind, UtilitySummary>,
    [scoped],
  );
  const duplicates = useMemo(() => possibleDuplicates(scoped), [scoped]);
  useEffect(() => {
    if (view !== 'overview' && summaries[view].billCount === 0) setView('overview');
  }, [view, summaries]);

  const back = (
    <Link to="/bills" className="inline-flex items-center gap-1 text-sm font-medium text-primary">
      <ChevronLeft className="h-4 w-4" /> Bollette
    </Link>
  );

  if (!isLoading && !isNone && !household) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Questa abitazione non esiste più (forse è stata unita a un’altra).
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        {back}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="fm-large-title">{isNone ? 'Senza abitazione' : (household?.name ?? '…')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isNone ? 'Apri una bolletta e scegli a quale abitazione appartiene.' : (household?.address ?? '')}
            </p>
          </div>
          {household && (
            <Button variant="outline" onClick={() => setManageOpen(true)}>
              <Settings2 className="h-4 w-4" /> Gestisci
            </Button>
          )}
        </div>
      </header>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Caricamento…</CardContent>
        </Card>
      ) : scoped.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Nessuna bolletta confermata per questa abitazione.</CardContent>
        </Card>
      ) : (
        <>
          <ViewPicker value={view} onChange={setView} summaries={summaries} />
          {view === 'overview' ? (
            <Overview bills={scoped} summaries={summaries} onPick={setView} />
          ) : (
            <UtilityDetail bills={scoped} utility={view} summary={summaries[view]} />
          )}
          <BillList
            // Cambiando servizio l'elenco riparte dalla prima pagina.
            key={view}
            bills={view === 'overview' ? scoped : scoped.filter((b) => b.lines.some((l) => l.utility === view))}
            duplicates={duplicates}
            onOpen={openForm}
          />
        </>
      )}

      {household && (
        <HouseholdManageDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          household={household}
          others={households.filter((h) => h.id !== household.id)}
        />
      )}
      {editor}
    </div>
  );
}

/** Rinomina, unisci a un'altra abitazione (stesso indirizzo scritto diverso), elimina se vuota. */
function HouseholdManageDialog({
  open,
  onOpenChange,
  household,
  others,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  household: Household;
  others: Household[];
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [name, setName] = useState(household.name);
  const [into, setInto] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(household.name);
      setInto('');
      setError(null);
    }
  }, [open, household.name]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['utility-bills'], refetchType: 'all' });

  const rename = useMutation({
    mutationFn: () => householdsApi.rename(household.id, name),
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  const merge = useMutation({
    mutationFn: (target: string) => householdsApi.merge(household.id, target),
    onSuccess: async (_r, target) => {
      // Prima si va all'abitazione di destinazione, poi si ricarica: al
      // contrario per un attimo si vedeva "questa abitazione non esiste più".
      onOpenChange(false);
      await navigate({ to: '/bills/$householdId', params: { householdId: target } });
      void refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  const onMerge = async () => {
    const target = others.find((o) => o.id === into);
    if (!target) return;
    const ok = await confirm({
      title: `Unire “${household.name}” a “${target.name}”?`,
      description: `Le ${household.billCount} bollette passano a “${target.name}” e “${household.name}” sparisce. Non si può annullare dall’app.`,
      confirmLabel: 'Unisci',
      destructive: true,
    });
    if (ok) merge.mutate(target.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gestisci abitazione</DialogTitle>
          <DialogDescription>{household.address ?? 'Indirizzo non indicato'}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate();
          }}
        >
          <Label htmlFor="household-name">Nome</Label>
          <div className="flex gap-2">
            <Input id="household-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!name.trim() || name.trim() === household.name || rename.isPending}>
              Salva
            </Button>
          </div>
        </form>
        {others.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="household-merge">Unisci a un’altra abitazione</Label>
            <p className="text-xs text-muted-foreground">
              Se è la stessa casa riconosciuta due volte (indirizzo scritto in modo diverso).
            </p>
            <div className="flex gap-2">
              <select
                id="household-merge"
                value={into}
                onChange={(e) => setInto(e.target.value)}
                className="fm-glass-field h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Scegli…</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" disabled={!into || merge.isPending} onClick={onMerge}>
                Unisci
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
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
  const years = useMemo(() => yearlySummary(bills), [bills]);
  const yearOptions = useMemo(() => billYears(bills), [bills]);
  // `recent` = ultimi 24 mesi; un numero = quell'anno, confrontato col precedente.
  const [period, setPeriod] = useState<'recent' | number>('recent');
  useEffect(() => {
    if (period !== 'recent' && !yearOptions.includes(period)) setPeriod('recent');
  }, [period, yearOptions]);
  const selected = period === 'recent' ? null : (years.find((y) => y.year === period) ?? null);
  const previous = useMemo(
    () => (period === 'recent' ? undefined : monthlyTotalsOfYear(bills, period - 1)),
    [bills, period],
  );
  const hasPrevious = !!previous?.some((v) => v !== null);

  return (
    <>
      <div className={cn('grid gap-3', present.length === 3 ? 'md:grid-cols-3' : present.length === 2 ? 'sm:grid-cols-2' : '')}>
        {present.map((u) => (
          <SummaryCard key={u} summary={summaries[u]} onClick={() => onPick(u)} />
        ))}
      </div>
      <Card className="fm-card-in">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">Spesa mensile</h2>
              <p className="text-sm text-muted-foreground">Ogni bolletta ripartita sui mesi che copre</p>
            </div>
            {selected ? (
              <div className="text-right">
                <div className="text-xs text-muted-foreground">
                  Totale {selected.year}
                  {!selected.complete && ' · anno parziale'}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Delta value={selected.deltaPct} label="Spesa" compareLabel={`rispetto al ${selected.year - 1}`} />
                  <span className="text-xl font-semibold tracking-tight">
                    <MoneyAmount cents={selected.totalCents} size="row" />
                  </span>
                </div>
              </div>
            ) : (
              total12 && (
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">
                    {monthTick(total12.from)} – {monthTick(total12.to)}
                    {total12.months < 12 && ` · ${total12.months} ${total12.months === 1 ? 'mese' : 'mesi'}`}
                  </div>
                  <div className="text-xl font-semibold tracking-tight">
                    <MoneyAmount cents={total12.costCents} size="row" />
                  </div>
                </div>
              )
            )}
          </div>
          {yearOptions.length > 0 && (
            // Con molti anni il selettore scorre di lato invece di uscire dallo schermo.
            <div className="fm-no-scrollbar -mx-5 overflow-x-auto px-5">
            <Segmented
              label="Periodo"
              value={String(period)}
              onChange={(v) => setPeriod(v === 'recent' ? 'recent' : Number(v))}
              options={[
                { key: 'recent', label: 'Ultimi 24 mesi' },
                ...yearOptions.map((y) => ({ key: String(y), label: String(y) })),
              ]}
            />
            </div>
          )}
          <CostStackChart series={series} year={period === 'recent' ? undefined : period} previous={previous} />
          <Legend utilities={present} previousYear={period !== 'recent' && hasPrevious ? period - 1 : undefined} />
        </CardContent>
      </Card>
      {years.length > 0 && <YearComparison years={years} present={present} />}
    </>
  );
}

/** Confronto tra anni: spesa per servizio, totale e variazione sull'anno prima. */
function YearComparison({ years, present }: { years: ReturnType<typeof yearlySummary>; present: UtilityKind[] }) {
  return (
    <Card className="fm-card-in overflow-hidden">
      <CardContent className="space-y-4 p-0">
        <div className="px-5 pt-5">
          <h2 className="text-[17px] font-semibold tracking-tight">Anno per anno</h2>
          <p className="text-sm text-muted-foreground">
            La variazione si calcola solo tra anni coperti per intero da tutte le bollette.
          </p>
        </div>
        {years.length > 1 && (
          <div className="px-5">
            <YearCompareChart years={years} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-5 py-2 font-medium">Anno</th>
                {present.map((u) => (
                  <th key={u} className="px-2 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: utilColor(u) }} />
                      {UTILITY_META[u].label}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">Totale</th>
                <th className="px-5 py-2 text-right font-medium">Variazione</th>
              </tr>
            </thead>
            <tbody>
              {[...years].reverse().map((y) => (
                <tr key={y.year} className="border-t border-border/60">
                  <td className="px-5 py-2.5 font-medium">
                    {y.year}
                    {!y.complete && <span className="ml-1.5 text-xs font-normal text-muted-foreground">parziale</span>}
                  </td>
                  {present.map((u) => (
                    <td key={u} className="px-2 py-2.5 text-right">
                      {y.costCents[u] === null ? '—' : <MoneyAmount cents={y.costCents[u]!} size="row" />}
                    </td>
                  ))}
                  <td className="px-2 py-2.5 text-right font-semibold">
                    <MoneyAmount cents={y.totalCents} size="row" />
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {y.deltaPct === null ? (
                      <span className="text-xs text-muted-foreground">n.d.</span>
                    ) : (
                      <Delta value={y.deltaPct} label="Spesa" compareLabel={`rispetto al ${y.year - 1}`} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pb-1" />
      </CardContent>
    </Card>
  );
}

function Legend({ utilities, previousYear }: { utilities: UtilityKind[]; previousYear?: number }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      {utilities.map((u) => (
        <span key={u} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: utilColor(u) }} />
          {UTILITY_META[u].label}
        </span>
      ))}
      {previousYear && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-foreground/55" />
          Totale {previousYear}
        </span>
      )}
    </div>
  );
}

/** Variazione colorata: per una spesa salire è il dato negativo. */
function Delta({
  value,
  label,
  compareLabel = 'rispetto ai 12 mesi precedenti',
}: {
  value: number | null;
  label: string;
  compareLabel?: string;
}) {
  if (value === null) return null;
  const up = value > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        up ? 'bg-[hsl(var(--neg-soft))] text-[hsl(var(--neg))]' : 'bg-[hsl(var(--pos-soft))] text-[hsl(var(--pos))]',
      )}
      title={`${label} ${compareLabel}`}
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
  const energy = useMemo(() => energyPrices(bills, utility), [bills, utility]);
  // Media della materia prima nelle bollette degli ultimi 12 mesi della finestra.
  const energyAvg = useMemo(
    () =>
      averageEnergyPrice(
        energy.filter(
          (p) =>
            (!summary.windowFrom || p.date.slice(0, 7) >= summary.windowFrom) &&
            (!summary.lastMonth || p.date.slice(0, 7) <= summary.lastMonth),
        ),
      ),
    [energy, summary.windowFrom, summary.lastMonth],
  );
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
            {utility === 'water' ? (
              <Stat label="Bollette" value={String(summary.billCount)} />
            ) : (
              <Stat
                label="Materia prima media"
                value={<span className="money-blur-target">{formatUnitPrice(utility, energyAvg)}</span>}
                hint="Prezzo della sola materia prima, pesato sui consumi, nella finestra dei 12 mesi"
              />
            )}
            <Stat label="Variazione consumo" value={summary.consumptionDeltaPct === null ? 'n.d.' : formatPct(summary.consumptionDeltaPct)} hint="12 mesi contro i 12 precedenti" />
          </CardContent>
        </Card>
      </div>

      {overlaps.length > 0 && (
        <p className="flex gap-2 rounded-xl bg-[hsl(var(--warn-soft))] px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warn))]" />
          {overlaps.length === 1 ? 'Due bollette coprono' : `${overlaps.length} coppie di bollette coprono`} lo stesso periodo:
          nei grafici i consumi si sommano. Se una è un doppione eliminala; se è un acconto ricalcolato da un conguaglio, togli il consumo dall'acconto (il costo resta).
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
              <p className="text-sm text-muted-foreground">
                {utility === 'water'
                  ? 'Bolletta per bolletta, tutto compreso.'
                  : 'Il prezzo totale (tutto compreso) e quello della sola materia prima, bolletta per bolletta.'}{' '}
                Le linee verticali segnano un cambio di fornitore.
              </p>
            </div>
            {new Set([...prices.map((p) => p.billId), ...energy.map((p) => p.billId)]).size > 1 ? (
              <>
                <UnitPriceChart points={prices} energy={energy} utility={utility} />
                {utility !== 'water' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-4 border-t-[2.5px]" style={{ borderColor: utilColor(utility) }} /> Prezzo totale
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-4 border-t-2 border-dashed" style={{ borderColor: utilColor(utility, 0.6) }} /> Materia prima
                      {energy.length === 0 && ' (non presente nelle bollette)'}
                    </span>
                  </div>
                )}
              </>
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

function PendingBills({
  bills,
  households,
  onOpen,
}: {
  bills: UtilityBill[];
  households: Household[];
  onOpen: (b: UtilityBill) => void;
}) {
  const houseName = (id: string | null) => households.find((h) => h.id === id)?.name ?? null;
  const qc = useQueryClient();
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null);
  // Rilettura del PDF senza aprire il form: la bolletta torna "in lettura" e
  // il polling della pagina ne segue l'esito.
  const retry = useMutation({
    mutationFn: (id: string) => billsApi.reextract(id),
    onMutate: () => setRetryError(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['utility-bills'], refetchType: 'all' }),
    onError: (e: Error, id) => setRetryError({ id, message: e.message }),
  });

  return (
    <Card className="fm-card-in overflow-hidden">
      <CardContent className="p-0">
        <h2 className="flex items-center gap-2 px-5 pb-1 pt-4 text-[15px] font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Da verificare
        </h2>
        <ul>
          {bills.map((b) => {
            const failed = b.status === 'failed';
            const retrying = retry.isPending && retry.variables === b.id;
            return (
              <li key={b.id} className="border-t border-border/60 first:border-t-0">
                <div className="flex flex-wrap items-center gap-x-2 pr-3 transition-colors hover:bg-muted/40 has-[button:disabled]:hover:bg-transparent sm:flex-nowrap">
                  <button
                    type="button"
                    disabled={b.status === 'extracting'}
                    onClick={() => onOpen(b)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-5 text-left disabled:cursor-default"
                  >
                    {b.status === 'extracting' ? (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[0.65rem] bg-muted">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </span>
                    ) : b.lines.length > 0 ? (
                      <UtilityStack utilities={b.lines.map((l) => l.utility)} />
                    ) : (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[0.65rem] bg-[hsl(var(--warn-soft))]">
                        <AlertTriangle className="h-4 w-4 text-[hsl(var(--warn))]" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {b.status === 'extracting'
                          ? 'Sto leggendo la bolletta…'
                          : failed
                            ? 'Lettura non riuscita'
                            : (b.provider ?? b.fileName ?? 'Bolletta')}
                      </span>
                      <span className={cn('block text-xs text-muted-foreground', failed ? 'line-clamp-2' : 'truncate')}>
                        {b.status === 'extracting'
                          ? `${b.fileName ?? 'PDF'} · di solito meno di un minuto`
                          : failed
                            ? `${b.fileName ? `${b.fileName} · ` : ''}${b.extractionError ?? 'Riprova o compila a mano'}`
                            : [periodLabel(b.periodStart, b.periodEnd), houseName(b.householdId), b.extractionModel ? modelLabel(b.extractionModel) : null]
                                .filter(Boolean)
                                .join(' · ')}
                      </span>
                    </span>
                    {!failed && b.status !== 'extracting' && (
                      <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                        Verifica
                      </span>
                    )}
                  </button>
                  {failed && (
                    // Su smartphone i pulsanti vanno su una riga propria, allineati al testo:
                    // affiancati al titolo lo troncavano a "Lettura non …".
                    <div className="flex w-full shrink-0 items-center gap-1.5 pb-3 pl-[3.75rem] sm:w-auto sm:pb-0 sm:pl-0">
                      {b.hasFile && (
                        <button
                          type="button"
                          onClick={() => retry.mutate(b.id)}
                          disabled={retry.isPending}
                          aria-label={`Riprova a leggere ${b.fileName ?? 'la bolletta'}`}
                          className="fm-press inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} />
                          Riprova
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpen(b)}
                        className="fm-press rounded-full bg-[hsl(var(--warn-soft))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--warn))]"
                      >
                        Compila
                      </button>
                    </div>
                  )}
                </div>
                {retryError?.id === b.id && (
                  <p role="alert" className="px-5 pb-3 text-xs text-[hsl(var(--neg))]">
                    {retryError.message}
                  </p>
                )}
              </li>
            );
          })}
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
  const [page, setPage] = useState(1);
  const sorted = useMemo(
    () =>
      [...bills].sort(
        (a, b) =>
          (b.periodEnd ?? b.createdAt).localeCompare(a.periodEnd ?? a.createdAt) ||
          b.createdAt.localeCompare(a.createdAt),
      ),
    [bills],
  );
  const pages = Math.max(1, Math.ceil(sorted.length / BILLS_PAGE_SIZE));
  // Dopo un'eliminazione l'ultima pagina può sparire: si resta sull'ultima valida.
  const current = Math.min(page, pages);
  const pageItems = sorted.slice((current - 1) * BILLS_PAGE_SIZE, current * BILLS_PAGE_SIZE);

  const byYear = new Map<string, UtilityBill[]>();
  for (const b of pageItems) {
    const y = (b.periodEnd ?? b.createdAt).slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), b]);
  }
  const years = [...byYear.keys()].sort().reverse();
  const first = (current - 1) * BILLS_PAGE_SIZE + 1;
  const last = Math.min(current * BILLS_PAGE_SIZE, sorted.length);
  return (
    <section className="space-y-3" aria-label="Elenco bollette">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">Bollette</h2>
        {sorted.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {pages > 1 ? `${first}–${last} di ${sorted.length}` : `${sorted.length} ${sorted.length === 1 ? 'bolletta' : 'bollette'}`}
          </span>
        )}
      </div>
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
      {pages > 1 && (
        <nav aria-label="Pagine delle bollette" className="flex items-center justify-center gap-2 pt-1">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={() => setPage(current - 1)}
            disabled={current <= 1}
            aria-label="Pagina precedente"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[7.5rem] text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">
            Pagina {current} di {pages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages}
            aria-label="Pagina successiva"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      )}
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
