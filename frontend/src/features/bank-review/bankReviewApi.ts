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

export interface ReviewListResponse {
  /** Ordinati per `effectiveDate` desc. */
  items: ReviewItem[];
  total: number;
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

/** Massimo accettato dal backend in una singola conferma. */
export const CONFIRM_MAX_IDS = 200;

export const bankReviewApi = {
  list: (status: ReviewStatus = 'pending_review') =>
    api.get('bank-sync/review', { searchParams: { status } }).json<ReviewListResponse>(),

  update: (id: string, data: UpdateReviewItemInput) =>
    api
      .patch(`bank-sync/review/${encodeURIComponent(id)}`, { json: data })
      .json<{ item: ReviewItem }>(),

  confirm: (ids: string[]) =>
    api
      .post('bank-sync/review/confirm', { json: { ids }, timeout: CONFIRM_TIMEOUT_MS })
      .json<ConfirmReviewResult>(),
};
