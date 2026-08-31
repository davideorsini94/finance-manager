import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  Pencil,
  Trash2,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Wallet,
  CreditCard,
  Banknote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { formatDate } from '@/lib/utils/date';
import { sortByName } from '@/lib/utils/sort';
import { getIcon } from '@/components/shared/icon-pool';
import type { Account, AccountType, Transaction, TransactionType } from '@/types/domain';
import { accountsApi } from '@/features/accounts/accountsApi';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { transactionsApi, type ListTransactionsParams } from './transactionsApi';
import { TransactionForm } from './TransactionForm';
import { useConfirm } from '@/components/shared/confirm';
import { useQuickAdd } from '@/store/quickAddStore';

const TYPE_LABEL: Record<TransactionType, string> = {
  income: 'Entrata',
  expense: 'Uscita',
  transfer: 'Giroconto',
};

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Conto corrente',
  credit_card: 'Carta di credito',
  cash: 'Contanti',
};

const ACCOUNT_TYPE_FALLBACK_ICON: Record<AccountType, typeof Wallet> = {
  checking: Wallet,
  credit_card: CreditCard,
  cash: Banknote,
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function TransactionsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [filters, setFilters] = useState<ListTransactionsParams>({ page: 1, limit: 10 });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

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

  // Cambio filtro: torna a pagina 1 per coerenza con i risultati
  const updateFilter = (patch: Partial<ListTransactionsParams>) =>
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));

  // Cambio pagina: NON resetta gli altri filtri
  const setPage = (p: number) =>
    setFilters((prev) => ({ ...prev, page: Math.max(1, Math.min(totalPages, p)) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Movimenti</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Nuovo movimento
        </Button>
      </div>

      {accountsForSummary.length > 0 && (
        <div className="-mx-1 overflow-x-auto pb-1">
          <div className="flex snap-x snap-mandatory gap-2 px-1">
            {accountsForSummary.map((account) => (
              <div
                key={account.id}
                className="w-[260px] shrink-0 snap-start sm:w-[280px]"
              >
                <AccountSummaryCard
                  account={account}
                  selected={filters.accountId === account.id}
                  dimmed={!!filters.accountId && filters.accountId !== account.id}
                  onClick={() =>
                    updateFilter({
                      accountId:
                        filters.accountId === account.id ? undefined : account.id,
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            placeholder="Cerca descrizione…"
            value={filters.search ?? ''}
            onChange={(e) => updateFilter({ search: e.target.value || undefined })}
          />
          <Select
            value={filters.accountId ?? 'all'}
            onValueChange={(v) => updateFilter({ accountId: v === 'all' ? undefined : v })}
          >
            <SelectTrigger>
              {/* Label esplicita: la SelectValue di Radix non risolve il nome
                  se il menu non è mai stato aperto (es. filtro impostato
                  cliccando una card conto). */}
              <SelectValue placeholder="Conto">
                {filters.accountId
                  ? (accountsQuery.data ?? []).find((a) => a.id === filters.accountId)?.name
                  : 'Tutti i conti'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i conti</SelectItem>
              {sortByName(accountsQuery.data ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.categoryId ?? 'all'}
            onValueChange={(v) => updateFilter({ categoryId: v === 'all' ? undefined : v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le categorie</SelectItem>
              {sortByName(categoriesQuery.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => updateFilter({ from: e.target.value || undefined })}
          />
          <Input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => updateFilter({ to: e.target.value || undefined })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {txQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Caricamento…</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              Nessun movimento. Aggiungi il primo dalla pulsantiera in alto.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  spineColor={accountColors.get(tx.account.id) ?? null}
                  onEdit={() => {
                    setEditing(tx);
                    setFormOpen(true);
                  }}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: 'Eliminare il movimento?',
                      description: tx.description || undefined,
                      confirmLabel: 'Elimina',
                      destructive: true,
                    });
                    if (ok) remove.mutate(tx);
                  }}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
  const isTransfer = tx.type === 'transfer';
  const cents = Number(tx.amountCents);
  const isPositive = cents >= 0;
  const Icon = isTransfer ? ArrowLeftRight : isPositive ? ArrowUpRight : ArrowDownRight;
  const tone = isTransfer
    ? 'text-muted-foreground'
    : isPositive
      ? 'text-[hsl(var(--pos))]'
      : 'text-[hsl(var(--neg))]';

  return (
    <li
      className="flex items-center gap-2 border-l-[3px] p-3 pl-3 transition-colors hover:bg-muted/40 sm:gap-3 sm:pl-4 sm:pr-4"
      // La spina colorata dice a colpo d'occhio di quale conto è il movimento:
      // su conti condivisi si riconosce il proprietario prima di leggere il testo.
      style={{ borderLeftColor: spineColor ?? 'transparent' }}
    >
      <div className={`shrink-0 rounded-full p-2 bg-muted ${tone}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium truncate">
            {tx.description || (isTransfer ? 'Giroconto' : TYPE_LABEL[tx.type])}
          </p>
          {tx.category && (
            <Badge variant="outline" style={{ borderColor: tx.category.color ?? undefined }}>
              {tx.category.name}
            </Badge>
          )}
          {tx.attachments.length > 0 && (
            <span className="inline-flex items-center text-xs text-muted-foreground">
              <Paperclip className="h-3 w-3 mr-0.5" />
              {tx.attachments.length}
            </span>
          )}
          {tx.isPending && <Badge variant="secondary">Pending</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {formatDate(tx.transactionDate)} · {tx.account.name}
        </p>
      </div>
      <MoneyAmount
        cents={cents}
        size="row"
        className={`shrink-0 text-right text-sm font-semibold sm:text-base ${tone}`}
      />
      {/* Azioni sempre accessibili, anche su mobile (prima erano hidden sm:flex). */}
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 sm:h-10 sm:w-10"
          onClick={onEdit}
          aria-label="Modifica"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-9 w-9 sm:h-10 sm:w-10"
          onClick={onDelete}
          aria-label="Elimina"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function AccountSummaryCard({
  account,
  selected,
  dimmed,
  onClick,
}: {
  account: Account;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  const Icon = account.icon ? getIcon(account.icon) : ACCOUNT_TYPE_FALLBACK_ICON[account.type];
  const tint = account.color ?? undefined;
  const cardStyle = tint
    ? { backgroundColor: `${tint}24`, borderColor: `${tint}80` }
    : undefined;
  return (
    // Click sulla card = filtro per conto (toggle: un secondo click lo toglie).
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Evidenziazione con outline (non ring/box-shadow: nel tema glass
          fm-glass sovrascrive il box-shadow e l'anello sparirebbe).
          Con filtro attivo le altre card sono attenuate. */}
      <Card
        className={`border-l-4 cursor-pointer transition-all hover:shadow-md ${
          selected
            ? 'outline outline-2 outline-offset-2 outline-primary'
            : dimmed
              ? 'opacity-50 saturate-50'
              : ''
        }`}
        style={cardStyle}
      >
        <CardContent className="flex items-center gap-3 p-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: tint ? `${tint}33` : 'hsl(var(--muted))',
              color: tint ?? 'hsl(var(--foreground))',
            }}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{account.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {ACCOUNT_TYPE_LABEL[account.type]}
            </p>
          </div>
          <p className="shrink-0 text-base font-semibold tabular-nums">
            <MoneyAmount cents={account.balanceCents} size="row" />
          </p>
        </CardContent>
      </Card>
    </button>
  );
}
