import { api } from '@/lib/api/client';
import type { Bill, BillLine, UtilityKind } from './analytics';

/** Bolletta come la restituisce il backend (`UtilityBillView`). */
export interface UtilityBill extends Bill {
  /** Abitazione della bolletta, `null` se non ancora assegnata. */
  householdId: string | null;
  /** Indirizzo di fornitura letto dal PDF. */
  supplyAddress: string | null;
  notes: string | null;
  hasFile: boolean;
  fileName: string | null;
  extractionError: string | null;
  /** `opencode:<modello>` o `ollama:<modello>`. */
  extractionModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveBillLine {
  utility: UtilityKind;
  consumption: number | null;
  costCents: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  supplyCode: string | null;
  estimated: boolean;
  energyCostCents: number | null;
  energyUnitPrice: number | null;
}

export interface SaveBillInput {
  provider: string | null;
  billNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string;
  periodEnd: string;
  totalCents: number | null;
  notes: string | null;
  lines: SaveBillLine[];
  /** Abitazione: id, `null` = nessuna; assente = invariata. */
  householdId?: string | null;
  /** Indirizzo di una nuova abitazione (riconosciuta se esiste già). */
  newHouseholdAddress?: string | null;
}

export interface Household {
  id: string;
  name: string;
  address: string | null;
  billCount: number;
  createdAt: string;
}

export type { Bill, BillLine, UtilityKind };

export const billsApi = {
  list: () => api.get('utility-bills').json<UtilityBill[]>(),
  create: (data: SaveBillInput) => api.post('utility-bills', { json: data }).json<UtilityBill>(),
  save: (id: string, data: SaveBillInput) => api.put(`utility-bills/${id}`, { json: data }).json<UtilityBill>(),
  remove: (id: string) => api.delete(`utility-bills/${id}`),
  reextract: (id: string) => api.post(`utility-bills/${id}/extract`).json<UtilityBill>(),
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    // L'upload risponde subito: la lettura del PDF prosegue in background.
    return api.post('utility-bills/upload', { body: formData, timeout: 60_000 }).json<UtilityBill>();
  },
};

export const householdsApi = {
  list: () => api.get('households').json<Household[]>(),
  rename: (id: string, name: string) => api.patch(`households/${id}`, { json: { name } }).json<Household>(),
  merge: (id: string, intoId: string) => api.post(`households/${id}/merge`, { json: { intoId } }).json<Household>(),
  remove: (id: string) => api.delete(`households/${id}`),
};
