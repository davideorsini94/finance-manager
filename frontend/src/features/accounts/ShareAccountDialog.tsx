import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import type { Account, AccountMemberRole, UserSummary } from '@/types/domain';
import { accountsApi } from './accountsApi';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
  currentUserId: string;
}

type WriteOrRead = Exclude<AccountMemberRole, 'owner'>;

const ROLE_LABEL: Record<WriteOrRead, string> = {
  read: 'sola lettura',
  write: 'scrittura',
};

type PendingAdd = {
  kind: 'add';
  user: UserSummary;
  role: WriteOrRead;
};
type PendingUpdate = {
  kind: 'update';
  userId: string;
  userLabel: string;
  role: WriteOrRead;
};
type PendingRemove = {
  kind: 'remove';
  userId: string;
  userLabel: string;
};
type PendingAction = PendingAdd | PendingUpdate | PendingRemove;

export function ShareAccountDialog({ open, onOpenChange, account, currentUserId }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedRole, setSelectedRole] = useState<WriteOrRead>('write');
  const [pending, setPending] = useState<PendingAction | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const usersQuery = useQuery({
    queryKey: ['users', debounced],
    queryFn: () => accountsApi.searchUsers(debounced),
    enabled: open,
  });

  const addMember = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WriteOrRead }) =>
      accountsApi.addMember(account.id, userId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setSearch('');
      setPending(null);
    },
  });

  const updateMember = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WriteOrRead }) =>
      accountsApi.updateMember(account.id, userId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setPending(null);
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => accountsApi.removeMember(account.id, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setPending(null);
    },
  });

  const memberIds = new Set(account.members.map((m) => m.userId));
  memberIds.add(account.ownerId);
  const candidates = (usersQuery.data ?? []).filter(
    (u) => !memberIds.has(u.id) && u.id !== currentUserId,
  );

  const isMutating = addMember.isPending || updateMember.isPending || removeMember.isPending;

  const onConfirm = () => {
    if (!pending) return;
    if (pending.kind === 'add') {
      addMember.mutate({ userId: pending.user.id, role: pending.role });
    } else if (pending.kind === 'update') {
      updateMember.mutate({ userId: pending.userId, role: pending.role });
    } else {
      removeMember.mutate(pending.userId);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Condividi {account.name}</DialogTitle>
            <DialogDescription>
              Aggiungi utenti registrati e scegli il loro livello d'accesso. Ogni
              modifica richiede una conferma.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Membri attuali</h4>
              <ul className="space-y-2">
                <li className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span className="truncate">{account.owner.fullName ?? account.owner.email}</span>
                  <Badge>Proprietario</Badge>
                </li>
                {account.members.map((m) => {
                  const label = m.user.fullName ?? m.user.email;
                  return (
                    <li
                      key={m.userId}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      <span className="truncate flex-1">{label}</span>
                      <Select
                        value={m.role}
                        onValueChange={(role) => {
                          const newRole = role as WriteOrRead;
                          if (newRole === m.role) return;
                          setPending({
                            kind: 'update',
                            userId: m.userId,
                            userLabel: label,
                            role: newRole,
                          });
                        }}
                      >
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read">Sola lettura</SelectItem>
                          <SelectItem value="write">Scrittura</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setPending({ kind: 'remove', userId: m.userId, userLabel: label })
                        }
                        aria-label="Rimuovi"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-search">Aggiungi utente</Label>
              <div className="flex gap-2">
                <Input
                  id="user-search"
                  placeholder="Email o nome…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Select
                  value={selectedRole}
                  onValueChange={(v) => setSelectedRole(v as WriteOrRead)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Lettura</SelectItem>
                    <SelectItem value="write">Scrittura</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {candidates.length > 0 && (
                <ul className="max-h-48 overflow-y-auto rounded-md border divide-y">
                  {candidates.map((u) => (
                    <li key={u.id} className="flex items-center justify-between p-2 text-sm">
                      <span className="truncate">{u.fullName ?? u.email}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPending({ kind: 'add', user: u, role: selectedRole })
                        }
                      >
                        Aggiungi
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {debounced && !usersQuery.isLoading && candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">Nessun utente trovato.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && !isMutating && setPending(null)}
        title={confirmTitle(pending, account.name)}
        description={confirmDescription(pending, account.name)}
        confirmLabel={confirmCta(pending)}
        destructive={pending?.kind === 'remove'}
        loading={isMutating}
        onConfirm={onConfirm}
      />
    </>
  );
}

function confirmTitle(p: PendingAction | null, accountName: string): string {
  if (!p) return '';
  if (p.kind === 'add') return `Condividere "${accountName}"?`;
  if (p.kind === 'update') return 'Cambiare permesso?';
  return 'Rimuovere accesso?';
}

function confirmDescription(p: PendingAction | null, accountName: string) {
  if (!p) return null;
  if (p.kind === 'add') {
    return (
      <span>
        Stai per condividere <strong>{accountName}</strong> con{' '}
        <strong>{p.user.fullName ?? p.user.email}</strong> con permesso{' '}
        <strong>{ROLE_LABEL[p.role]}</strong>. L'utente vedrà il conto e i suoi
        movimenti subito dopo la conferma.
      </span>
    );
  }
  if (p.kind === 'update') {
    return (
      <span>
        Cambiare il ruolo di <strong>{p.userLabel}</strong> in{' '}
        <strong>{ROLE_LABEL[p.role]}</strong> sul conto{' '}
        <strong>{accountName}</strong>?
      </span>
    );
  }
  return (
    <span>
      <strong>{p.userLabel}</strong> non potrà più vedere il conto{' '}
      <strong>{accountName}</strong> né i suoi movimenti. I movimenti che ha
      eventualmente già inserito restano sul conto.
    </span>
  );
}

function confirmCta(p: PendingAction | null): string {
  if (!p) return 'Conferma';
  if (p.kind === 'add') return 'Condividi';
  if (p.kind === 'update') return 'Cambia ruolo';
  return 'Rimuovi';
}
