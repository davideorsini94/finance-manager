import { api } from '@/lib/api/client';
import type { Bill, BillLine, UtilityKind } from './analytics';

/** Bolletta come la restituisce il backend (`UtilityBillView`). */
export interface UtilityBill extends Bill {
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
