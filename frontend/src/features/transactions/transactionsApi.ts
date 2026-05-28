import { api } from '@/lib/api/client';
import type { PageResult, Transaction, TransactionType } from '@/types/domain';

export interface ListTransactionsParams {
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateTransactionInput {
  accountId: string;
  amountCents: number;
  type: 'income' | 'expense';
  categoryId?: string;
  description?: string;
  notes?: string;
  transactionDate: string;
}

export interface UpdateTransactionInput {
  amountCents?: number;
  type?: 'income' | 'expense';
  categoryId?: string | null;
  description?: string;
  notes?: string;
  transactionDate?: string;
}

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: string;
  arrivalDate?: string;
  description?: string;
  categoryId?: string;
}

export const transactionsApi = {
  list: (params: ListTransactionsParams) =>
    api
      .get('transactions', { searchParams: cleanParams(params) })
      .json<PageResult<Transaction>>(),

  get: (id: string) => api.get(`transactions/${id}`).json<Transaction>(),

  create: (data: CreateTransactionInput) =>
    api.post('transactions', { json: data }).json<Transaction>(),

  update: (id: string, data: UpdateTransactionInput) =>
    api.patch(`transactions/${id}`, { json: data }).json<Transaction>(),

  remove: (id: string) => api.delete(`transactions/${id}`),

  createTransfer: (data: CreateTransferInput) =>
    api.post('transfers', { json: data }).json<{ from: Transaction; to: Transaction }>(),

  removeTransfer: (id: string) => api.delete(`transfers/${id}`),
};

function cleanParams(params: ListTransactionsParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return out;
}
