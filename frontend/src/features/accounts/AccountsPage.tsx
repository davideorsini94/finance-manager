import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Wallet, Banknote, Pencil, Share2, Archive, Star, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { PageHeader } from '@/components/shared/PageHeader';
import { SwipeRow, type SwipeAction } from '@/components/shared/SwipeRow';
import { GroupHeader } from '@/components/shared/GroupHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Skeleton } from '@/components/shared/animated/Skeleton';
import { AnimatedNumber } from '@/components/shared/animated/AnimatedNumber';
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

/** Ordine e titolo dei gruppi nell'elenco. */
const GROUPS: { type: AccountType; title: string }[] = [
  { type: 'checking', title: 'Conti correnti' },
  { type: 'cash', title: 'Contanti' },
  { type: 'credit_card', title: 'Carte di credito' },
];

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

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const totalCents = accounts.reduce((acc, a) => acc + Number(a.balanceCents), 0);
  const positive = accounts.filter((a) => Number(a.balanceCents) > 0);
  const positiveTotal = positive.reduce((acc, a) => acc + Number(a.balanceCents), 0) || 1;

  const actionsFor = (account: Account): SwipeAction[] => {
    const isOwner = account.ownerId === currentUser?.id;
    const isFav = currentUser?.favoriteAccountId === account.id;
    return [
      {
        key: 'fav',
        label: isFav ? 'Togli' : 'Preferito',
        icon: Star,
        onAction: () => setFavorite.mutate(isFav ? null : account.id),
      },
      {
        key: 'edit',
        label: 'Modifica',
        icon: Pencil,
        tone: 'primary',
        onAction: () => {
          setEditing(account);
          setFormOpen(true);
        },
      },
      ...(isOwner
        ? [
            { key: 'share', label: 'Condividi', icon: Share2, onAction: () => setShareTarget(account) },
            {
              key: 'archive',
              label: 'Archivia',
              icon: Archive,
              tone: 'destructive' as const,
              onAction: async () => {
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
              },
            },
          ]
        : []),
    ];
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Conti" action={{ label: 'Nuovo conto', onClick: openNew }} />

      {accountsQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton height={132} rounded="lg" />
          <Skeleton height={180} rounded="lg" />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="Nessun conto ancora"
            description="Crea il primo conto per iniziare a registrare i movimenti."
            action={
              <Button size="sm" onClick={openNew}>
                Nuovo conto
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* Patrimonio: la somma dei saldi (le carte pesano in negativo) e
              una barra con la quota di ogni conto in attivo. */}
          <Card className="fm-card-in p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-muted-foreground">
                Patrimonio · {accounts.length} {accounts.length === 1 ? 'conto' : 'conti'}
              </span>
            </div>
            <div className="mt-1 text-[2.25rem] leading-none sm:text-[2.5rem]">
              <AnimatedNumber
                value={totalCents / 100}
                render={(n) => <MoneyAmount cents={Math.round(n * 100)} size="hero" />}
              />
            </div>
            {positive.length > 1 && (
              <>
                <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                  {positive.map((a) => (
                    <span
                      key={a.id}
                      className="h-full first:rounded-l-full last:rounded-r-full"
                      style={{
                        flexGrow: Number(a.balanceCents) / positiveTotal,
                        flexBasis: 0,
                        backgroundColor: a.color ?? 'hsl(var(--chart-1))',
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {positive.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: a.color ?? 'hsl(var(--chart-1))' }}
                      />
                      {a.name} {Math.round((Number(a.balanceCents) / positiveTotal) * 100)}%
                    </span>
                  ))}
                </div>
              </>
            )}
          </Card>

          <div className="space-y-4">
            {GROUPS.map((g) => {
              const list = accounts.filter((a) => a.type === g.type);
              if (list.length === 0) return null;
              return (
                <div key={g.type}>
                  <GroupHeader label={g.title} />
                  <Card className="overflow-hidden">
                    <ul className="divide-y">
                      {list.map((account) => {
                        const Icon = account.icon
                          ? getIcon(account.icon)
                          : TYPE_FALLBACK_ICON[account.type];
                        const tint = account.color ?? undefined;
                        const people = account.members.length + 1;
                        const isFav = currentUser?.favoriteAccountId === account.id;
                        return (
                          <li key={account.id}>
                            <SwipeRow
                              actions={actionsFor(account)}
                              slots={4}
                              onActivate={() => {
                                setEditing(account);
                                setFormOpen(true);
                              }}
                              contentClassName="border-l-[3px] py-3 pl-3 pr-3 sm:pl-4"
                              contentStyle={{ borderLeftColor: tint ?? 'transparent' }}
                            >
                              <span
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                                style={{
                                  backgroundColor: tint ? `${tint}1f` : 'hsl(var(--muted))',
                                  color: tint ?? 'hsl(var(--foreground))',
                                }}
                                aria-hidden
                              >
                                <Icon className="h-[18px] w-[18px]" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate text-[15px] font-medium">{account.name}</span>
                                  {isFav && (
                                    <Star
                                      className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500"
                                      aria-label="Preferito"
                                    />
                                  )}
                                  {people > 1 && (
                                    <span
                                      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground"
                                      title={`Condiviso tra ${people} persone`}
                                    >
                                      <Users className="h-3 w-3" aria-hidden />
                                      {people}
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {TYPE_LABEL[account.type]}
                                </span>
                              </span>
                              <MoneyAmount
                                cents={account.balanceCents}
                                size="row"
                                className="shrink-0 text-[15px] font-semibold"
                              />
                            </SwipeRow>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </div>
              );
            })}
          </div>
        </>
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
