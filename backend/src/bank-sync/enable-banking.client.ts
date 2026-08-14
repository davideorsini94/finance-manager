import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'crypto';
import { sanitizeExternalText } from '../common/utils/sanitize-text';
import { BankSyncConfigService } from './bank-sync-config.service';

/**
 * Base URL **costante**: non arriva da env di proposito. È parte della
 * superficie di sicurezza (§5 del piano) — se fosse configurabile, chi tocca
 * l'ambiente potrebbe dirottare le chiamate e le credenziali firmate.
 */
const BASE_URL = 'https://api.enablebanking.com';

/** Emittente/destinatario fissi del JWT di autenticazione Enable Banking. */
const JWT_ISS = 'enablebanking.com';
const JWT_AUD = 'api.enablebanking.com';
const JWT_TTL_SECONDS = 3600;

const DEFAULT_TIMEOUT_MS = 15_000;
/** Le chiamate di consenso passano dai sistemi della banca: più lente. */
const CONSENT_TIMEOUT_MS = 25_000;

export type BankProviderErrorKind =
  | 'auth'
  | 'rejected'
  | 'not_found'
  | 'rate_limit'
  | 'network'
  | 'server'
  | 'unknown';

/** Errore "parlante" (in italiano) di una chiamata al provider bancario. */
export class BankProviderError extends Error {
  constructor(
    message: string,
    readonly kind: BankProviderErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BankProviderError';
  }
}

interface RequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Client HTTP di basso livello per Enable Banking.
 *
 * Autenticazione: JWT RS256 firmato **a ogni richiesta** con la chiave privata
 * dell'applicazione (`kid` = application ID). I token non vengono mai
 * persistiti né loggati, e la chiave in chiaro vive solo per la durata della
 * firma. Espone soltanto endpoint di lettura e di gestione del consenso:
 * nessun endpoint dispositivo (pagamenti) è implementato.
 */
@Injectable()
export class EnableBankingClient {
  private readonly logger = new Logger(EnableBankingClient.name);

  constructor(private readonly config: BankSyncConfigService) {}

  /** Dati dell'applicazione registrata: usato dal test credenziali. */
  async getApplication(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/application');
  }

  /** Elenco banche del paese (country assente = tutte quelle visibili all'app, es. Mock ASPSP in sandbox). */
  async listAspsps(country?: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/aspsps', {
      query: country ? { country } : {},
    });
  }

  /** Avvia l'autorizzazione: risponde con l'URL della banca. */
  async startAuth(body: {
    access: { valid_until: string };
    aspsp: { name: string; country: string };
    state: string;
    redirect_url: string;
    psu_type: string;
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', '/auth', {
      body,
      timeoutMs: CONSENT_TIMEOUT_MS,
    });
  }

  /** Scambia il `code` del callback con una sessione (session_id + conti). */
  async createSession(code: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', '/sessions', {
      body: { code },
      timeoutMs: CONSENT_TIMEOUT_MS,
    });
  }

  async getSession(sessionId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request<unknown>('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async getAccountDetails(accountUid: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/accounts/${encodeURIComponent(accountUid)}/details`,
    );
  }

  /** Saldi dichiarati dalla banca per il conto (Berlin Group: lista di balances). */
  async getAccountBalances(accountUid: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/accounts/${encodeURIComponent(accountUid)}/balances`,
    );
  }

  /**
   * Una pagina di movimenti. `continuationKey` è il cursore restituito dalla
   * pagina precedente (assente sull'ultima). Timeout lungo: la richiesta arriva
   * fino ai sistemi della banca e su periodi ampi è lenta.
   */
  async listTransactions(
    accountUid: string,
    params: { dateFrom?: string; continuationKey?: string } = {},
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/accounts/${encodeURIComponent(accountUid)}/transactions`,
      {
        query: { date_from: params.dateFrom, continuation_key: params.continuationKey },
        timeoutMs: CONSENT_TIMEOUT_MS,
      },
    );
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(BASE_URL + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const token = await this.signToken();

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new BankProviderError(
          'Il provider bancario non ha risposto in tempo: riprova tra qualche minuto.',
          'network',
        );
      }
      // Il messaggio grezzo può contenere dettagli di rete: resta nei log, non in risposta.
      this.logger.warn(`Chiamata ${method} ${path} fallita: ${(e as Error).message}`);
      throw new BankProviderError(
        'Impossibile contattare il provider bancario. Verifica la connessione del server.',
        'network',
      );
    }

    const raw = await res.text();
    if (!res.ok) {
      throw mapHttpError(res.status, raw);
    }
    if (!raw) return undefined as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new BankProviderError(
        'Risposta non valida dal provider bancario.',
        'unknown',
        res.status,
      );
    }
  }

  /**
   * JWT RS256 costruito a mano con `node:crypto`: l'header deve contenere il
   * `kid` (application ID) e i claim temporali sono espliciti, quindi non c'è
   * niente da guadagnare passando da una libreria (e nessuna dipendenza nuova).
   */
  private async signToken(): Promise<string> {
    const { appId, privateKeyPem } = await this.config.getCredentials();
    const iat = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: appId };
    const payload = { iss: JWT_ISS, aud: JWT_AUD, iat, exp: iat + JWT_TTL_SECONDS };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

    try {
      const signature = createSign('RSA-SHA256').update(signingInput).end().sign(privateKeyPem);
      return `${signingInput}.${signature.toString('base64url')}`;
    } catch {
      // Mai includere l'errore originale: potrebbe riportare parti della chiave.
      throw new BankProviderError(
        'Impossibile firmare la richiesta: la chiave privata salvata non è valida. Reinseriscila nelle impostazioni.',
        'auth',
      );
    }
  }
}

function b64url(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url');
}

/** Traduce lo stato HTTP del provider in un errore comprensibile per l'utente. */
function mapHttpError(status: number, rawBody: string): BankProviderError {
  const detail = extractDetail(rawBody);
  const suffix = detail ? ` (${detail})` : '';

  if (status === 401 || status === 403) {
    return new BankProviderError(
      `Credenziali Enable Banking non valide o non autorizzate: verifica application ID e chiave privata${suffix}`,
      'auth',
      status,
    );
  }
  if (status === 404) {
    return new BankProviderError(
      `Risorsa non trovata sul provider bancario${suffix}`,
      'not_found',
      status,
    );
  }
  if (status === 422 || status === 400) {
    return new BankProviderError(
      `Richiesta rifiutata dal provider bancario${suffix}`,
      'rejected',
      status,
    );
  }
  if (status === 429) {
    return new BankProviderError(
      'Troppe richieste verso il provider bancario: riprova più tardi.',
      'rate_limit',
      status,
    );
  }
  if (status >= 500) {
    return new BankProviderError(
      `Il provider bancario ha restituito un errore (${status}): riprova più tardi.`,
      'server',
      status,
    );
  }
  return new BankProviderError(
    `Errore imprevisto dal provider bancario (${status})${suffix}`,
    'unknown',
    status,
  );
}

/** Estrae un dettaglio breve dal body d'errore, sanificato (finisce in UI). */
function extractDetail(rawBody: string): string | null {
  if (!rawBody) return null;
  let text = rawBody;
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const candidate = parsed.message ?? parsed.error ?? parsed.detail ?? parsed.error_description;
    if (typeof candidate === 'string') text = candidate;
  } catch {
    // body non JSON: si usa il testo grezzo, comunque troncato
  }
  return sanitizeExternalText(text, 160);
}
