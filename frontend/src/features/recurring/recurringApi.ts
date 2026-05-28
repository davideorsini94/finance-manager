import { api } from '@/lib/api/client';
import type { AccountType, TransactionType } from '@/types/domain';

export type RecurrenceFreq =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly';

export interface RecurringRule {
  id: string;
  userId: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  amountCents: string;
  type: TransactionType;
  description: string | null;
  frequency: RecurrenceFreq;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  isActive: boolean;
  account: { id: string; name: string; type: AccountType };
  toAccount: { id: string; name: string; type: AccountType } | null;
  category: { id: string; name: string; color: string | null } | null;
}

export interface CreateRecurringInput {
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  amountCents: number;
  type: 'income' | 'expense' | 'transfer';
  description?: string;
  frequency: RecurrenceFreq;
  startDate: string;
  endDate?: string;
}

export interface UpdateRecurringInput {
  accountId?: string;
  toAccountId?: string | null;
  amountCents?: number;
  categoryId?: string | null;
  type?: 'income' | 'expense' | 'transfer';
  description?: string;
  frequency?: RecurrenceFreq;
  startDate?: string;
  endDate?: string | null;
  isActive?: boolean;
}

export const recurringApi = {
  list: () => api.get('recurring').json<RecurringRule[]>(),
  create: (data: CreateRecurringInput) => api.post('recurring', { json: data }).json<RecurringRule>(),
  update: (id: string, data: UpdateRecurringInput) =>
    api.patch(`recurring/${id}`, { json: data }).json<RecurringRule>(),
  remove: (id: string) => api.delete(`recurring/${id}`),
  runNow: () => api.post('recurring/run-now').json<{ generated: number }>(),
};
