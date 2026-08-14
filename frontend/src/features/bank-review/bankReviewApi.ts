import { api } from '@/lib/api/client';

/**
 * Client per la **coda di revisione** dei movimenti importati dalla banca
 * (Fase 4 del sync bancario). Sta in una feature-folder separata da
 * `features/settings/bankSyncApi.ts` perché serve una sola pagina
 * (`BankReviewPage`) e non le impostazioni.
 *
 * Convenzioni: gli importi sono BigInt lato backend e arrivano SEMPRE come
 * stringa di centesimi; le date sono ISO (`YYYY-MM-DD` per `effectiveDate`).
 */

/**
 * La conferma bulk crea Transaction/Transfer (saldi, audit, replica categorie):
 * può superare il default di ky (10s) su liste lunghe.
 */
const CONFIRM_TIMEOUT_MS = 60_000;

/** Stati della coda visibili dalla UI (gli altri non sono revisionabili). */
export type ReviewStatus = 'pending_review' | 'duplicate' | 'ignored';

/** Categoria finale assegnata alla riga (dell'utente che sta revisionando). */
export interface ReviewCategory {
  id: string;
  name: string;
  color: string | null;
}

/** Controparte di una coppia giroconto (l'altra gamba, già accoppiata). */
export interface ReviewPair {
  stagedId: string;
  accountId: string;
  accountName: string;
  effectiveDate: string;
  amountCents: string;
}

/** Movimento già registrato di cui questa riga è un probabile duplicato. */
export interface ReviewDuplicateOf {
  transactionId: string;
  description: string | null;
  transactionDate: string;
}

export interface ReviewItem {
  id: string;
  linkId: string;
  accountId: string;
  accountName: string;
  accountColor: string | null;
  /** Data contabile (`bookingDate ?? valueDate`), sempre valorizzata. */
  effectiveDate: string;
  /** Centesimi firmati, come stringa (convenzione BigInt→string). */
  amountCents: string;
  currency: string;
  description: string | null;
  counterparty: string | null;
  status: string;
  /** Tipo proposto: `transfer` solo per le righe accoppiate. */
  suggestedType: 'income' | 'expense' | 'transfer' | null;
  /** Confidenza della categorizzazione LLM (0..1), null se non categorizzata. */
  suggestedConfidence: number | null;
  suggestedCategoryId: string | null;
  finalCategory: ReviewCategory | null;
  pair: ReviewPair | null;
  duplicateOf: ReviewDuplicateOf | null;
}

export interface ReviewListParams {
  status?: ReviewStatus;
  /** Pagina 1-based; default 1. */
  page?: number;
  /** Righe per pagina; il backend accetta al massimo 200. */
  pageSize?: number;
}

export interface ReviewListResponse {
  /** Ordinati per `effectiveDate` desc, paginati. */
  items: ReviewItem[];
  /** Conteggio completo (non paginato): serve a contare le pagine. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Patch di una riga in revisione. I campi sono mutuamente compatibili solo in
 * certe combinazioni (il backend risponde 400 con messaggio in italiano):
 *  - `categoryId`: categoria finale (`null` svuota)
 *  - `type`: forza entrata/uscita — solo su righe NON accoppiate
 *  - `pairWithStagedId`: accoppia manualmente (`null` spaia)
 *  - `ignore` / `restore`: sposta la riga tra `ignored`/`duplicate` e `pending_review`
 */
export interface UpdateReviewItemInput {
  categoryId?: string | null;
  type?: 'income' | 'expense';
  pairWithStagedId?: string | null;
  ignore?: boolean;
  restore?: boolean;
}

export interface ConfirmReviewResult {
  /** Movimenti creati (le coppie contano entrambe le gambe). */
  confirmed: number;
  /** Giroconti creati (una `TransfersService.create` per coppia). */
  transfers: number;
  skipped: number;
  errors: Array<{ id: string; message: string }>;
}

export interface IgnoreReviewResult {
  /** Righe passate a `ignored` (le controparti incluse d'ufficio contano). */
  ignored: number;
  errors: Array<{ id: string; message: string }>;
}

/** Massimo accettato dal backend in una singola conferma. */
export const CONFIRM_MAX_IDS = 200;

/** Massimo accettato dal backend in un singolo "ignora" multiplo. */
export const IGNORE_MAX_IDS = 500;

/** Dimensione pagina di default della coda (allineata al backend). */
export const DEFAULT_PAGE_SIZE = 50;

/** Opzioni del selettore "per pagina" (il tetto backend è 200). */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const bankReviewApi = {
  list: ({ status = 'pending_review', page = 1, pageSize = DEFAULT_PAGE_SIZE }: ReviewListParams = {}) =>
    api
      .get('bank-sync/review', { searchParams: { status, page, pageSize } })
      .json<ReviewListResponse>(),

  update: (id: string, data: UpdateReviewItemInput) =>
    api
      .patch(`bank-sync/review/${encodeURIComponent(id)}`, { json: data })
      .json<{ item: ReviewItem }>(),

  confirm: (ids: string[]) =>
    api
      .post('bank-sync/review/confirm', { json: { ids }, timeout: CONFIRM_TIMEOUT_MS })
      .json<ConfirmReviewResult>(),

  /**
   * Ignora N righe in UNA richiesta: il vecchio ciclo di PATCH per riga
   * sforava il rate-limit globale (429) con centinaia di selezioni. Le coppie
   * di giroconto vengono ignorate intere dal backend (basta una gamba).
   */
  ignoreMany: (ids: string[]) =>
    api
      .post('bank-sync/review/ignore', { json: { ids }, timeout: CONFIRM_TIMEOUT_MS })
      .json<IgnoreReviewResult>(),
};
