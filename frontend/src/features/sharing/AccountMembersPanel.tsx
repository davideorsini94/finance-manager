import { useEffect, useState } from 'react';
import { Crown, UserPlus, Shield, Eye, Trash2, Mail, RefreshCw, Send } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useConfirm } from '@/components/shared/confirm';

type Role = 'owner' | 'editor' | 'viewer';
interface Member {
  accountId: string;
  userId: string;
  role: Role;
  user: { id: string; email: string; fullName: string | null };
}
interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
  inviter: { fullName: string | null; email: string };
}
interface MembersData {
  account: { ownerId: string; name: string; owner: { email: string; fullName: string | null } };
  members: Member[];
  invites: Invite[];
}

export function AccountMembersPanel({ accountId, currentUserId }: { accountId: string; currentUserId: string }) {
  const [data, setData] = useState<MembersData | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('editor');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const load = async () => {
    const r = await api.get(`accounts/${accountId}/sharing/members`).json<MembersData>();
    setData(r);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  if (!data) return <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>;
  const isOwner = data.account.ownerId === currentUserId;

  const sendInvite = async () => {
    if (!inviteEmail) return;
    setBusy(true);
    try {
      await api.post(`accounts/${accountId}/sharing/invites`, {
        json: { email: inviteEmail, role: inviteRole },
      });
      setInviteEmail('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const updateRole = async (userId: string, role: Role) => {
    await api.patch(`accounts/${accountId}/sharing/members/${userId}`, { json: { role } });
    await load();
  };

  const removeMember = async (userId: string) => {
    const target = data?.members.find((m) => m.userId === userId);
    const ok = await confirm({
      title: 'Rimuovere questo membro?',
      description: target ? target.user.fullName ?? target.user.email : undefined,
      confirmLabel: 'Rimuovi',
      destructive: true,
    });
    if (!ok) return;
    await api.delete(`accounts/${accountId}/sharing/members/${userId}`);
    await load();
  };

  const revokeInvite = async (id: string) => {
    const inv = data?.invites.find((i) => i.id === id);
    const ok = await confirm({
      title: 'Revocare l\'invito?',
      description: inv?.email,
      confirmLabel: 'Revoca',
      destructive: true,
    });
    if (!ok) return;
    await api.delete(`accounts/${accountId}/sharing/invites/${id}`);
    await load();
  };

  const resendInvite = async (id: string) => {
    await api.post(`accounts/${accountId}/sharing/invites/${id}/resend`);
    await load();
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Membri di {data.account.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isOwner ? 'Invita altre persone e gestisci i loro permessi.' : 'Visualizza chi ha accesso a questo conto.'}
        </p>
      </header>

      {isOwner && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserPlus className="h-4 w-4" /> Invita un membro
          </div>
          <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
            <input
              type="email"
              placeholder="email@esempio.it"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="editor">Editor (R+W)</option>
              <option value="viewer">Viewer (R)</option>
            </select>
            <button
              type="button"
              onClick={sendInvite}
              disabled={busy || !inviteEmail}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Invia
            </button>
          </div>
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Membri attivi ({data.members.length + 1})
        </h3>
        <div className="overflow-hidden rounded-lg border">
          <ul className="divide-y">
            <MemberRow
              user={{ id: data.account.ownerId, email: data.account.owner.email, fullName: data.account.owner.fullName }}
              role="owner"
              me={data.account.ownerId === currentUserId}
            />
            {data.members.map((m) => (
              <MemberRow
                key={m.userId}
                user={m.user}
                role={m.role}
                me={m.userId === currentUserId}
                canManage={isOwner}
                onRoleChange={(r) => updateRole(m.userId, r)}
                onRemove={() => removeMember(m.userId)}
              />
            ))}
          </ul>
        </div>
      </section>

      {data.invites.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Inviti pending ({data.invites.length})
          </h3>
          <ul className="divide-y rounded-lg border">
            {data.invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Ruolo: <RoleBadge role={inv.role} /> · Scade il{' '}
                      {new Date(inv.expiresAt).toLocaleDateString('it-IT')}
                    </div>
                  </div>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => resendInvite(inv.id)}
                      title="Rinvia"
                      className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => revokeInvite(inv.id)}
                      title="Revoca"
                      className="rounded p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MemberRow(props: {
  user: { id: string; email: string; fullName: string | null };
  role: Role;
  me: boolean;
  canManage?: boolean;
  onRoleChange?: (r: Role) => void;
  onRemove?: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase">
          {(props.user.fullName ?? props.user.email).slice(0, 2)}
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            {props.user.fullName ?? props.user.email}
            {props.me && (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                tu
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{props.user.email}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {props.canManage && props.role !== 'owner' && props.onRoleChange ? (
          <select
            value={props.role}
            onChange={(e) => props.onRoleChange!(e.target.value as Role)}
            className="rounded border bg-background px-2 py-1 text-xs"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        ) : (
          <RoleBadge role={props.role} />
        )}
        {props.canManage && props.role !== 'owner' && props.onRemove && (
          <button
            type="button"
            onClick={props.onRemove}
            className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </li>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === 'owner')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        <Crown className="h-3 w-3" /> Owner
      </span>
    );
  if (role === 'editor')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
        <Shield className="h-3 w-3" /> Editor
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Eye className="h-3 w-3" /> Viewer
    </span>
  );
}
