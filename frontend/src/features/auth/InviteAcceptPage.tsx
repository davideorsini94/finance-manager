import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordInput } from '@/components/shared/PasswordInput';
import { acceptInvite, validateInvite, type InviteValidation } from './authApi';
import { useAuth } from './useAuth';
import { api } from '@/lib/api/client';

const schema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  password: z.string().min(8).max(128),
});

type FormValues = z.infer<typeof schema>;

export function InviteAcceptPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { token?: string; accountInvite?: string };
  const token = search.token;
  const accountInviteToken = search.accountInvite;
  const bootstrap = useAuth((s) => s.bootstrap);

  const [info, setInfo] = useState<InviteValidation | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sharedAccountName, setSharedAccountName] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setTokenError(t('auth.invite.invalidToken'));
      return;
    }
    validateInvite(token)
      .then(setInfo)
      .catch(() => setTokenError(t('auth.invite.invalidToken')));
  }, [token, t]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setSubmitError(null);
    try {
      await acceptInvite(token, values.password, values.fullName);
      await bootstrap();
      // Se l'invito proviene da una condivisione conto e l'utente è appena
      // stato creato, accetto automaticamente la share invite con il token
      // passato in querystring. Errori qui sono non bloccanti — l'utente
      // può comunque trovare la pending invite in /accounts.
      if (accountInviteToken) {
        try {
          const r = await api
            .post('invites/accept', { json: { token: accountInviteToken } })
            .json<{ accountId: string; accountName: string; role: string }>();
          setSharedAccountName(r.accountName);
        } catch {
          /* ignore */
        }
      }
      await navigate({ to: '/' });
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Error');
    }
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.invite.title')}</CardTitle>
          <CardDescription>
            {info ? `${t('auth.invite.subtitle')} (${info.email})` : t('auth.invite.subtitle')}
            {accountInviteToken && (
              <span className="mt-2 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                Dopo aver impostato la password ti aggiungeremo automaticamente al conto condiviso.
              </span>
            )}
            {sharedAccountName && (
              <span className="mt-2 block text-xs text-emerald-700 dark:text-emerald-400">
                Aggiunto al conto: {sharedAccountName}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tokenError ? (
            <p className="text-sm text-destructive">{tokenError}</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">{t('auth.invite.fullName')}</Label>
                <Input id="fullName" {...register('fullName')} aria-invalid={!!errors.fullName} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('auth.invite.password')}</Label>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  stripWhitespaceOnPaste={false}
                  {...register('password')}
                  aria-invalid={!!errors.password}
                />
              </div>
              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <Button type="submit" className="w-full" disabled={isSubmitting || !info}>
                {t('auth.invite.submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
