import { api } from '@/lib/api/client';
import type { Account, AccountMember, AccountMemberRole, AccountType, UserSummary } from '@/types/domain';

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  color?: string;
  icon?: string;
  initialBalanceCents?: number;
  paymentAccountId?: string;
  billingDay?: number;
}

export interface UpdateAccountInput {
  name?: string;
  color?: string;
  icon?: string;
  paymentAccountId?: string;
  billingDay?: number;
  /**
   * Saldo manuale del conto in centesimi. Sovrascrive direttamente
   * `balanceCents` lato backend (correzione del saldo iniziale).
   */
  balanceCents?: number;
}

export const accountsApi = {
  list: () => api.get('accounts').json<Account[]>(),
  get: (id: string) => api.get(`accounts/${id}`).json<Account>(),
  create: (data: CreateAccountInput) => api.post('accounts', { json: data }).json<Account>(),
  update: (id: string, data: UpdateAccountInput) =>
    api.patch(`accounts/${id}`, { json: data }).json<Account>(),
  archive: (id: string) => api.delete(`accounts/${id}`),

  /** Imposta il conto preferito dell'utente loggato (null per rimuoverlo). */
  setFavorite: (accountId: string | null) =>
    api.put('users/me/favorite-account', { json: { accountId } }),

  addMember: (accountId: string, userId: string, role: Exclude<AccountMemberRole, 'owner'>) =>
    api.post(`accounts/${accountId}/members`, { json: { userId, role } }).json<AccountMember>(),
  updateMember: (accountId: string, userId: string, role: Exclude<AccountMemberRole, 'owner'>) =>
    api.patch(`accounts/${accountId}/members/${userId}`, { json: { role } }).json<AccountMember>(),
  removeMember: (accountId: string, userId: string) =>
    api.delete(`accounts/${accountId}/members/${userId}`),

  searchUsers: (q: string) =>
    api.get('users', { searchParams: q ? { q } : undefined }).json<UserSummary[]>(),
};
