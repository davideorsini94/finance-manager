import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  UserPlus,
  Send,
  Copy,
  Check,
  Trash2,
  Mail,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { formatDate } from '@/lib/utils/date';
import { invitesApi, type CreateInviteResponse } from './invitesApi';

const schema = z.object({
  email: z.string().email('Email non valida'),
});

type FormValues = z.infer<typeof schema>;

export function InviteUsersCard() {
  const queryClient = useQueryClient();
  const [lastInvite, setLastInvite] = useState<CreateInviteResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const invitesQuery = useQuery({
    queryKey: ['invites'],
    queryFn: () => invitesApi.list(),
  });

  const create = useMutation({
    mutationFn: (email: string) => invitesApi.create(email),
    onSuccess: (data) => {
      setLastInvite(data);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ['invites'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => invitesApi.revoke(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invites'] });
      setRevokeId(null);
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit((values) => {
    create.mutate(values.email, {
      onSuccess: () => reset({ email: '' }),
    });
  });

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const invites = invitesQuery.data ?? [];
  const target = invites.find((i) => i.id === revokeId);

  return (
    <CollapsibleCard
      title={
        <>
          <UserPlus className="h-4 w-4" />
          Inviti utenti
        </>
      }
      description="La registrazione è solo su invito. Inserisci l'email di chi vuoi invitare: se SMTP è configurato la persona riceverà un'email con il link, altrimenti ti viene mostrato il link da copiare e inviare a mano (es. su WhatsApp)."
      storageKey="fm-cfg-inviti"
    >
      <div className="space-y-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="invite-email">Email del nuovo utente</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="famiglia@example.com"
              {...register('email')}
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>
          <Button type="submit" disabled={create.isPending}>
            <Send className="h-4 w-4 mr-2" />
            {create.isPending ? 'Invio…' : 'Invia invito'}
          </Button>
        </form>

        {create.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="break-words">{(create.error as Error).message}</p>
          </div>
        )}

        {lastInvite && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm space-y-2">
            <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="h-4 w-4" />
              Invito creato per {lastInvite.email}
            </p>
            <p className="text-xs text-muted-foreground">
              {lastInvite.emailSent ? (
                <>
                  <Mail className="inline h-3 w-3 mr-1" />
                  Email inviata. Scade il {formatDate(lastInvite.expiresAt)}.
                </>
              ) : (
                <>
                  Email NON inviata (SMTP non configurato o errore di invio). Copia il link
                  qui sotto e mandalo a mano. Scade il {formatDate(lastInvite.expiresAt)}.
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={lastInvite.inviteUrl}
                className="font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copyLink(lastInvite.inviteUrl)}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5" /> Copiato
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copia
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium mb-2">Inviti pendenti</h4>
          {invitesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun invito attivo.</p>
          ) : (
            <ul className="space-y-2">
              {invites.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <span className="truncate flex-1 min-w-0">{i.email}</span>
                  <Badge variant="outline" className="font-normal">
                    <Clock className="h-3 w-3 mr-1" />
                    scade {formatDate(i.expiresAt)}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => copyLink(i.inviteUrl)}
                    title="Copia link invito"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setRevokeId(i.id)}
                    aria-label="Revoca invito"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(o) => !o && !revoke.isPending && setRevokeId(null)}
        title="Revocare invito?"
        description={
          target ? (
            <span>
              L'invito per <strong>{target.email}</strong> non sarà più valido. Se vuoi
              riprovare dovrai crearne uno nuovo.
            </span>
          ) : null
        }
        confirmLabel="Revoca"
        destructive
        loading={revoke.isPending}
        onConfirm={() => revokeId && revoke.mutate(revokeId)}
      />
    </CollapsibleCard>
  );
}
