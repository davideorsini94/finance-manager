import { api } from '@/lib/api/client';
import type { AuthUser } from '@/types/domain';

export interface UpdateProfileInput {
  fullName?: string;
  locale?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export const settingsApi = {
  updateProfile: (data: UpdateProfileInput) =>
    api.patch('users/me', { json: data }).json<AuthUser>(),

  changePassword: (data: ChangePasswordInput) =>
    api.post('auth/change-password', { json: data }),

  /**
   * Scarica il backup come blob e triggera il download nel browser.
   */
  downloadBackup: async (): Promise<void> => {
    const response = await fetch(`${BASE}/backup/export`, { credentials: 'include' });
    if (!response.ok) throw new Error(`Backup failed: HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-manager-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  restoreBackup: async (file: File): Promise<{ restored: Record<string, number>; blobs: number }> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('backup/restore', { body: formData, timeout: 5 * 60_000 }).json();
  },
};
