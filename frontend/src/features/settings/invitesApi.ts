import { api } from '@/lib/api/client';

export interface PendingInvite {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
  inviteUrl: string;
}

export interface CreateInviteResponse {
  email: string;
  expiresAt: string;
  emailSent: boolean;
  inviteUrl: string;
}

export const invitesApi = {
  list: () => api.get('auth/invites').json<PendingInvite[]>(),
  create: (email: string) =>
    api.post('auth/invite', { json: { email } }).json<CreateInviteResponse>(),
  revoke: (id: string) => api.delete(`auth/invites/${id}`),
};
