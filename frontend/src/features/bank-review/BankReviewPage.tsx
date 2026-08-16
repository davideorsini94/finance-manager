import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  EyeOff,
  Link2,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Tag,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CategoryPicker } from '@/components/shared/CategoryPicker';
import { cn } from '@/lib/utils/cn';
import { formatCents } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { useUIStore } from '@/store/uiStore';
import type { Category } from '@/types/domain';
import { bankSyncApi, type SyncAllResponse } from '@/features/settings/bankSyncApi';
import { SyncSummaryPanel, syncErrorMessage } from '@/features/settings/syncSummary';
import {
  bankReviewApi,
  CONFIRM_MAX_IDS,
  DEFAULT_PAGE_SIZE,
  IGNORE_MAX_IDS,
  PAGE_SIZE_OPTIONS,
  type ConfirmReviewResult,
  type ReviewItem,
  type ReviewStatus,
  type UpdateReviewItemInput,
} from './bankReviewApi';

type EffectiveType = 'income' | 'expense' | 'transfer';

const TYPE_LABEL: Record<EffectiveType, string> = {
  income: 'Entrata',
  expense: 'Uscita',
  transfer: 'Giroconto',
};

/** Chiave localStorage della dimensione pagina scelta (persiste tra sessioni). */
const PAGE_SIZE_STORAGE_KEY = 'fm-bank-review-page-size';

function loadStoredPageSize(): number {
  const stored = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
  return PAGE_SIZE_OPTIONS.includes(stored) ? stored : DEFAULT_PAGE_SIZE;
}

/** Una singola PATCH da applicare a una riga della coda. */
interface PatchOp {
  id: string;
  data: UpdateReviewItemInput;
}

/**
 * Riga *visualizzata*: le coppie giroconto fondono le due gambe in una sola
 * riga. `item` è la gamba primaria (quella su cui agiscono le azioni: il
 * backend include automaticamente la controparte alla conferma).
 */
interface ReviewRow {
  id: string;
  item: ReviewItem;
  /** L'altra gamba, se presente nella stessa lista. */
  mate: ReviewItem | null;
  /** Data usata per ordinamento e raggruppamento (la più recente della coppia). */
  date: string;
}

// ============================================================================
// Helpers di dominio
// ============================================================================

/**
 * Tipo effettivo della riga: `transfer` per le coppie, altrimenti il tipo
 * proposto dal backend, con fallback sul segno dell'importo.
 */
function effectiveType(item: ReviewItem): EffectiveType {
  if (item.pair) return 'transfer';
  if (item.suggestedType === 'income' || item.suggestedType === 'expense') {
    return item.suggestedType;
  }
  return Number(item.amountCents) >= 0 ? 'income' : 'expense';
}

/**
 * Importo da mostrare: il *tipo* comanda sul segno grezzo della banca, così
 * forzare entrata/uscita si vede subito anche prima del refetch. Sulle coppie
 * il segno non ha senso (il verso lo dà "ContoA → ContoB"): valore assoluto.
 */
function displayCents(item: ReviewItem): number {
  const raw = Number(item.amountCents);
  const type = effectiveType(item);
  if (type === 'expense') return -Math.abs(raw);
  return Math.abs(raw);
}

function toneFor(type: EffectiveType): string {
  if (type === 'transfer') return 'text-muted-foreground';
  return type === 'income'
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';
}

function itemLabel(item: ReviewItem): string {
  return item.description || item.counterparty || TYPE_LABEL[effectiveType(item)];
}

/** Fonde le coppie giroconto e ordina per data decrescente. */
function buildRows(items: ReviewItem[]): ReviewRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const used = new Set<string>();
  const rows: ReviewRow[] = [];

  for (const item of items) {
    if (used.has(item.id)) continue;
    used.add(item.id);
    if (item.pair) {
      // La controparte può mancare dalla lista (es. conto senza permesso di
      // scrittura): i metadati in `pair` bastano comunque a disegnare la riga.
      const mate = byId.get(item.pair.stagedId) ?? null;
      if (mate) used.add(mate.id);
      const date =
        item.pair.effectiveDate > item.effectiveDate ? item.pair.effectiveDate : item.effectiveDate;
      rows.push({ id: item.id, item, mate, date });
    } else {
      rows.push({ id: item.id, item, mate: null, date: item.effectiveDate });
    }
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

function groupByDate(rows: ReviewRow[]): Array<{ date: string; rows: ReviewRow[] }> {
  const groups: Array<{ date: string; rows: ReviewRow[] }> = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) last.rows.push(row);
    else groups.push({ date: row.date, rows: [row] });
  }
  return groups;
}

function dateHeading(iso: string): string {
  const label = formatDate(iso, 'EEEE d MMMM yyyy');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ============================================================================
// Pagina
// ============================================================================

export function BankReviewPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ReviewStatus>('pending_review');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(loadStoredPageSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmReviewResult | null>(null);
  const [syncSummary, setSyncSummary] = useState<SyncAllResponse | null>(null);
  const [categoryTarget, setCategoryTarget] = useState<ReviewItem | null>(null);
  const [pairTarget, setPairTarget] = useState<ReviewItem | null>(null);

  // La pagina corrente vale solo per il tab attivo: gli altri restano alla
  // prima (le loro query servono comunque per i contatori `total` nei tab).
  const pageFor = (tab: ReviewStatus) => (activeTab === tab ? page : 1);

  const pendingQuery = useQuery({
    queryKey: ['bank-review', 'pending_review', pageFor('pending_review'), pageSize],
    queryFn: () =>
      bankReviewApi.list({ status: 'pending_review', page: pageFor('pending_review'), pageSize }),
    // "Keep previous data": cambiando pagina la lista non sfarfalla vuota.
    placeholderData: keepPreviousData,
    // La categorizzazione LLM gira in background dopo il sync (job detached):
    // finché c'è almeno una riga senza categoria (né finale né suggerita),
    // ripolla per far comparire i suggerimenti da soli senza refresh manuale.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const awaitingSuggestion = items.some(
        (item) => !item.finalCategory && !item.suggestedCategoryId,
      );
      return awaitingSuggestion ? 15000 : false;
    },
  });
  const duplicatesQuery = useQuery({
    queryKey: ['bank-review', 'duplicate', pageFor('duplicate'), pageSize],
    queryFn: () => bankReviewApi.list({ status: 'duplicate', page: pageFor('duplicate'), pageSize }),
    placeholderData: keepPreviousData,
  });
  const ignoredQuery = useQuery({
    queryKey: ['bank-review', 'ignored', pageFor('ignored'), pageSize],
    queryFn: () => bankReviewApi.list({ status: 'ignored', page: pageFor('ignored'), pageSize }),
    placeholderData: keepPreviousData,
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  const pendingItems = useMemo(() => pendingQuery.data?.items ?? [], [pendingQuery.data]);
  const rows = useMemo(() => buildRows(pendingItems), [pendingItems]);
  const groups = useMemo(() => groupByDate(rows), [rows]);
  const duplicates = duplicatesQuery.data?.items ?? [];
  const ignored = ignoredQuery.data?.items ?? [];
  const pendingTotal = pendingQuery.data?.total ?? 0;
  const duplicatesTotal = duplicatesQuery.data?.total ?? 0;
  const ignoredTotal = ignoredQuery.data?.total ?? 0;

  // Se il totale del tab attivo cala (conferme/ignora), la pagina corrente
  // può non esistere più: si rientra sull'ultima disponibile.
  const activeTotal =
    activeTab === 'pending_review'
      ? pendingTotal
      : activeTab === 'duplicate'
        ? duplicatesTotal
        : ignoredTotal;
  const activeTotalPages = Math.max(1, Math.ceil(activeTotal / pageSize));
  useEffect(() => {
    if (page > activeTotalPages) setPage(activeTotalPages);
  }, [page, activeTotalPages]);

  const changeTab = (tab: string) => {
    setActiveTab(tab as ReviewStatus);
    setPage(1);
    setSelected(new Set());
  };

  const changePage = (next: number) => {
    setPage(Math.max(1, next));
    setSelected(new Set());
  };

  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
    setSelected(new Set());
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
  };

  /** Le query di revisione + il contatore mostrato in Impostazioni. */
  const invalidateReview = () => {
    void queryClient.invalidateQueries({ queryKey: ['bank-review'], refetchType: 'all' });
    void queryClient.invalidateQueries({ queryKey: ['bank-sync-review-count'], refetchType: 'all' });
  };

  /** Dopo una conferma cambiano anche movimenti, saldi, report e derivati. */
  const invalidateAfterConfirm = () => {
    invalidateReview();
    for (const key of ['transactions', 'accounts', 'dashboard', 'report', 'report-tx', 'budgets', 'goals', 'projections']) {
      void queryClient.invalidateQueries({ queryKey: [key], refetchType: 'all' });
    }
  };

  /** Trigger manuale del sync bancario direttamente dalla coda di revisione. */
  const syncNow = useMutation({
    mutationFn: () => bankSyncApi.syncAll(),
    onMutate: () => {
      setActionError(null);
      setSyncSummary(null);
    },
    onSuccess: (data) => {
      setSyncSummary(data);
      invalidateReview();
      void queryClient.invalidateQueries({ queryKey: ['bank-connections'], refetchType: 'all' });
    },
    onError: (e) => setActionError(syncErrorMessage(e)),
  });

  const patch = useMutation({
    // Sequenziale: sono sempre 1-2 operazioni (categoria, tipo, accoppia,
    // ripristina). L'ignora — che poteva essere di centinaia di righe e
    // sforava il rate-limit — è passato all'endpoint bulk dedicato (sotto).
    mutationFn: async (ops: PatchOp[]) => {
      for (const op of ops) await bankReviewApi.update(op.id, op.data);
    },
    onMutate: () => setActionError(null),
    onSuccess: invalidateReview,
    onError: (e: Error) => setActionError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (ids: string[]) => bankReviewApi.confirm(ids),
    onMutate: () => {
      setActionError(null);
      setConfirmResult(null);
    },
    onSuccess: (result) => {
      setConfirmResult(result);
      setSelected(new Set());
      invalidateAfterConfirm();
    },
    onError: (e: Error) => setActionError(e.message),
  });

  /**
   * Ignora bulk: UNA richiesta per N righe (il ciclo di PATCH sforava il
   * rate-limit globale con centinaia di selezioni → 429). Le coppie vengono
   * espanse dal backend: basta passare una gamba.
   */
  const ignoreMutation = useMutation({
    mutationFn: (ids: string[]) => bankReviewApi.ignoreMany(ids),
    onMutate: () => setActionError(null),
    onSuccess: (result) => {
      setSelected(new Set());
      if (result.errors.length > 0) {
        const n = result.errors.length;
        setActionError(
          `${n} moviment${n === 1 ? 'o non ignorato' : 'i non ignorati'} — ${result.errors[0].message}`,
        );
      }
      invalidateReview();
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const busy = patch.isPending || confirmMutation.isPending || ignoreMutation.isPending;

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedCount = selectedRows.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const confirmSelected = () => {
    // Per le coppie basta una gamba: il backend include l'altra da sé.
    const ids = selectedRows.slice(0, CONFIRM_MAX_IDS).map((r) => r.item.id);
    if (ids.length === 0) return;
    confirmMutation.mutate(ids);
  };

  const ignoreSelected = () => {
    // Basta una gamba per coppia: il backend include l'altra da sé.
    const ids = selectedRows.slice(0, IGNORE_MAX_IDS).map((r) => r.item.id);
    if (ids.length === 0) return;
    ignoreMutation.mutate(ids);
  };

  const loading = pendingQuery.isLoading;
  const isEmpty = !loading && rows.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ClipboardCheck className="h-6 w-6" />
            Da confermare
          </h1>
          <p className="text-sm text-muted-foreground">
            Movimenti importati dalla banca in attesa di revisione. Controlla categoria e tipo,
            poi conferma: solo allora entrano nei tuoi movimenti e aggiornano i saldi.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={syncNow.isPending}
          onClick={() => syncNow.mutate()}
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', syncNow.isPending && 'animate-spin')} />
          {t('bankSync.syncNow')}
        </Button>
      </div>

      {syncSummary && (
        <SyncSummaryPanel summary={syncSummary} onDismiss={() => setSyncSummary(null)} />
      )}

      {confirmResult && (
        <ConfirmSummary result={confirmResult} onDismiss={() => setConfirmResult(null)} />
      )}

      {actionError && (
        <p className="flex items-start gap-1 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {actionError}
        </p>
      )}

      {pendingQuery.isError && (
        <p className="flex items-start gap-1 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {(pendingQuery.error as Error).message}
        </p>
      )}

      <Tabs value={activeTab} onValueChange={changeTab}>
        {/* Contatori dai `total` (conteggio pieno), non da items.length che è
            limitato alla pagina corrente. */}
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="pending_review" className="flex-1 sm:flex-none">
            Da confermare ({pendingTotal})
          </TabsTrigger>
          <TabsTrigger value="duplicate" className="flex-1 sm:flex-none">
            Duplicati ({duplicatesTotal})
          </TabsTrigger>
          <TabsTrigger value="ignored" className="flex-1 sm:flex-none">
            Ignorati ({ignoredTotal})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending_review" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <p className="p-6 text-sm text-muted-foreground">Caricamento…</p>
              ) : isEmpty ? (
                <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <Check className="h-6 w-6" />
                  </div>
                  <p className="text-base font-medium">Tutto confermato ✓</p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Non c'è nulla da rivedere. I nuovi movimenti compariranno qui dopo la prossima
                    sincronizzazione con la banca.
                  </p>
                </div>
              ) : (
                <div>
                  {groups.map((group) => (
                    <div key={group.date}>
                      <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium tracking-wide text-muted-foreground sm:px-4">
                        {dateHeading(group.date)}
                      </div>
                      <ul className="divide-y">
                        {group.rows.map((row) => (
                          <ReviewRowView
                            key={row.id}
                            row={row}
                            selected={selected.has(row.id)}
                            busy={busy}
                            onToggle={() => toggleRow(row.id)}
                            onCategory={() => setCategoryTarget(row.item)}
                            onIgnore={() => ignoreMutation.mutate([row.item.id])}
                            onUnpair={() =>
                              patch.mutate([{ id: row.item.id, data: { pairWithStagedId: null } }])
                            }
                            onPair={() => setPairTarget(row.item)}
                            onSetType={(type) => patch.mutate([{ id: row.item.id, data: { type } }])}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              <PaginationBar
                total={pendingTotal}
                page={pageFor('pending_review')}
                pageSize={pageSize}
                onPageChange={changePage}
                onPageSizeChange={changePageSize}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="duplicate" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <p className="border-b px-3 py-2 text-xs text-muted-foreground sm:px-4">
                Movimenti che sembrano già registrati in app. Non possono essere confermati: se non
                è un duplicato, riportalo tra quelli da confermare.
              </p>
              {duplicates.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {duplicatesQuery.isLoading ? 'Caricamento…' : 'Nessun probabile duplicato.'}
                </p>
              ) : (
                <ul className="divide-y">
                  {duplicates.map((item) => (
                    <DuplicateRowView
                      key={item.id}
                      item={item}
                      busy={busy}
                      onRestore={() => patch.mutate([{ id: item.id, data: { restore: true } }])}
                    />
                  ))}
                </ul>
              )}
              <PaginationBar
                total={duplicatesTotal}
                page={pageFor('duplicate')}
                pageSize={pageSize}
                onPageChange={changePage}
                onPageSizeChange={changePageSize}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ignored" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <p className="border-b px-3 py-2 text-xs text-muted-foreground sm:px-4">
                Movimenti che hai scelto di non registrare. Puoi sempre rimetterli in coda: quelli
                usciti dalla finestra di sincronizzazione vengono eliminati automaticamente.
              </p>
              {ignored.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {ignoredQuery.isLoading ? 'Caricamento…' : 'Nessun movimento ignorato.'}
                </p>
              ) : (
                <ul className="divide-y">
                  {ignored.map((item) => (
                    <IgnoredRowView
                      key={item.id}
                      item={item}
                      busy={busy}
                      onRestore={() => patch.mutate([{ id: item.id, data: { restore: true } }])}
                    />
                  ))}
                </ul>
              )}
              <PaginationBar
                total={ignoredTotal}
                page={pageFor('ignored')}
                pageSize={pageSize}
                onPageChange={changePage}
                onPageSizeChange={changePageSize}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Spaziatore: la barra azioni è `fixed` e coprirebbe l'ultima riga.
          Barra e spaziatore solo sul tab "Da confermare" (selezione multipla). */}
      {activeTab === 'pending_review' && rows.length > 0 && (
        <div aria-hidden className="h-20 lg:h-24" />
      )}

      {activeTab === 'pending_review' && rows.length > 0 && (
        <BulkActionBar
          total={rows.length}
          selectedCount={selectedCount}
          allSelected={allSelected}
          busy={busy}
          onToggleAll={toggleAll}
          onConfirm={confirmSelected}
          onIgnore={ignoreSelected}
        />
      )}

      {categoryTarget && (
        <CategoryDialog
          item={categoryTarget}
          categories={categoriesQuery.data ?? []}
          onClose={() => setCategoryTarget(null)}
          onSelect={(categoryId) =>
            patch.mutate([{ id: categoryTarget.id, data: { categoryId } }], {
              onSuccess: () => setCategoryTarget(null),
            })
          }
        />
      )}

      {pairTarget && (
        <PairDialog
          item={pairTarget}
          candidates={pendingItems}
          busy={patch.isPending}
          onClose={() => setPairTarget(null)}
          onSelect={(otherId) =>
            patch.mutate([{ id: pairTarget.id, data: { pairWithStagedId: otherId } }], {
              onSuccess: () => setPairTarget(null),
            })
          }
        />
      )}
    </div>
  );
}

// ============================================================================
// Barra azioni fissa (pattern nuovo: sta SOPRA la BottomNav, safe-area iOS)
// ============================================================================

function BulkActionBar({
  total,
  selectedCount,
  allSelected,
  busy,
  onToggleAll,
  onConfirm,
  onIgnore,
}: {
  total: number;
  selectedCount: number;
  allSelected: boolean;
  busy: boolean;
  onToggleAll: () => void;
  onConfirm: () => void;
  onIgnore: () => void;
}) {
  const none = selectedCount === 0;
  // Su desktop la barra non deve coprire la Sidebar (colonna in flusso, non
  // fixed): la spostiamo a destra della sua larghezza corrente.
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  return (
    // `fm-actionbar`: su iOS standalone il visual viewport può restare
    // pannato e gli elementi fixed "galleggiano" — `ios-viewport.ts` applica
    // a questa classe la stessa compensazione translateY della BottomNav.
    // Offset verticale: safe-area + altezza della BottomNav (visibile solo
    // sotto lg) + spazio per il FAB centrale che sporge di 12px.
    <div
      className={cn(
        'fm-actionbar fixed left-0 right-0 z-30 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80',
        'bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] lg:bottom-0 lg:pb-[env(safe-area-inset-bottom)]',
        'shadow-[0_-6px_20px_-8px_rgb(0_0_0_/_0.25)]',
        sidebarCollapsed ? 'lg:left-[68px]' : 'lg:left-64',
      )}
      style={{
        paddingLeft: 'calc(1rem + var(--safe-left))',
        paddingRight: 'calc(1rem + var(--safe-right))',
      }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 py-2.5">
        <button
          type="button"
          onClick={onToggleAll}
          className="flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium hover:bg-accent"
        >
          <CheckBox checked={allSelected} indeterminate={!allSelected && selectedCount > 0} />
          <span className="whitespace-nowrap">Seleziona tutto</span>
        </button>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {selectedCount} di {total} selezionat{selectedCount === 1 ? 'o' : 'i'}
          {selectedCount > CONFIRM_MAX_IDS && ` — verranno confermati i primi ${CONFIRM_MAX_IDS}`}
        </span>
        {/* Su mobile la riga va a capo: i due bottoni si dividono la larghezza
            (target touch generosi), su desktop restano compatti a destra. */}
        <div className="ml-auto flex flex-1 items-center justify-end gap-2 sm:flex-none">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={none || busy}
            onClick={onIgnore}
          >
            <EyeOff className="mr-1.5 h-4 w-4" />
            Ignora ({selectedCount})
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={none || busy}
            onClick={onConfirm}
          >
            <Check className="mr-1.5 h-4 w-4" />
            Conferma ({selectedCount})
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Quadratino di selezione (nel repo non esiste un componente checkbox). */
function CheckBox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
        checked || indeterminate
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background',
      )}
    >
      {checked && <Check className="h-3.5 w-3.5" />}
      {!checked && indeterminate && <span className="h-0.5 w-2.5 rounded bg-current" />}
    </span>
  );
}

// ============================================================================
// Righe
// ============================================================================

function ReviewRowView({
  row,
  selected,
  busy,
  onToggle,
  onCategory,
  onIgnore,
  onUnpair,
  onPair,
  onSetType,
}: {
  row: ReviewRow;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onCategory: () => void;
  onIgnore: () => void;
  onUnpair: () => void;
  onPair: () => void;
  onSetType: (type: 'income' | 'expense') => void;
}) {
  const { item } = row;
  const type = effectiveType(item);
  const tone = toneFor(type);
  const isPair = !!item.pair;
  const Icon = isPair ? ArrowLeftRight : type === 'income' ? ArrowUpRight : ArrowDownRight;

  return (
    <li className="flex items-start gap-2 p-3 sm:gap-3 sm:px-4">
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Seleziona ${itemLabel(item)}`}
        onClick={onToggle}
        className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent"
      >
        <CheckBox checked={selected} />
      </button>

      <div className={cn('mt-0.5 shrink-0 rounded-full bg-muted p-2', tone)}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {isPair ? <PairHeadline row={row} /> : <SingleHeadline item={item} />}

        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip item={item} onClick={onCategory} disabled={busy} />
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className={cn('text-right text-sm font-semibold tabular-nums sm:text-base', tone)}>
          {formatCents(displayCents(item))}
        </p>
        <RowMenu>
          {isPair ? (
            <MenuItem icon={Unlink} onSelect={onUnpair} disabled={busy}>
              Spaia
            </MenuItem>
          ) : (
            <>
              <MenuItem icon={Link2} onSelect={onPair} disabled={busy}>
                Accoppia manualmente
              </MenuItem>
              {type === 'expense' ? (
                <MenuItem icon={ArrowUpRight} onSelect={() => onSetType('income')} disabled={busy}>
                  Segna come entrata
                </MenuItem>
              ) : (
                <MenuItem
                  icon={ArrowDownRight}
                  onSelect={() => onSetType('expense')}
                  disabled={busy}
                >
                  Segna come uscita
                </MenuItem>
              )}
            </>
          )}
          <MenuItem icon={EyeOff} onSelect={onIgnore} disabled={busy} destructive>
            Ignora
          </MenuItem>
        </RowMenu>
      </div>
    </li>
  );
}

function SingleHeadline({ item }: { item: ReviewItem }) {
  return (
    <>
      <p className="truncate font-medium">{itemLabel(item)}</p>
      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        <AccountDot color={item.accountColor} />
        {item.accountName}
      </p>
    </>
  );
}

function PairHeadline({ row }: { row: ReviewRow }) {
  const { item } = row;
  const pair = item.pair!;
  // Il verso lo dà il segno: la gamba negativa è il conto di partenza.
  const outFirst = Number(item.amountCents) < 0;
  const from = outFirst ? item : pair;
  const to = outFirst ? pair : item;
  const sameDate = item.effectiveDate === pair.effectiveDate;

  return (
    <>
      <p className="truncate font-medium">{itemLabel(item)}</p>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <AccountDot color={outFirst ? item.accountColor : row.mate?.accountColor ?? null} />
        <span className="truncate">{from.accountName}</span>
        <ArrowLeftRight className="h-3 w-3 shrink-0" />
        <AccountDot color={outFirst ? row.mate?.accountColor ?? null : item.accountColor} />
        <span className="truncate">{to.accountName}</span>
        {!sameDate && (
          <span className="whitespace-nowrap">
            · {formatDate(from.effectiveDate, 'd MMM')} → {formatDate(to.effectiveDate, 'd MMM')}
          </span>
        )}
      </p>
    </>
  );
}

function AccountDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? 'hsl(var(--muted-foreground))' }}
    />
  );
}

/**
 * Chip della categoria proposta/assegnata. La confidenza si mostra solo
 * quando la categoria visualizzata è ancora quella suggerita dall'LLM.
 */
function CategoryChip({
  item,
  onClick,
  disabled,
}: {
  item: ReviewItem;
  onClick: () => void;
  disabled: boolean;
}) {
  const category = item.finalCategory;
  const isSuggestion = !!category && category.id === item.suggestedCategoryId;
  const confidence =
    isSuggestion && item.suggestedConfidence !== null && item.suggestedConfidence < 1
      ? Math.round(item.suggestedConfidence * 100)
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50',
        !category && 'border-dashed text-muted-foreground',
      )}
      style={category?.color ? { borderColor: category.color } : undefined}
      title="Cambia categoria"
    >
      <Tag className="h-3 w-3 shrink-0" />
      <span className="truncate">{category ? category.name : 'Senza categoria'}</span>
      {confidence !== null && (
        <span className="shrink-0 text-[10px] text-muted-foreground">{confidence}%</span>
      )}
    </button>
  );
}

function DuplicateRowView({
  item,
  busy,
  onRestore,
}: {
  item: ReviewItem;
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 p-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{itemLabel(item)}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <AccountDot color={item.accountColor} />
          {item.accountName} · {formatDate(item.effectiveDate)}
        </p>
        {item.duplicateOf && (
          <p className="mt-0.5 truncate text-xs text-amber-700 dark:text-amber-400">
            Già registrato il {formatDate(item.duplicateOf.transactionDate)}
            {item.duplicateOf.description ? ` — ${item.duplicateOf.description}` : ''}
          </p>
        )}
      </div>
      <p
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          toneFor(effectiveType(item)),
        )}
      >
        {formatCents(displayCents(item))}
      </p>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRestore}>
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        Non è un duplicato
      </Button>
    </li>
  );
}

function IgnoredRowView({
  item,
  busy,
  onRestore,
}: {
  item: ReviewItem;
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 p-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-muted-foreground">{itemLabel(item)}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <AccountDot color={item.accountColor} />
          {item.accountName} · {formatDate(item.effectiveDate)}
        </p>
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
        {formatCents(displayCents(item))}
      </p>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRestore}>
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        Ripristina
      </Button>
    </li>
  );
}

// ============================================================================
// Menu azioni riga (nel repo non c'è un dropdown-menu condiviso: Popover)
// ============================================================================

function RowMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label="Altre azioni"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="flex flex-col" onClick={() => setOpen(false)}>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  icon: Icon,
  onSelect,
  disabled,
  destructive,
  children,
}: {
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50',
        destructive && 'text-destructive',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {children}
    </button>
  );
}

// ============================================================================
// Paginazione (stesso pattern della pagina Movimenti)
// ============================================================================

function PaginationBar({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm sm:px-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="whitespace-nowrap">Per pagina:</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="hidden whitespace-nowrap sm:inline">
          {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} di {total}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Pagina precedente"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 text-xs tabular-nums text-muted-foreground">
          Pagina {page} di {totalPages}
        </span>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Pagina successiva"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Riepilogo conferma
// ============================================================================

function ConfirmSummary({
  result,
  onDismiss,
}: {
  result: ConfirmReviewResult;
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium">
          <Check className="h-4 w-4" /> Risultato della conferma
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Chiudi
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {result.confirmed} movimenti registrati
        {result.transfers > 0 &&
          ` · ${result.transfers} girocont${result.transfers === 1 ? 'o' : 'i'}`}
        {result.skipped > 0 && ` · ${result.skipped} saltat${result.skipped === 1 ? 'o' : 'i'}`}
      </p>
      {result.errors.length > 0 && (
        <ul className="space-y-1">
          {result.errors.map((e) => (
            <li key={e.id} className="flex items-start gap-1 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// Dialog: cambio categoria
// ============================================================================

function CategoryDialog({
  item,
  categories,
  onClose,
  onSelect,
}: {
  item: ReviewItem;
  categories: Category[];
  onClose: () => void;
  onSelect: (categoryId: string | null) => void;
}) {
  // Guardia anti-chiusura: il mini-dialog "crea categoria" del picker è un
  // Radix Dialog annidato e la sua chiusura chiuderebbe anche questa modale
  // (stesso trattamento di TransactionForm).
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !createOpen) onClose();
      }}
    >
      {/* flex-col + picker `inline`: con la tastiera aperta su mobile il
          viewport (dvh) cala, il pannello si restringe e a cedere è la lista
          del picker (min-h-0, scrollabile) — niente popover tagliato dal
          bordo del Dialog. */}
      <DialogContent className="flex max-w-md flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Categoria</DialogTitle>
          <DialogDescription className="truncate">{itemLabel(item)}</DialogDescription>
        </DialogHeader>

        {/* Niente bottone "Rimuovi categoria": la voce "— Nessuna —" in cima
            alla lista inline fa la stessa cosa e non ruba altezza al picker
            quando la tastiera è aperta. */}
        <CategoryPicker
          inline
          value={item.finalCategory?.id ?? null}
          onChange={(id) => onSelect(id)}
          categories={categories}
          onCreateOpenChange={setCreateOpen}
        />

        <DialogFooter className="shrink-0">
          <Button type="button" variant="ghost" onClick={onClose}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Dialog: accoppiamento manuale
// ============================================================================

function PairDialog({
  item,
  candidates,
  busy,
  onClose,
  onSelect,
}: {
  item: ReviewItem;
  candidates: ReviewItem[];
  busy: boolean;
  onClose: () => void;
  onSelect: (otherId: string) => void;
}) {
  // Compatibili: conto diverso, importo esattamente opposto, stessa valuta e
  // non già accoppiate (le stesse regole che il backend rivalida).
  const compatible = candidates.filter(
    (c) =>
      c.id !== item.id &&
      !c.pair &&
      c.accountId !== item.accountId &&
      c.currency === item.currency &&
      Number(c.amountCents) === -Number(item.amountCents),
  );

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Accoppia come giroconto</DialogTitle>
          <DialogDescription>
            {itemLabel(item)} · {formatCents(displayCents(item))} su {item.accountName}
          </DialogDescription>
        </DialogHeader>

        {compatible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nessun movimento compatibile in coda: serve una riga su un altro conto, con importo
            esattamente opposto e stessa valuta.
          </p>
        ) : (
          <ul className="-mx-2 max-h-72 divide-y overflow-y-auto">
            {compatible.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(c.id)}
                  className="flex w-full items-center gap-2 px-2 py-2.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{itemLabel(c)}</p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <AccountDot color={c.accountColor} />
                      {c.accountName} · {formatDate(c.effectiveDate)}
                    </p>
                  </div>
                  <span className={cn('shrink-0 text-sm font-semibold tabular-nums', toneFor(effectiveType(c)))}>
                    {formatCents(displayCents(c))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annulla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
