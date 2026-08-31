import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Wallet,
  Banknote,
  Plus,
  Pencil,
  Share2,
  Archive,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { useAuth } from '@/features/auth/useAuth';
import { getIcon } from '@/components/shared/icon-pool';
import type { Account, AccountType } from '@/types/domain';
import { accountsApi } from './accountsApi';
import { AccountForm } from './AccountForm';
import { ShareAccountDialog } from './ShareAccountDialog';
import { useConfirm } from '@/components/shared/confirm';

const TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Conto corrente',
  credit_card: 'Carta di credito',
  cash: 'Contanti',
};

/** Icona di fallback in base al tipo, se l'utente non ne ha scelta una */
const TYPE_FALLBACK_ICON: Record<AccountType, typeof Wallet> = {
  checking: Wallet,
  credit_card: CreditCard,
  cash: Banknote,
};

export function AccountsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const currentUser = useAuth((s) => s.user);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [shareTarget, setShareTarget] = useState<Account | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
    // I bilanci cambiano ad ogni transazione/giroconto. Forziamo
    // sempre un refetch fresco al mount per evitare di mostrare cache
    // stale dopo mutation eseguite altrove (es. via FAB dalla dashboard).
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const archive = useMutation({
    mutationFn: (id: string) => accountsApi.archive(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });

  // Imposta/toglie il conto preferito dell'utente loggato. Aggiorniamo
  // ottimisticamente lo store auth così l'UI riflette la stella nuova
  // senza dover rifare il bootstrap.
  const setFavorite = useMutation({
    mutationFn: (accountId: string | null) => accountsApi.setFavorite(accountId),
    onSuccess: () => {
      void useAuth.getState().bootstrap();
    },
  });

  const accounts = accountsQuery.data ?? [];
  const paymentCandidates = accounts.filter((a) => a.type !== 'credit_card');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Conti</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Nuovo conto
        </Button>
      </div>

      {accountsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nessun conto ancora. Crea il primo per iniziare a registrare i movimenti.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => {
            const Icon = account.icon ? getIcon(account.icon) : TYPE_FALLBACK_ICON[account.type];
            const tint = account.color ?? undefined;
            const isOwner = account.ownerId === currentUser?.id;
            const shared = account.members.length > 0;
            // Sfondo card: tinta del conto al ~14% di opacità per restare
            // sempre leggibile (chiaro su light, scuro su dark). Il bordo
            // sinistro pieno aggiunge identità senza disturbare il testo.
            const cardStyle = tint
              ? {
                  backgroundColor: `${tint}24`,
                  borderColor: `${tint}80`,
                }
              : undefined;
            return (
              <Card key={account.id} className="border-l-4 transition-colors" style={cardStyle}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: tint ? `${tint}33` : 'hsl(var(--muted))',
                        color: tint ?? 'hsl(var(--foreground))',
                      }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <CardTitle className="text-base truncate">{account.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">{TYPE_LABEL[account.type]}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 -mt-1 -mr-1"
                      aria-label={
                        currentUser?.favoriteAccountId === account.id
                          ? 'Rimuovi dai preferiti'
                          : 'Imposta come preferito'
                      }
                      title={
                        currentUser?.favoriteAccountId === account.id
                          ? 'Conto preferito (pre-selezionato nei nuovi movimenti). Clic per rimuovere.'
                          : 'Imposta come preferito — verrà pre-selezionato nei nuovi movimenti.'
                      }
                      onClick={() => {
                        const isFav = currentUser?.favoriteAccountId === account.id;
                        setFavorite.mutate(isFav ? null : account.id);
                      }}
                    >
                      <Star
                        className={cn(
                          'h-4 w-4 transition-colors',
                          currentUser?.favoriteAccountId === account.id
                            ? 'fill-amber-400 text-amber-500'
                            : 'text-muted-foreground hover:text-amber-500',
                        )}
                      />
                    </Button>
                    {!isOwner && <Badge variant="secondary">Condiviso</Badge>}
                    {shared && isOwner && <Badge variant="outline">{account.members.length + 1} membri</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-2xl font-semibold tabular-nums">
                    <MoneyAmount cents={account.balanceCents} size="row" />
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(account);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Modifica
                    </Button>
                    {isOwner && (
                      <Button size="sm" variant="outline" onClick={() => setShareTarget(account)}>
                        <Share2 className="h-3.5 w-3.5 mr-1.5" /> Condividi
                      </Button>
                    )}
                    {isOwner && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Archiviare "${account.name}"?`,
                            // Il ripristino NON è esposto da nessuna schermata
                            // (soft-delete `archivedAt` senza UI di gestione):
                            // il testo non deve promettere il contrario.
                            description:
                              'Il conto sparirà dalla lista e dai selettori. I movimenti restano nel database, ma dall’app non c’è modo di ripristinare un conto archiviato.',
                            confirmLabel: 'Archivia',
                            destructive: true,
                          });
                          if (ok) archive.mutate(account.id);
                        }}
                      >
                        <Archive className="h-3.5 w-3.5 mr-1.5" /> Archivia
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AccountForm
        open={formOpen}
        onOpenChange={setFormOpen}
        account={editing}
        paymentCandidates={paymentCandidates}
      />
      {shareTarget && currentUser && (
        <ShareAccountDialog
          open={!!shareTarget}
          onOpenChange={(o) => !o && setShareTarget(null)}
          account={shareTarget}
          currentUserId={currentUser.id}
        />
      )}
    </div>
  );
}
