import { api } from '@/lib/api/client';
import type { AccountType } from '@/types/domain';

export interface Goal {
  id: string;
  userId: string;
  accountId: string | null;
  name: string;
  targetCents: string;
  currentCents: string;
  deadline: string | null;
  isCompleted: boolean;
  createdAt: string;
  account: { id: string; name: string; type: AccountType } | null;
}

export interface CreateGoalInput {
  name: string;
  targetCents: number;
  currentCents?: number;
  deadline?: string;
  accountId?: string;
}

export interface UpdateGoalInput {
  name?: string;
  targetCents?: number;
  currentCents?: number;
  deadline?: string | null;
  isCompleted?: boolean;
}

export const goalsApi = {
  list: () => api.get('goals').json<Goal[]>(),
  create: (data: CreateGoalInput) => api.post('goals', { json: data }).json<Goal>(),
  update: (id: string, data: UpdateGoalInput) =>
    api.patch(`goals/${id}`, { json: data }).json<Goal>(),
  remove: (id: string) => api.delete(`goals/${id}`),
};
