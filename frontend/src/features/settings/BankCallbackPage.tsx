import { useEffect, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api/client';

/**
 * Pagina pubblica di ritorno dal consenso bancario.
 *
 * Su iOS il redirect della banca atterra in Safari FUORI dalla PWA e senza
 * sessione: la pagina non richiede autenticazione e si limita a inoltrare
 * `code` + `state` all'endpoint pubblico del backend, che scambia subito il
 * code (ha vita brevissima). Nessun redirect automatico: l'utente torna
 * all'app da solo (l'app fa polling sullo stato della connessione).
 */
export function BankCallbackPage() {
  const { code, state, error: providerError } = useSearch({ strict: false }) as {
    code?: string;
    state?: string;
    error?: string;
  };

  const [status, setStatus] = useState<'sending' | 'ok' | 'error'>('sending');
  const [message, setMessage] = useState<string | null>(null);
  // Lo `state` è monouso: in StrictMode l'effect viene invocato due volte e
  // la seconda chiamata fallirebbe con 410. Guardia esplicita.
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    if (providerError) {
      setStatus('error');
      setMessage(`La banca ha rifiutato l'autorizzazione (${providerError}).`);
      return;
    }
    if (!code || !state) {
      setStatus('error');
      setMessage(
        'Link di ritorno incompleto: mancano i parametri di autorizzazione. Riprova il collegamento dall’app.',
      );
      return;
    }

    void (async () => {
      try {
        // Non parsiamo il body: basta il 2xx (il backend risponde { ok: true }).
        await api.post('bank-sync/callback', { json: { code, state }, timeout: 30_000 });
        setStatus('ok');
      } catch (e) {
        setStatus('error');
        setMessage((e as Error).message || 'Errore durante il completamento del collegamento.');
      }
    })();
  }, [code, state, providerError]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Collegamento bancario</CardTitle>
          <CardDescription>Finance Manager</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 py-2 text-center">
          {status === 'sending' && (
            <>
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Completamento dell&apos;autorizzazione in corso…
              </p>
            </>
          )}

          {status === 'ok' && (
            <>
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <p className="text-base font-medium">Autorizzazione completata ✓</p>
              <p className="text-sm text-muted-foreground">
                Torna all&apos;app Finance Manager per scegliere quali conti collegare. Puoi
                chiudere questa pagina.
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="mx-auto h-10 w-10 text-rose-600" />
              <p className="text-base font-medium">Autorizzazione non riuscita</p>
              <p className="text-sm text-muted-foreground break-words">{message}</p>
              <p className="text-xs text-muted-foreground">
                Riapri il wizard “Collega una banca” dalle impostazioni e riprova.
              </p>
            </>
          )}

          <a
            href="/"
            className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Apri l&apos;app
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
