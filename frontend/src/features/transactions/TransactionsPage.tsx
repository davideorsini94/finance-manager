import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pencil,
  Trash2,
  Eye,
  Search,
  Receipt,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { AttachmentPreviewDialog } from '@/components/shared/AttachmentPreviewDialog';
import { PageHeader } from '@/components/shared/PageHeader';
import { SwipeRow, type SwipeAction } from '@/components/shared/SwipeRow';
import { GroupHeader } from '@/components/shared/GroupHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DateRangeChip } from '@/components/shared/DateRangeChip';
import { Skeleton } from '@/components/shared/animated/Skeleton';
import { dayLabel } from '@/lib/utils/date';
import { formatCentsSigned } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';
import { sortByName } from '@/lib/utils/sort';
import type { Account, Transaction } from '@/types/domain';
import { accountsApi } from '@/features/accounts/accountsApi';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { transactionsApi, type ListTransactionsParams } from './transactionsApi';
import { TransactionForm } from './TransactionForm';
import { TxRowContent, groupByDay } from './TxRowContent';
import { useConfirm } from '@/components/shared/confirm';
import { useQuickAdd } from '@/store/quickAddStore';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function TransactionsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [filters, setFilters] = useState<ListTransactionsParams>({ page: 1, limit: 10 });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  // Su mobile i filtri secondari (conto, categoria, date) stanno dietro un
  // bottone: aperti occupavano tutta la prima schermata prima della lista.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  const txQuery = useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => transactionsApi.list(filters),
  });

  // Propaga il filtro conto al quick-add globale (FAB mobile), così anche da
  // lì viene proposto il conto filtrato. Azzerato quando si lascia la pagina.
  const setQuickAddAccount = useQuickAdd((s) => s.setDefaultAccountId);
  useEffect(() => {
    setQuickAddAccount(filters.accountId ?? null);
    return () => setQuickAddAccount(null);
  }, [filters.accountId, setQuickAddAccount]);

  const remove = useMutation({
    mutationFn: async (tx: Transaction) => {
      if (tx.type === 'transfer' || tx.transferPairId) {
        await transactionsApi.removeTransfer(tx.id);
      } else {
        await transactionsApi.remove(tx.id);
      }
    },
    onSuccess: () => {
      // refetchType: 'all' rifettta anche query inactive (es. dashboard
      // non aperta) così i bilanci sono aggiornati ovunque dopo l'eliminazione
      // di una transazione (transfer o normale).
      void queryClient.invalidateQueries({ queryKey: ['transactions'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['accounts'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['budgets'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['goals'], refetchType: 'all' });
    },
  });

  const items = txQuery.data?.items ?? [];
  const total = txQuery.data?.total ?? 0;
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Card riepilogo conti in alto: cliccabili per filtrare i movimenti.
  // Restano tutte visibili anche con un filtro attivo, così cambiare conto
  // è un solo click; la card selezionata è evidenziata.
  const accountsForSummary = sortByName(accountsQuery.data ?? []);
  // Colore del conto per la spina delle righe: il movimento porta con sé solo
  // id/nome/tipo, il colore vive sull'Account.
  const accountColors = new Map(
    (accountsQuery.data ?? []).map((a) => [a.id, a.color ?? null] as const),
  );

  const activeFilterCount = [filters.accountId, filters.categoryId, filters.from, filters.to].filter(
    Boolean,
  ).length;

  // Cambio filtro: torna a pagina 1 per coerenza con i risultati
  const updateFilter = (patch: Partial<ListTransactionsParams>) =>
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));

  // Cambio pagina: NON resetta gli altri filtri
  const setPage = (p: number) =>
    setFilters((prev) => ({ ...prev, page: Math.max(1, Math.min(totalPages, p)) }));

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const askDelete = async (tx: Transaction) => {
    const ok = await confirm({
      title: 'Eliminare il movimento?',
      description: tx.description || undefined,
      confirmLabel: 'Elimina',
      destructive: true,
    });
    if (ok) remove.mutate(tx);
  };
  const accountName = filters.accountId
    ? (accountsQuery.data ?? []).find((a) => a.id === filters.accountId)?.name
    : undefined;
  const categoryName = filters.categoryId
    ? (categoriesQuery.data ?? []).find((c) => c.id === filters.categoryId)?.name
    : undefined;

  return (
    <div className="space-y-5">
      <PageHeader title="Movimenti" action={{ label: 'Nuovo movimento', onClick: openNew }} />

      {/* Conti come chip: tocco = filtro (un secondo tocco lo toglie). */}
      {accountsForSummary.length > 0 && (
        <div className="fm-no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {accountsForSummary.map((account) => (
            <AccountChip
              key={account.id}
              account={account}
              selected={filters.accountId === account.id}
              onClick={() =>
                updateFilter({
                  accountId: filters.accountId === account.id ? undefined : account.id,
                })
              }
            />
          ))}
        </div>
      )}

      {/* Barra di vetro dei filtri: ricerca sempre visibile; conto, categoria
          e periodo in linea da sm, dietro il pulsante filtri su telefono. */}
      <div className="space-y-2">
        <div className="fm-material flex items-center gap-1 rounded-full border p-1">
          <label className="flex min-w-0 flex-1 items-center gap-2 pl-3 sm:max-w-xs">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Cerca nei movimenti</span>
            <input
              type="search"
              placeholder="Cerca nei movimenti"
              value={filters.search ?? ''}
              onChange={(e) => updateFilter({ search: e.target.value || undefined })}
              className="h-9 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
          </label>
          <div className="hidden items-center gap-1 sm:flex">
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <FilterSelects
              accounts={accountsQuery.data ?? []}
              categories={categoriesQuery.data ?? []}
              filters={filters}
              accountName={accountName}
              onChange={updateFilter}
            />
          </div>
          <button
            type="button"
            className={cn(
              'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:hidden',
              activeFilterCount > 0 ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
            )}
            aria-expanded={filtersOpen}
            aria-label="Filtri"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
        {filtersOpen && (
          <div className="flex flex-wrap gap-2 sm:hidden">
            <FilterSelects
              accounts={accountsQuery.data ?? []}
              categories={categoriesQuery.data ?? []}
              filters={filters}
              accountName={accountName}
              onChange={updateFilter}
            />
          </div>
        )}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Filtri:</span>
            {accountName && <span className="rounded-full bg-muted px-2 py-0.5">{accountName}</span>}
            {categoryName && <span className="rounded-full bg-muted px-2 py-0.5">{categoryName}</span>}
            {(filters.from || filters.to) && (
              <span className="rounded-full bg-muted px-2 py-0.5">Periodo</span>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-primary hover:bg-accent"
              onClick={() =>
                updateFilter({ accountId: undefined, categoryId: undefined, from: undefined, to: undefined })
              }
            >
              <X className="h-3 w-3" /> Togli tutti
            </button>
          </div>
        )}
      </div>

      {txQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton height={18} width={160} rounded="md" />
          <Skeleton height={220} rounded="lg" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          {activeFilterCount > 0 || filters.search ? (
            <EmptyState
              icon={Search}
              title="Nessun movimento con questi filtri"
              description="Prova a cambiare la ricerca o a togliere i filtri."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    updateFilter({
                      search: undefined,
                      accountId: undefined,
                      categoryId: undefined,
                      from: undefined,
                      to: undefined,
                    })
                  }
                >
                  Togli i filtri
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Receipt}
              title="Ancora nessun movimento"
              description="Aggiungi il primo a mano oppure collega la banca da Impostazioni."
              action={
                <Button size="sm" onClick={openNew}>
                  Nuovo movimento
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {groupByDay(items).map((g) => (
            <div key={g.day}>
              <GroupHeader
                label={dayLabel(g.day)}
                aside={g.netCents !== 0 ? formatCentsSigned(g.netCents) : undefined}
              />
              <Card className="overflow-hidden">
                <ul className="divide-y">
                  {g.items.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      spineColor={accountColors.get(tx.account.id) ?? null}
                      onEdit={() => {
                        setEditing(tx);
                        setFormOpen(true);
                      }}
                      onDelete={() => void askDelete(tx)}
                    />
                  ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Per pagina:</span>
            <Select
              value={String(limit)}
              onValueChange={(v) => updateFilter({ limit: Number(v) })}
            >
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
            <span className="hidden sm:inline">
              {(page - 1) * limit + 1}–{Math.min(page * limit, total)} di {total}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setPage(1)}
              disabled={page <= 1}
              aria-label="Prima pagina"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              aria-label="Pagina precedente"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-xs tabular-nums text-muted-foreground min-w-[5.5rem] text-center">
              Pagina {page} di {totalPages}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Pagina successiva"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              aria-label="Ultima pagina"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <TransactionForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        transaction={editing}
        // Se è attivo un filtro per conto, in creazione propongo quel conto
        // (scavalca il conto preferito dell'utente).
        defaultAccountId={filters.accountId ?? null}
      />
    </div>
  );
}

interface RowProps {
  tx: Transaction;
  /** Colore del conto di appartenenza, mostrato come spina sul bordo sinistro. */
  spineColor: string | null;
  onEdit: () => void;
  onDelete: () => void;
}

function TransactionRow({ tx, spineColor, onEdit, onDelete }: RowProps) {
  // Stato locale: il dialog non scarica nulla finché non viene aperto, quindi
  // montarne uno per riga non ha costo (il chunk pdfjs è lazy).
  const [previewOpen, setPreviewOpen] = useState(false);
  const actions: SwipeAction[] = [
    ...(tx.attachments.length > 0
      ? [{ key: 'preview', label: 'Allegati', icon: Eye, onAction: () => setPreviewOpen(true) }]
      : []),
    { key: 'edit', label: 'Modifica', icon: Pencil, tone: 'primary' as const, onAction: onEdit },
    { key: 'delete', label: 'Elimina', icon: Trash2, tone: 'destructive' as const, onAction: onDelete },
  ];

  return (
    <li>
      {/* Tocco = modifica; scorrendo a sinistra (dito) o al passaggio (mouse)
          compaiono allegati, modifica ed elimina. La spina colorata dice di
          quale conto è il movimento, prima di leggere il testo. */}
      <SwipeRow
        actions={actions}
        slots={3}
        onActivate={onEdit}
        contentClassName="border-l-[3px] py-2.5 pl-3 pr-3 sm:pl-4"
        contentStyle={{ borderLeftColor: spineColor ?? 'transparent' }}
      >
        <TxRowContent tx={tx} />
      </SwipeRow>
      {tx.attachments.length > 0 && (
        <AttachmentPreviewDialog
          attachments={tx.attachments}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
    </li>
  );
}

/** Chip di un conto: pallino del colore, nome e saldo. */
function AccountChip({
  account,
  selected,
  onClick,
}: {
  account: Account;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'fm-press inline-flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-2.5 pr-3 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-transparent bg-accent text-accent-foreground'
          : 'border-border/80 bg-card/80 hover:bg-card',
      )}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: account.color ?? 'hsl(var(--muted-foreground))' }}
        aria-hidden
      />
      <span className="max-w-[10rem] truncate font-medium">{account.name}</span>
      <MoneyAmount cents={account.balanceCents} size="inline" className="font-semibold" />
    </button>
  );
}

/** Conto, categoria e periodo come chip (barra dei filtri). */
function FilterSelects({
  accounts,
  categories,
  filters,
  accountName,
  onChange,
}: {
  accounts: Account[];
  categories: { id: string; name: string }[];
  filters: ListTransactionsParams;
  accountName?: string;
  onChange: (patch: Partial<ListTransactionsParams>) => void;
}) {
  const chip =
    'h-8 w-auto gap-1.5 rounded-full border-border/80 bg-card/70 px-3 text-sm font-medium [&>span]:truncate';
  const on = 'border-transparent bg-accent text-accent-foreground';
  return (
    <>
      <Select
        value={filters.accountId ?? 'all'}
        onValueChange={(v) => onChange({ accountId: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className={cn(chip, 'max-w-[11rem]', filters.accountId && on)} aria-label="Conto">
          {/* Label esplicita: la SelectValue di Radix non risolve il nome se il
              menu non è mai stato aperto (es. filtro impostato da una chip conto). */}
          <SelectValue placeholder="Conto">{accountName ?? 'Tutti i conti'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tutti i conti</SelectItem>
          {sortByName(accounts).map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.categoryId ?? 'all'}
        onValueChange={(v) => onChange({ categoryId: v === 'all' ? undefined : v })}
      >
        <SelectTrigger className={cn(chip, 'max-w-[11rem]', filters.categoryId && on)} aria-label="Categoria">
          <SelectValue placeholder="Categoria" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tutte le categorie</SelectItem>
          {sortByName(categories).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DateRangeChip
        from={filters.from}
        to={filters.to}
        clearable
        emptyLabel="Sempre"
        onChange={(r) => onChange({ from: r.from, to: r.to })}
      />
    </>
  );
}
