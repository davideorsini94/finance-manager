import { useEffect, useState } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, XCircle, Crown, Shield, Eye } from 'lucide-react';
import { api } from '@/lib/api/client';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { HTTPError } from 'ky';

export function AcceptInvitePage() {
  const search = useSearch({ strict: false }) as { token?: string };
  const token = search.token;
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'ready' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<{ accountId: string; accountName: string; role: string } | null>(
    null,
  );
  // Rotta pubblica, fuori da AppShell: qui non c'è il ConfirmProvider, quindi
  // niente hook `useConfirm` — si monta il dialog a mano (come ShareAccountDialog).
  const [rejectOpen, setRejectOpen] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('error');
      setError('Token mancante.');
      return;
    }
    setState('ready');
  }, [token]);

  const accept = async () => {
    setState('loading');
    try {
      const r = await api.post('invites/accept', { json: { token } }).json<{
        accountId: string;
        accountName: string;
        role: string;
      }>();
      setResult(r);
      setState('success');
    } catch (e) {
      const msg = e instanceof HTTPError ? e.message : 'Errore';
      setError(msg);
      setState('error');
    }
  };

  const reject = async () => {
    try {
      await api.post('invites/reject', { json: { token } });
    } catch {
      /* ignore */
    }
    void navigate({ to: '/' });
  };

  return (
    <div className="mx-auto max-w-md p-8">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        {state === 'loading' && <p className="py-12 text-center text-sm text-muted-foreground">Caricamento…</p>}

        {state === 'ready' && (
          <>
            <h1 className="text-lg font-semibold">Sei stato invitato a un conto condiviso</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Accettando, otterrai accesso al conto e potrai vedere o modificare i movimenti in base al ruolo
              che ti è stato assegnato.
            </p>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={accept}
                className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Accetta
              </button>
              <button
                type="button"
                onClick={() => setRejectOpen(true)}
                className="rounded-md border px-4 py-2 text-sm"
              >
                Rifiuta
              </button>
            </div>
          </>
        )}

        {state === 'success' && result && (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h2 className="mt-4 text-lg font-semibold">Sei dentro!</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Ora hai accesso a <strong>{result.accountName}</strong> come <RoleInline role={result.role} />.
            </p>
            <button
              type="button"
              onClick={() => void navigate({ to: '/accounts' })}
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Vai ai conti
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="text-center">
            <XCircle className="mx-auto h-12 w-12 text-rose-600" />
            <h2 className="mt-4 text-lg font-semibold">Impossibile accettare l'invito</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void navigate({ to: '/' })}
              className="mt-6 rounded-md border px-4 py-2 text-sm"
            >
              Torna alla home
            </button>
          </div>
        )}
      </div>

      {/* Il rifiuto consuma il token: per rientrare serve un nuovo invito. */}
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Rifiutare l’invito?"
        description="L’invito verrà annullato. Per accedere al conto in seguito dovrai farti invitare di nuovo."
        confirmLabel="Rifiuta"
        destructive
        onConfirm={() => {
          setRejectOpen(false);
          void reject();
        }}
      />
    </div>
  );
}

function RoleInline({ role }: { role: string }) {
  const Icon = role === 'owner' ? Crown : role === 'editor' ? Shield : Eye;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5" /> {role}
    </span>
  );
}
