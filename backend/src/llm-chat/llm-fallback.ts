import { HttpException } from '@nestjs/common';

/**
 * Quanto restare su Ollama dopo che OpenCode ha dichiarato il limite raggiunto.
 * Un credito esaurito non si ricarica in tre secondi: senza questa finestra
 * ogni richiesta pagherebbe una chiamata lenta destinata a fallire prima di
 * ripiegare.
 */
export const QUOTA_COOLDOWN_MS = 15 * 60_000;

/**
 * Il provider ha risposto, ma senza produrre testo. È un fallimento noto dei
 * modelli reasoning sul gateway OpenCode (delta vuoti fino alla fine): merita
 * un tipo suo, così il fallback lo riconosce senza frugare nelle stringhe.
 */
export class EmptyLlmResponseError extends Error {
  constructor(model: string) {
    super(`Il modello "${model}" non ha prodotto testo.`);
    this.name = 'EmptyLlmResponseError';
  }
}

/** Stati HTTP del gateway che non dipendono da come abbiamo formulato la richiesta. */
const FALLBACK_STATUSES = new Set([402, 403, 408, 425, 429, 500, 502, 503, 504]);

/**
 * L'errore è colpa del provider cloud (o della sua indisponibilità) e ha senso
 * riprovare con il modello locale?
 *
 * Deliberatamente NON ripiega su errori nostri (richiesta malformata, risorsa
 * mancante, bug di codice): ripiegare lì nasconderebbe il difetto e farebbe
 * girare tutto su Ollama senza che nessuno se ne accorga.
 */
export function isFallbackWorthy(error: unknown): boolean {
  if (error instanceof EmptyLlmResponseError) return true;

  const status = gatewayStatus(error);
  if (status !== null) {
    if (FALLBACK_STATUSES.has(status)) return true;
    // Il gateway elenca modelli che poi non sa servire: risponde 400
    // "Unsupported model". È un problema suo, non della nostra richiesta.
    if (status === 400) return /unsupported|not (?:found|available)|unknown model/i.test(text(error));
    return false;
  }

  // Errori di trasporto: timeout del nostro AbortSignal, DNS, connessione rifiutata.
  const name = (error as Error)?.name ?? '';
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  const message = text(error);
  return /fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|non raggiungibile|non risponde|timeout/i.test(
    message,
  );
}

/** Limite raggiunto / credito esaurito: fa scattare il cooldown, non solo il fallback. */
export function isQuotaError(error: unknown): boolean {
  if (error instanceof EmptyLlmResponseError) return false;
  const status = gatewayStatus(error);
  if (status === 429 || status === 402) return true;
  return /quota|rate limit|insufficient credit|payment required/i.test(text(error));
}

/**
 * Stato HTTP dell'errore del gateway. `opencode.client.ts` costruisce messaggi
 * parlanti in cui lo status finisce nel testo ("(HTTP 500: ...)"), mentre
 * l'`HttpException` di Nest porta lo status della NOSTRA risposta: qui conta il
 * primo, altrimenti ogni `ServiceUnavailableException` sembrerebbe un 503 del
 * gateway.
 */
function gatewayStatus(error: unknown): number | null {
  const match = /HTTP (\d{3})/.exec(text(error));
  if (match) return Number(match[1]);
  // Errori con status esposto direttamente (client HTTP diversi).
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number' && !(error instanceof HttpException)) return status;
  return null;
}

function text(error: unknown): string {
  const err = error as Error & { cause?: unknown };
  const cause = err?.cause instanceof Error ? ` ${err.cause.message}` : '';
  return `${err?.message ?? String(error)}${cause}`;
}
