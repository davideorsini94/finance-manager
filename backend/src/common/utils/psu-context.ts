import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';

/**
 * Contesto "PSU" (Payment Service User): dice se dietro una chiamata alla
 * banca c'è un utente in carne e ossa davanti allo schermo.
 *
 * Perché serve: le ASPSP applicano i limiti PSD2 sugli accessi ai dati in
 * base alla **presenza degli header PSU**. Senza, la richiesta vale come
 * fetch di sottofondo non presidiato e molte banche italiane (Fineco su
 * tutte) concedono solo **4 accessi al giorno**; con gli header, la
 * richiesta è "presidiata" e i limiti sono molto più larghi. Finché non li
 * mandavamo, aprire il wizard di collegamento bruciava l'intera quota
 * giornaliera e il click su "Collega" tornava 429.
 *
 * Come funziona: un middleware apre un contesto per ogni richiesta HTTP
 * (utente online per definizione). I job cron girano fuori da qualsiasi
 * richiesta, quindi non trovano nessun contesto e restano correttamente
 * "non presidiati". `AsyncLocalStorage` propaga il contesto attraverso le
 * continuazioni async, quindi anche il sync automatico lanciato in
 * fire-and-forget subito dopo un collegamento resta attribuito all'utente.
 */
export interface PsuContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Gli user agent finiscono in un header HTTP verso terzi: teniamoli corti. */
const MAX_USER_AGENT_LENGTH = 200;

const storage = new AsyncLocalStorage<PsuContext>();

export function runWithPsuContext<T>(context: PsuContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getPsuContext(): PsuContext | undefined {
  return storage.getStore();
}

/**
 * IP utilizzabile come `Psu-Ip-Address`, oppure `null`.
 *
 * Dietro nginx (`trust proxy` attivo in `main.ts`) Express espone già l'IP
 * del client; qui si srotola la forma IPv4-mappata-in-IPv6 e si scartano i
 * valori che non descrivono nessun utente reale — dichiarare "utente online"
 * con un IP di loopback sarebbe una mezza verità detta alla banca.
 */
export function normalizePsuIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const unmapped = trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
  if (isIP(unmapped) === 0) return null;
  if (unmapped === '127.0.0.1' || unmapped === '::1') return null;
  return unmapped;
}

/**
 * Header PSU per la richiesta in corso. Oggetto vuoto se non c'è un utente
 * online: in quel caso la banca deve trattarci come fetch di sottofondo.
 */
export function psuHeaders(): Record<string, string> {
  const context = storage.getStore();
  if (!context) return {};

  const headers: Record<string, string> = {};
  if (context.ipAddress) headers['Psu-Ip-Address'] = context.ipAddress;
  if (context.userAgent) {
    headers['Psu-User-Agent'] = context.userAgent.slice(0, MAX_USER_AGENT_LENGTH);
  }
  return headers;
}
