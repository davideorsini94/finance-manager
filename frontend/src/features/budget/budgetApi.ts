import { api } from '@/lib/api/client';

export interface BudgetWithSpent {
  id: string;
  categoryId: string;
  month: string;
  limitCents: string;
  spentCents: string;
  category: { id: string; name: string; color: string | null; icon: string | null };
}

export interface CreateBudgetInput {
  categoryId: string;
  month: string; // YYYY-MM
  limitCents: number;
}

export const budgetApi = {
  list: (month?: string) =>
    api
      .get('budgets', { searchParams: month ? { month } : undefined })
      .json<BudgetWithSpent[]>(),
  create: (data: CreateBudgetInput) => api.post('budgets', { json: data }).json<BudgetWithSpent>(),
  update: (id: string, limitCents: number) =>
    api.patch(`budgets/${id}`, { json: { limitCents } }).json<BudgetWithSpent>(),
  remove: (id: string) => api.delete(`budgets/${id}`),
};
