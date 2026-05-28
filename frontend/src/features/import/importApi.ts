import { api } from '@/lib/api/client';

export interface PreviewRow {
  index: number;
  date: string;
  description: string;
  amountCents: number;
  type: 'income' | 'expense';
  duplicate: boolean;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
}

export interface ImportBatch {
  id: string;
  userId: string;
  accountId: string;
  filename: string;
  format: string;
  status: 'pending' | 'confirmed' | 'rejected';
  rawPreview: PreviewRow[];
  aiSuggestions: Record<string, string | null>;
  createdAt: string;
}

export interface ConfirmRow {
  index: number;
  accepted: boolean;
  categoryId?: string | null;
  description?: string;
  transactionDate?: string;
  amountCents?: number;
}

export const importApi = {
  upload: (accountId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api
      .post('imports/upload', { body: formData, searchParams: { accountId } })
      .json<ImportBatch>();
  },
  confirm: (batchId: string, rows: ConfirmRow[]) =>
    api.post(`imports/${batchId}/confirm`, { json: { rows } }).json<{ created: number }>(),
  reject: (batchId: string) => api.post(`imports/${batchId}/reject`),
};
