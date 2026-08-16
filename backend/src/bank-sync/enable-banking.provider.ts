import { Injectable, Logger } from '@nestjs/common';
import {
  BankProviderPort,
  ConsentSession,
  FetchTransactionsResult,
  ProviderAccountDetails,
  ProviderAccountRef,
  ProviderBalance,
  ProviderInstitution,
  ProviderTransaction,
  StartConsentInput,
  StartConsentResult,
} from './bank-provider.port';
import { BankProviderError, EnableBankingClient } from './enable-banking.client';
import { BOOKED_STATUS, parseDecimalToCents } from './transaction-parse';

/** Cache lista banche: cambia raramente e la chiamata è pesante. */
const INSTITUTIONS_TTL_MS = 24 * 60 * 60 * 1000;

/** Cap di sicurezza sulla paginazione dei movimenti (anti-loop infinito). */
const MAX_TRANSACTION_PAGES = 50;

/** Etichetta usata in `statusCounts` per le righe senza stato dichiarato. */
const UNKNOWN_STATUS = 'UNKNOWN';

/** Attese (ms) tra i ritentativi dopo un 429 del provider. */
const RATE_LIMIT_BACKOFF_MS = [1_500, 5_000];

/** Tetto PSD2 al consenso, indipendente da quanto dichiara la banca. */
const MAX_CONSENT_DAYS = 90;

/**
 * Margine sottratto alla durata massima dichiarata dalla banca: chiedere
 * esattamente `maximum_consent_validity` fa scattare un 422 se qualche secondo
 * passa tra il calcolo e l'arrivo della richiesta.
 */
const CONSENT_SAFETY_MARGIN_MS = 60_000;

interface CachedInstitutions {
  fetchedAt: number;
  items: ProviderInstitution[];
}

/**
 * Implementazione di `BankProviderPort` su Enable Banking.
 *
 * Il parsing delle risposte è volutamente **tollerante**: lo spec Berlin Group
 * lascia opzionali molti campi e le entry dei conti in una sessione arrivano
 * ora come stringhe (solo uid) ora come oggetti. Quello che non riusciamo a
 * normalizzare resta comunque disponibile nel payload grezzo salvato in
 * `BankConnection.providerAccounts`.
 */
@Injectable()
export class EnableBankingProvider implements BankProviderPort {
  private readonly logger = new Logger(EnableBankingProvider.name);
  private readonly institutionsCache = new Map<string, CachedInstitutions>();

  constructor(private readonly client: EnableBankingClient) {}

  /** Svuota la cache istituti (da chiamare al cambio credenziali: il catalogo dipende dall'app). */
  invalidateInstitutionsCache(): void {
    this.institutionsCache.clear();
  }

  async listInstitutions(country?: string): Promise<ProviderInstitution[]> {
    const key = country?.toUpperCase() ?? 'ALL';
    const cached = this.institutionsCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < INSTITUTIONS_TTL_MS) return cached.items;

    const res = await this.client.listAspsps(country ? key : undefined);
    const rawList = asArray(res.aspsps) ?? asArray(res.data) ?? [];
    const items = rawList
      .map((entry) => this.toInstitution(entry))
      .filter((i): i is ProviderInstitution => i !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));

    this.institutionsCache.set(key, { fetchedAt: Date.now(), items });
    return items;
  }

  async startConsent(input: StartConsentInput): Promise<StartConsentResult> {
    const res = await this.client.startAuth({
      access: { valid_until: input.validUntil.toISOString() },
      aspsp: { name: input.aspspName, country: input.aspspCountry },
      state: input.state,
      redirect_url: input.redirectUrl,
      // Solo conti personali: nessuno scope dispositivo, nessun accesso business.
      psu_type: 'personal',
    });

    const authUrl = firstString(res.url, res.authorization_url, res.redirect_url);
    if (!authUrl) {
      throw new BankProviderError(
        'Il provider bancario non ha restituito il link di autorizzazione.',
        'unknown',
      );
    }
    return {
      authUrl,
      authorizationId: firstString(res.authorization_id, res.id) ?? null,
    };
  }

  async exchangeCallback(code: string): Promise<ConsentSession> {
    const res = await this.client.createSession(code);
    return this.toConsentSession(res);
  }

  async getConsentStatus(consentId: string): Promise<ConsentSession> {
    const res = await this.client.getSession(consentId);
    return this.toConsentSession(res, consentId);
  }

  async listConsentAccounts(consentId: string): Promise<ProviderAccountRef[]> {
    const session = await this.getConsentStatus(consentId);
    return session.accounts;
  }

  async getAccountDetails(accountUid: string): Promise<ProviderAccountDetails> {
    const res = await this.client.getAccountDetails(accountUid);
    const ref = normalizeAccountEntry(res) ?? {
      uid: accountUid,
      iban: null,
      name: null,
      currency: null,
    };
    return {
      uid: ref.uid || accountUid,
      iban: ref.iban,
      name: ref.name,
      currency: ref.currency,
      ownerName: extractOwnerName(res),
    };
  }

  /**
   * Saldo del conto. La risposta Berlin Group è una **lista** di saldi di tipo
   * diverso: si sceglie il contabile di chiusura (`closingBooked`, omogeneo coi
   * movimenti `BOOK` che scarichiamo), poi il disponibile (`interimAvailable`),
   * poi il primo leggibile. Le entry senza importo o valuta interpretabili
   * vengono scartate, quindi un payload inatteso vale `null` e non un saldo
   * sbagliato.
   */
  async getAccountBalance(accountUid: string): Promise<ProviderBalance | null> {
    const res = await this.client.getAccountBalances(accountUid);
    return pickBalance(res);
  }

  /**
   * Movimenti contabilizzati del conto, seguendo la paginazione
   * `continuation_key` fino a esaurimento.
   *
   * Due protezioni: un **cap di pagine** (una banca che restituisse sempre lo
   * stesso cursore ci terrebbe in loop) e un piccolo backoff sui 429, perché il
   * limite PSD2 di accessi non presidiati è per-banca e non lo conosciamo.
   * Le righe non `BOOK` (pending) vengono scartate qui: non sono contabilizzate
   * e cambierebbero identità una volta contabilizzate. **Scartate ma contate**
   * (`skippedPending`, `statusCounts`): altrimenti una spesa ancora `PDNG`
   * sparirebbe in silenzio e l'esito del sync direbbe solo "0 movimenti".
   */
  async fetchTransactions(accountUid: string, dateFrom?: string): Promise<FetchTransactionsResult> {
    const out: ProviderTransaction[] = [];
    const statusCounts: Record<string, number> = {};
    let skippedPending = 0;
    let continuationKey: string | undefined;

    for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
      const res = await this.listTransactionsWithBackoff(accountUid, dateFrom, continuationKey);
      const rows = asArray(res.transactions) ?? asArray(res.data) ?? [];
      for (const row of rows) {
        const parsed = toProviderTransaction(row);
        if (!parsed) continue;
        const status = parsed.status ?? UNKNOWN_STATUS;
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        // Pending "veri" solo gli stati dichiarati e diversi da BOOK: una riga
        // senza stato è un payload incompleto, non un movimento in attesa.
        if (parsed.status === BOOKED_STATUS) out.push(parsed);
        else if (parsed.status) skippedPending++;
      }

      continuationKey = firstString(res.continuation_key) ?? undefined;
      if (!continuationKey) break;
      if (page === MAX_TRANSACTION_PAGES - 1) {
        this.logger.warn(
          `Paginazione movimenti interrotta al limite di ${MAX_TRANSACTION_PAGES} pagine per il conto ${accountUid}`,
        );
      }
    }
    return { transactions: out, skippedPending, statusCounts };
  }

  /**
   * Una pagina, con un paio di ritentativi sul 429. Oltre i tentativi previsti
   * l'errore risale: il sync di quel link fallisce e riparte al giro dopo.
   */
  private async listTransactionsWithBackoff(
    accountUid: string,
    dateFrom: string | undefined,
    continuationKey: string | undefined,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.listTransactions(accountUid, { dateFrom, continuationKey });
      } catch (e) {
        const retriable =
          e instanceof BankProviderError &&
          e.kind === 'rate_limit' &&
          attempt < RATE_LIMIT_BACKOFF_MS.length;
        if (!retriable) throw e;
        const waitMs = RATE_LIMIT_BACKOFF_MS[attempt];
        this.logger.warn(
          `Rate limit sul conto ${accountUid}: nuovo tentativo tra ${waitMs}ms (${attempt + 1}/${RATE_LIMIT_BACKOFF_MS.length})`,
        );
        await sleep(waitMs);
      }
    }
  }

  async revokeConsent(consentId: string): Promise<void> {
    await this.client.deleteSession(consentId);
  }

  private toInstitution(entry: unknown): ProviderInstitution | null {
    if (!entry || typeof entry !== 'object') return null;
    const o = entry as Record<string, unknown>;
    const name = firstString(o.name);
    const country = firstString(o.country);
    if (!name || !country) return null;

    const psuTypes = (asArray(o.psu_types) ?? [])
      .map((t) => (typeof t === 'string' ? t : null))
      .filter((t): t is string => t !== null);

    return {
      name,
      country,
      logo: firstString(o.logo) ?? null,
      maximumConsentValidity: asFiniteNumber(o.maximum_consent_validity),
      psuTypes,
    };
  }

  private toConsentSession(res: Record<string, unknown>, fallbackId?: string): ConsentSession {
    const consentId = firstString(res.session_id, res.id) ?? fallbackId;
    if (!consentId) {
      throw new BankProviderError(
        'Il provider bancario non ha restituito un identificativo di sessione.',
        'unknown',
      );
    }

    const rawAccounts = asArray(res.accounts) ?? [];
    const accounts = rawAccounts
      .map((entry) => normalizeAccountEntry(entry))
      .filter((a): a is ProviderAccountRef => a !== null);
    if (rawAccounts.length > 0 && accounts.length === 0) {
      // Non è fatale (il payload grezzo resta salvato), ma va segnalato.
      this.logger.warn('Nessun conto riconosciuto nella risposta di sessione Enable Banking');
    }

    const access = isRecord(res.access) ? res.access : {};
    return {
      consentId,
      status: firstString(res.status) ?? null,
      validUntil: parseDate(firstString(access.valid_until, res.valid_until)),
      accounts,
      rawAccounts,
    };
  }
}

/**
 * Scadenza da chiedere per il consenso: il minimo tra quanto concede la banca e
 * i 90 giorni PSD2, meno un margine di sicurezza.
 */
export function computeConsentValidUntil(
  maximumConsentValidity: number | null,
  now: Date = new Date(),
): Date {
  const capMs = MAX_CONSENT_DAYS * 24 * 60 * 60 * 1000;
  const bankMs =
    maximumConsentValidity && maximumConsentValidity > 0 ? maximumConsentValidity * 1000 : capMs;
  const windowMs = Math.max(Math.min(bankMs, capMs) - CONSENT_SAFETY_MARGIN_MS, 60_000);
  return new Date(now.getTime() + windowMs);
}

/**
 * Normalizza una entry "conto": può essere l'uid nudo, un oggetto della
 * sessione o la risposta di `/accounts/{uid}/details`.
 */
export function normalizeAccountEntry(entry: unknown): ProviderAccountRef | null {
  if (typeof entry === 'string') {
    const uid = entry.trim();
    return uid ? { uid, iban: null, name: null, currency: null } : null;
  }
  if (!isRecord(entry)) return null;

  const uid = firstString(entry.uid, entry.account_uid, entry.accountUid, entry.identification_hash);
  const accountId = entry.account_id;
  const iban =
    firstString(entry.iban) ??
    (isRecord(accountId) ? firstString(accountId.iban) : null) ??
    (isRecord(accountId) ? firstString(accountId.other) : null);
  const name = firstString(entry.name, entry.product, entry.details);
  const currency =
    firstString(entry.currency) ?? (isRecord(accountId) ? firstString(accountId.currency) : null);

  // Senza uid non c'è nulla da collegare: la entry è inutilizzabile.
  const resolvedUid = uid ?? (typeof accountId === 'string' ? accountId : null);
  if (!resolvedUid) return null;

  return {
    uid: resolvedUid,
    iban: iban ?? null,
    name: name ?? null,
    currency: currency ? currency.toUpperCase() : null,
  };
}

/**
 * Estrae i campi utili da una riga movimento, restando tollerante: lo spec
 * Berlin Group rende opzionali quasi tutti i campi e le banche italiane li
 * riempiono in modo diverso. L'importo resta **stringa** (la conversione in
 * centesimi è in `transaction-parse.ts`); il payload originale viaggia in `raw`
 * e finisce integrale in `BankStagedTransaction.rawJson`.
 *
 * Ritorna `null` solo se manca l'importo: senza quello la riga è inutilizzabile.
 */
export function toProviderTransaction(entry: unknown): ProviderTransaction | null {
  if (!isRecord(entry)) return null;

  const amountObj = isRecord(entry.transaction_amount) ? entry.transaction_amount : {};
  const amount = firstString(amountObj.amount, entry.amount);
  if (!amount) return null;

  const creditor = isRecord(entry.creditor) ? entry.creditor : null;
  const debtor = isRecord(entry.debtor) ? entry.debtor : null;

  return {
    entryReference: firstString(entry.entry_reference, entry.transaction_id),
    bookingDate: firstString(entry.booking_date, entry.bookingDate),
    valueDate: firstString(entry.value_date, entry.valueDate),
    amount,
    currency: (firstString(amountObj.currency, entry.currency) ?? 'EUR').toUpperCase(),
    creditDebitIndicator: firstString(entry.credit_debit_indicator)?.toUpperCase() ?? null,
    status: firstString(entry.status)?.toUpperCase() ?? null,
    remittanceInformation: joinRemittance(entry.remittance_information),
    creditorName: creditor ? firstString(creditor.name) : null,
    debtorName: debtor ? firstString(debtor.name) : null,
    raw: entry,
  };
}

/**
 * Ordine di preferenza dei tipi di saldo, con gli alias del code set ISO che
 * alcune banche mandano al posto del nome esteso (`CLBD`, `ITAV`).
 * Il confronto avviene sul tipo normalizzato (minuscolo, senza separatori).
 *
 * Prima il **contabile** (`closingBooked`), poi il disponibile
 * (`interimAvailable`): il saldo salvato serve alla riconciliazione col saldo
 * dell'app, che registra **solo movimenti contabilizzati** (scarichiamo solo le
 * righe `BOOK`). Il disponibile include invece le autorizzazioni ancora
 * pendenti, quindi come riferimento produrrebbe uno scostamento perenne per
 * ogni spesa non ancora contabilizzata — differenza vera per la banca, falsa
 * per il confronto che facciamo noi.
 */
const BALANCE_TYPE_PREFERENCE = [
  ['closingbooked', 'clbd'],
  ['interimavailable', 'itav'],
];

/**
 * Sceglie il saldo da usare tra quelli restituiti da `/accounts/{uid}/balances`.
 *
 * Esportata perché è pura e va testata a parte: è il punto in cui un payload
 * inatteso potrebbe far scrivere in DB un saldo di tipo sbagliato.
 */
export function pickBalance(payload: unknown): ProviderBalance | null {
  const rows = extractBalanceRows(payload);
  const parsed = rows
    .map((entry) => parseBalanceEntry(entry))
    .filter((b): b is ProviderBalance => b !== null);
  if (parsed.length === 0) return null;

  for (const aliases of BALANCE_TYPE_PREFERENCE) {
    const hit = parsed.find((b) => aliases.includes(normalizeBalanceType(b.type)));
    if (hit) return hit;
  }
  // Nessun tipo riconosciuto: meglio il primo saldo leggibile che nessun saldo.
  return parsed[0];
}

function extractBalanceRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  const list = asArray(payload.balances) ?? asArray(payload.data);
  if (list) return list;
  // Qualche banca risponde con un saldo singolo invece che con la lista.
  return isRecord(payload.balance) ? [payload.balance] : [payload];
}

/**
 * Una entry della lista saldi. Senza importo **o** senza valuta la entry è
 * inutilizzabile: la valuta serve a garantire che il saldo sia confrontabile
 * con quello del conto dell'app.
 */
function parseBalanceEntry(entry: unknown): ProviderBalance | null {
  if (!isRecord(entry)) return null;

  const amountObj = firstRecord(entry.balance_amount, entry.balanceAmount, entry.amount) ?? {};
  const cents = parseDecimalToCents(amountString(amountObj.amount, entry.amount));
  if (cents === null) return null;

  const currency = firstString(amountObj.currency, entry.currency);
  if (!currency) return null;

  return {
    cents,
    currency: currency.toUpperCase(),
    type: firstString(entry.balance_type, entry.balanceType, entry.name),
  };
}

function normalizeBalanceType(type: string | null): string {
  return (type ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * L'importo dello spec è una **stringa** decimale; se una banca manda un numero
 * lo si riporta a stringa senza toccarlo (la conversione in centesimi resta
 * quella per cifre di `parseDecimalToCents`, che scarta le notazioni strane).
 */
function amountString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const v of values) {
    if (isRecord(v)) return v;
  }
  return null;
}

/** `remittance_information` è stringa su alcune banche, array su altre. */
function joinRemittance(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (typeof v === 'string' ? v.trim() : null))
      .filter((v): v is string => !!v);
    return parts.length > 0 ? parts.join(' ') : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** L'intestatario non ha una posizione fissa nello spec: si prova dove capita. */
function extractOwnerName(res: Record<string, unknown>): string | null {
  const direct = firstString(res.owner_name, res.ownerName, res.psu_name);
  if (direct) return direct;
  const owner = res.account_owner;
  if (typeof owner === 'string') return owner;
  if (isRecord(owner)) return firstString(owner.name) ?? null;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
