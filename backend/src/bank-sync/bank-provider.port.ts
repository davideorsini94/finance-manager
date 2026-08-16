/**
 * Contratto verso il provider di open banking (PSD2, solo AIS/lettura).
 *
 * L'implementazione attuale è `EnableBankingProvider`; l'interfaccia esiste
 * perché un domani si possa infilare un altro provider (es. GoCardless) senza
 * toccare `BankSyncService`. **Nessun metodo dispositivo**: il client è
 * read-only per costruzione (vedi §5 del piano).
 */

/** Token DI: `@Inject(BANK_PROVIDER)`. */
export const BANK_PROVIDER = 'BANK_PROVIDER';

export interface ProviderInstitution {
  /** Identificativo lato provider (Enable Banking usa il nome della banca). */
  name: string;
  country: string;
  logo: string | null;
  /** Durata massima del consenso in secondi, se dichiarata dalla banca. */
  maximumConsentValidity: number | null;
  psuTypes: string[];
}

/** Conto restituito dal provider, normalizzato (le entry grezze variano di forma). */
export interface ProviderAccountRef {
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
}

export interface ProviderAccountDetails extends ProviderAccountRef {
  ownerName: string | null;
}

/**
 * Saldo dichiarato dalla banca per un conto, già in **centesimi firmati**
 * (conversione dalla stringa decimale, mai da float).
 */
export interface ProviderBalance {
  cents: bigint;
  /** Valuta del saldo: va confrontata con quella del conto prima di usarlo. */
  currency: string;
  /** Tipo Berlin Group scelto (es. `interimAvailable`), a scopo diagnostico. */
  type: string | null;
}

export interface StartConsentInput {
  aspspName: string;
  aspspCountry: string;
  /** "state" anti-CSRF generato da noi, tornerà nel callback. */
  state: string;
  redirectUrl: string;
  /** Scadenza richiesta per il consenso (≤ maximum_consent_validity della banca). */
  validUntil: Date;
}

export interface StartConsentResult {
  /** URL della banca su cui mandare l'utente per autorizzare. */
  authUrl: string;
  authorizationId: string | null;
}

export interface ConsentSession {
  /** `session_id` Enable Banking. */
  consentId: string;
  /** Stato grezzo dichiarato dal provider (es. AUTHORIZED, REVOKED…). */
  status: string | null;
  validUntil: Date | null;
  accounts: ProviderAccountRef[];
  /** Array grezzo dei conti: va salvato as-is in `BankConnection.providerAccounts`. */
  rawAccounts: unknown[];
}

/**
 * Movimento del provider, estratto in forma tollerante ma **non ancora
 * normalizzato**: l'importo resta la stringa decimale originale (mai float) e
 * il segno va derivato da `creditDebitIndicator`. La normalizzazione in
 * centesimi firmati, la sanificazione dei testi e il dedup sono di
 * `SyncEngineService`.
 */
export interface ProviderTransaction {
  entryReference: string | null;
  /** Data contabile (YYYY-MM-DD): manca su alcune banche per i movimenti recenti. */
  bookingDate: string | null;
  valueDate: string | null;
  /** Stringa decimale come arriva dalla banca (es. "12.34"). */
  amount: string;
  currency: string;
  /** `CRDT` (accredito) / `DBIT` (addebito); `null` se la banca non lo manda. */
  creditDebitIndicator: string | null;
  /** Stato Berlin Group: teniamo solo `BOOK` (i `PDNG` non sono contabilizzati). */
  status: string | null;
  /** `remittance_information` già unita in una stringa (arriva stringa o array). */
  remittanceInformation: string | null;
  creditorName: string | null;
  debtorName: string | null;
  /** Payload originale della riga: finisce in `BankStagedTransaction.rawJson`. */
  raw: unknown;
}

/**
 * Esito di uno scaricamento movimenti: oltre alle righe contabilizzate porta
 * indietro **quante righe sono state scartate perché non contabilizzate** e la
 * distribuzione degli stati visti. Senza questi due numeri un movimento ancora
 * `PDNG` in banca sparirebbe senza lasciare traccia, e dall'esito del sync
 * sembrerebbe che la banca non lo abbia proprio mandato.
 */
export interface FetchTransactionsResult {
  /** Righe `BOOK`, le uniche che il motore mette in staging. */
  transactions: ProviderTransaction[];
  /** Righe con uno stato dichiarato diverso da `BOOK` (tipicamente `PDNG`). */
  skippedPending: number;
  /**
   * Quante righe per stato, incluso `BOOK`. Le righe senza stato dichiarato
   * finiscono sotto `UNKNOWN`. Solo diagnostica (log e `BankSyncRun.stats`).
   */
  statusCounts: Record<string, number>;
}

export interface BankProviderPort {
  /** Elenco banche disponibili per il paese (ISO 3166-1 alpha-2). */
  /** country assente = tutte le banche visibili all'app (es. Mock ASPSP con credenziali sandbox). */
  listInstitutions(country?: string): Promise<ProviderInstitution[]>;

  /** Avvia il consenso e restituisce l'URL di autorizzazione della banca. */
  startConsent(input: StartConsentInput): Promise<StartConsentResult>;

  /** Scambia il `code` del callback con una sessione (breve vita: va fatto subito). */
  exchangeCallback(code: string): Promise<ConsentSession>;

  /** Stato remoto del consenso (per il ciclo di vita: expired/revoked/error). */
  getConsentStatus(consentId: string): Promise<ConsentSession>;

  /** Conti coperti dal consenso. */
  listConsentAccounts(consentId: string): Promise<ProviderAccountRef[]>;

  /** Dettagli di un conto (IBAN, valuta, intestatario). */
  getAccountDetails(accountUid: string): Promise<ProviderAccountDetails>;

  /**
   * Saldo corrente del conto secondo la banca, `null` se non ne arriva uno
   * utilizzabile (nessun saldo, importo o valuta illeggibili).
   */
  getAccountBalance(accountUid: string): Promise<ProviderBalance | null>;

  /**
   * Movimenti **contabilizzati** (`status = BOOK`) del conto, dal giorno
   * `dateFrom` (YYYY-MM-DD) in poi; senza `dateFrom` la banca decide fin dove
   * andare indietro. L'implementazione segue la paginazione fino a esaurimento.
   *
   * Le righe non contabilizzate non vengono restituite ma **contate**
   * (`skippedPending`/`statusCounts`): sono la spiegazione più comune di un
   * movimento visibile nell'app della banca e assente dalla coda di revisione.
   */
  fetchTransactions(accountUid: string, dateFrom?: string): Promise<FetchTransactionsResult>;

  /** Revoca il consenso lato provider. */
  revokeConsent(consentId: string): Promise<void>;
}
