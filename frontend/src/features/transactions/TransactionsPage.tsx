import { useState } from 'react';
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
import { formatCents } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import { sortByName } from '@/lib/utils/sort';
import { getIcon } from '@/components/shared/icon-pool';
import type { Account, AccountType, Transaction, TransactionType } from '@/types/domain';
import { accountsApi } from '@/features/accounts/accountsApi';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { transactionsApi, type ListTransactionsParams } from './transactionsApi';
import { TransactionForm } from './TransactionForm';
import { useConfirm } from '@/components/shared/confirm';

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

  // Card riepilogo conti in alto: se è attivo un filtro per conto mostriamo
  // solo quel conto; altrimenti tutti i conti dell'utente.
  const accountsForSummary = sortByName(
    (accountsQuery.data ?? []).filter((a) =>
      filters.accountId ? a.id === filters.accountId : true,
    ),
  );

  // Cambio filtro: torna a pagina 1 per coerenza con i risultati
  const updateFilter = (patch: Partial<ListTransactionsParams>) =>
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));

  // Cambio pagina: NON resetta gli altri filtri
  const setPage = (p: number) =>
    setFilters((prev) => ({ ...prev, page: Math.max(1, Math.min(totalPages, p)) }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Movimenti</h1>
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
                <AccountSummaryCard account={account} />
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
              <SelectValue placeholder="Conto" />
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
      />
    </div>
  );
}

interface RowProps {
  tx: Transaction;
  onEdit: () => void;
  onDelete: () => void;
}

function TransactionRow({ tx, onEdit, onDelete }: RowProps) {
  const isTransfer = tx.type === 'transfer';
  const cents = Number(tx.amountCents);
  const isPositive = cents >= 0;
  const Icon = isTransfer ? ArrowLeftRight : isPositive ? ArrowUpRight : ArrowDownRight;
  const tone = isTransfer
    ? 'text-muted-foreground'
    : isPositive
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';

  return (
    <li className="flex items-center gap-3 p-3 sm:px-4">
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
        <p className="text-xs text-muted-foreground">
          {formatDate(tx.transactionDate)} · {tx.account.name}
        </p>
      </div>
      <p className={`shrink-0 font-semibold tabular-nums ${tone}`}>{formatCents(cents)}</p>
      <div className="hidden sm:flex items-center gap-1">
        <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Modifica">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onDelete} aria-label="Elimina">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function AccountSummaryCard({ account }: { account: Account }) {
  const Icon = account.icon ? getIcon(account.icon) : ACCOUNT_TYPE_FALLBACK_ICON[account.type];
  const tint = account.color ?? undefined;
  const cardStyle = tint
    ? { backgroundColor: `${tint}24`, borderColor: `${tint}80` }
    : undefined;
  return (
    <Card className="border-l-4 transition-colors" style={cardStyle}>
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
          {formatCents(account.balanceCents)}
        </p>
      </CardContent>
    </Card>
  );
}
