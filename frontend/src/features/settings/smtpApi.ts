import { api } from '@/lib/api/client';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  fromEmail: string;
  fromName: string | null;
  updatedAt: string;
  hasPassword: boolean;
}

export interface UpdateSmtpInput {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  /**
   * - stringa non vuota: nuova password (verrà cifrata)
   * - null: rimuovi password salvata
   * - undefined / non incluso nella richiesta: lascia invariata
   */
  password?: string | null;
  fromEmail: string;
  fromName?: string | null;
}

export const smtpApi = {
  get: () => api.get('settings/smtp').json<SmtpSettings | null>(),
  update: (data: UpdateSmtpInput) =>
    api.put('settings/smtp', { json: data }).json<SmtpSettings>(),
  remove: () => api.delete('settings/smtp'),
  test: (to: string) => api.post('settings/smtp/test', { json: { to } }).json<{ ok: true }>(),
};
