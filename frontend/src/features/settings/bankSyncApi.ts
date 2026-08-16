import { api } from '@/lib/api/client';

/**
 * Client per il sync bancario (Enable Banking, Fase 2 e Fase 3).
 *
 * Nota sui timeout: il default di ky è 10s, ma gli endpoint che passano dal
 * provider PSD2 (lista istituti, avvio consenso, dettagli conti, test
 * credenziali, sincronizzazione movimenti) possono essere molto più lenti —
 * per quelli alziamo il timeout per-call come previsto dal piano.
 */

const PROVIDER_TIMEOUT_MS = 30_000;
/** Il sync vero e proprio interroga la banca e può richiedere più tempo. */
const SYNC_TIMEOUT_MS = 60_000;

// ---------- Credenziali (admin) ----------

export interface BankSyncCredentialsStatus {
  hasCredentials: boolean;
  /** Application ID offuscato. La chiave privata PEM non viene MAI restituita. */
  appIdMasked: string | null;
}

export interface UpdateBankSyncCredentialsInput {
  appId: string;
  /** Chiave privata RS256 in formato PEM: cifrata at-rest, mai rileggibile. */
  privateKeyPem: string;
}

export interface BankSyncTestResult {
  ok: boolean;
  message: string;
}

// ---------- Istituti ----------

export interface BankInstitution {
  name: string;
  country: string;
  logo: string | null;
  /**
   * Durata massima del consenso dichiarata dalla banca, in **secondi**
   * (`maximum_consent_validity` Enable Banking). Vedi `consentValidityDays`
   * in `BankLinkWizard.tsx` per la conversione a giorni mostrata in UI.
   */
  maximumConsentValidity: number | null;
  psuTypes: string[];
}

export interface BankInstitutionsResponse {
  items: BankInstitution[];
}

// ---------- Connessioni e link ----------

export type BankConnectionStatus =
  | 'pending'
  | 'linked'
  | 'expired'
  | 'suspended'
  | 'revoked'
  | 'error';

export interface BankAccountLink {
  id: string;
  accountId: string;
  accountName: string;
  providerAccountId: string;
  iban: string | null;
  currency: string;
  syncEnabled: boolean;
  /** Data/ora dell'ultima sincronizzazione riuscita (cron o manuale), o mai. */
  lastSyncAt: string | null;
  /**
   * Saldo dichiarato dalla banca all'ultimo sync, in centesimi (stringa
   * BigInt, come `Account.balanceCents`). `null` se non ancora disponibile.
   */
  lastBalanceCents: string | null;
  /** Data/ora a cui si riferisce `lastBalanceCents`. */
  lastBalanceAt: string | null;
}

export interface BankConnection {
  id: string;
  institutionName: string;
  institutionLogo: string | null;
  status: BankConnectionStatus;
  consentExpiresAt: string | null;
  createdAt: string;
  links: BankAccountLink[];
}

export interface BankConnectionsResponse {
  items: BankConnection[];
}

export interface CreateConnectionInput {
  aspspName: string;
  aspspCountry: string;
  institutionLogo?: string;
}

export interface CreateConnectionResult {
  connectionId: string;
  /** URL di autorizzazione della banca: va aperto nel browser dell'utente. */
  authUrl: string;
}

/** Conto bancario esposto dal provider dopo il consenso, prima del mapping. */
export interface ProviderAccount {
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
  alreadyLinked: boolean;
}

export interface ProviderAccountsResponse {
  items: ProviderAccount[];
}

/** Esattamente uno tra `accountId` (conto esistente) e `newAccount`. */
export interface CreateLinkInput {
  connectionId: string;
  providerAccountId: string;
  accountId?: string;
  newAccount?: { name: string };
}

export interface LinkResponse {
  link: BankAccountLink;
}

// ---------- Sincronizzazione manuale (Fase 3) ----------

export interface SyncResult {
  linkId: string;
  accountId: string;
  accountName: string;
  /** Movimenti letti dalla banca in questa chiamata. */
  fetched: number;
  /** Nuovi movimenti messi in coda per la revisione. */
  staged: number;
  /** Movimenti già visti in precedenza (dedup) e quindi scartati. */
  duplicates: number;
  /** Movimenti scartati perché in una valuta diversa da quella del conto. */
  skippedCurrency: number;
  /**
   * Movimenti scartati perché la banca non li ha ancora contabilizzati
   * (pending/non "booked"): arriveranno al prossimo sync una volta contabilizzati.
   */
  skippedPending?: number;
  /** Messaggio d'errore per questo conto, se il sync è fallito solo per lui. */
  error: string | null;
}

export interface SyncAllResponse {
  results: SyncResult[];
  /** Sincronizzazioni manuali residue per l'utente, per oggi. */
  quotaRemaining: number;
}

export interface SyncLinkResponse {
  result: SyncResult;
  quotaRemaining: number;
}

// ---------- Orari di sincronizzazione automatica ----------

/**
 * Tetto di sincronizzazioni automatiche al giorno: PSD2 limita a 4 gli accessi
 * ai conti non presidiati dall'utente. Deve restare allineato a
 * `MAX_SYNC_TIMES` del backend.
 */
export const MAX_SYNC_TIMES = 4;

export interface SyncScheduleResponse {
  /** Orari HH:mm (ora italiana), ordinati. Lista vuota = sync automatico spento. */
  times: string[];
}

export interface ReviewCountResponse {
  /** Movimenti in staging (`pending_review`) sui conti su cui l'utente ha scrittura. */
  count: number;
}

export const bankSyncApi = {
  // --- credenziali (solo admin) ---
  getCredentials: () => api.get('settings/bank-sync').json<BankSyncCredentialsStatus>(),
  updateCredentials: (data: UpdateBankSyncCredentialsInput) =>
    api.put('settings/bank-sync', { json: data }).json<BankSyncCredentialsStatus>(),
  removeCredentials: () => api.delete('settings/bank-sync'),
  testCredentials: () =>
    api
      .post('settings/bank-sync/test', { timeout: PROVIDER_TIMEOUT_MS })
      .json<BankSyncTestResult>(),

  // --- istituti ---
  institutions: (country = 'IT') =>
    api
      .get('bank-sync/institutions', { searchParams: { country }, timeout: PROVIDER_TIMEOUT_MS })
      .json<BankInstitutionsResponse>(),

  // --- connessioni ---
  createConnection: (data: CreateConnectionInput) =>
    api
      .post('bank-sync/connections', { json: data, timeout: PROVIDER_TIMEOUT_MS })
      .json<CreateConnectionResult>(),
  listConnections: () => api.get('bank-sync/connections').json<BankConnectionsResponse>(),
  /** Stato locale della connessione: è l'endpoint su cui la UI fa polling. */
  getConnection: (id: string) =>
    api.get(`bank-sync/connections/${encodeURIComponent(id)}`).json<BankConnection>(),
  connectionAccounts: (id: string) =>
    api
      .get(`bank-sync/connections/${encodeURIComponent(id)}/accounts`, {
        timeout: PROVIDER_TIMEOUT_MS,
      })
      .json<ProviderAccountsResponse>(),
  removeConnection: (id: string) =>
    api.delete(`bank-sync/connections/${encodeURIComponent(id)}`, {
      timeout: PROVIDER_TIMEOUT_MS,
    }),
  /**
   * Rinnova il consenso di una connessione linked/expired/suspended/error:
   * rigenera lo stato lato backend e restituisce una nuova `authUrl` da
   * aprire sul sito della banca. La connessione torna `pending` finché il
   * callback non completa lo scambio del code (vedi polling in
   * `BankConnectionsCard`).
   */
  renewConnection: (id: string) =>
    api
      .post(`bank-sync/connections/${encodeURIComponent(id)}/renew`, {
        timeout: PROVIDER_TIMEOUT_MS,
      })
      .json<CreateConnectionResult>(),

  // --- link conto app ↔ conto banca ---
  createLink: (data: CreateLinkInput) =>
    api.post('bank-sync/links', { json: data }).json<LinkResponse>(),
  updateLink: (id: string, syncEnabled: boolean) =>
    api
      .patch(`bank-sync/links/${encodeURIComponent(id)}`, { json: { syncEnabled } })
      .json<LinkResponse>(),
  removeLink: (id: string) => api.delete(`bank-sync/links/${encodeURIComponent(id)}`),

  // --- sincronizzazione manuale (Fase 3): timeout esteso, passa dalla banca ---
  syncAll: () =>
    api.post('bank-sync/sync', { timeout: SYNC_TIMEOUT_MS }).json<SyncAllResponse>(),
  syncLink: (id: string) =>
    api
      .post(`bank-sync/links/${encodeURIComponent(id)}/sync`, { timeout: SYNC_TIMEOUT_MS })
      .json<SyncLinkResponse>(),
  reviewCount: () => api.get('bank-sync/review/count').json<ReviewCountResponse>(),

  // --- orari del sync automatico (max 4/giorno, passi di 15') ---
  getSchedule: () => api.get('bank-sync/schedule').json<SyncScheduleResponse>(),
  updateSchedule: (times: string[]) =>
    api.put('bank-sync/schedule', { json: { times } }).json<SyncScheduleResponse>(),
};
