import { api } from '@/lib/api/client';
import type { AuthUser } from '@/types/domain';

export interface LoginResponse {
  userId: string;
  role: 'admin' | 'user';
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  return api.post('auth/login', { json: { email, password } }).json<LoginResponse>();
}

export async function logoutRequest(): Promise<void> {
  await api.post('auth/logout');
}

export async function fetchMe(): Promise<AuthUser> {
  return api.get('users/me').json<AuthUser>();
}

export interface InviteValidation {
  email: string;
  expiresAt: string;
}

export async function validateInvite(token: string): Promise<InviteValidation> {
  return api.get(`auth/invite/validate/${token}`).json<InviteValidation>();
}

export async function acceptInvite(
  token: string,
  password: string,
  fullName?: string,
): Promise<LoginResponse> {
  return api
    .post('auth/accept-invite', { json: { token, password, fullName } })
    .json<LoginResponse>();
}

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  return api.post('auth/forgot-password', { json: { email } }).json<{ ok: true }>();
}

export async function validateResetToken(token: string): Promise<{ ok: boolean }> {
  return api.get(`auth/reset-password/validate/${token}`).json<{ ok: boolean }>();
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
  return api
    .post('auth/reset-password', { json: { token, newPassword } })
    .json<{ ok: true }>();
}
