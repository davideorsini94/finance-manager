import ky, { HTTPError, type KyInstance } from 'ky';
import { useUIStore } from '@/store/uiStore';
import { demoHandle } from '@/lib/demo/handlers';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

let refreshInFlight: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      await ky.post(`${BASE_URL}/auth/refresh`, { credentials: 'include' });
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * In modalità demo: corto circuito le richieste e ritorno dati finti senza
 * mai toccare il backend. Le mutation tornano `{ ok: true, demo: true }` —
 * la UI può comunque invalidare le query (refetch ricarica i dati demo
 * statici), così l'esperienza non si rompe.
 */
function maybeDemoResponse(request: Request): Response | null {
  const isDemo = useUIStore.getState().demoData;
  if (!isDemo) return null;

  const url = new URL(request.url, window.location.origin);
  const data = demoHandle({
    pathname: url.pathname,
    search: url.searchParams,
    method: request.method.toUpperCase(),
  });

  // Le richieste streaming/binarie (SSE notifiche, attachments, backup) non
  // sono coperte dal dataset demo: ritorno comunque un 200 vuoto coerente
  // così non vediamo errori 404 in console.
  const body = data === null && request.method === 'GET' ? null : (data ?? { ok: true, demo: true });
  return new Response(body === null ? 'null' : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const api: KyInstance = ky.create({
  prefixUrl: BASE_URL,
  credentials: 'include',
  retry: 0,
  // `no-store` impedisce a browser/SW di servire risposte cached per le
  // chiamate API: i bilanci dei conti devono essere sempre freschi dopo
  // un giroconto/movimento. Il SW comunque non cacha più /api/, ma se
  // un vecchio SW è ancora attivo nel browser dell'utente questa
  // opzione lo costringe a fare bypass.
  cache: 'no-store',
  hooks: {
    beforeRequest: [
      (request) => {
        const demo = maybeDemoResponse(request);
        if (demo) return demo;
      },
    ],
    afterResponse: [
      async (request, _options, response) => {
        if (response.status !== 401) return response;
        const url = request.url;
        if (url.includes('/auth/refresh') || url.includes('/auth/login')) return response;

        const ok = await attemptRefresh();
        if (!ok) {
          onUnauthorized?.();
          return response;
        }
        const retried = await ky(request);
        return retried;
      },
    ],
    beforeError: [
      async (error: HTTPError) => {
        try {
          const body = (await error.response.clone().json()) as { message?: string };
          if (body?.message) error.message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        } catch {
          // ignore
        }
        return error;
      },
    ],
  },
});
