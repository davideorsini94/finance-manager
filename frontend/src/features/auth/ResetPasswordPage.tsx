import { useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/shared/PasswordInput';
import { resetPassword, validateResetToken } from './authApi';

const schema = z
  .object({
    newPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Le password non coincidono',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token } = useSearch({ strict: false }) as { token?: string };

  const [status, setStatus] = useState<'validating' | 'invalid' | 'ready' | 'done'>('validating');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    validateResetToken(token)
      .then((r) => setStatus(r.ok ? 'ready' : 'invalid'))
      .catch(() => setStatus('invalid'));
  }, [token]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setSubmitError(null);
    try {
      await resetPassword(token, values.newPassword);
      setStatus('done');
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Errore');
    }
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reimposta la password</CardTitle>
          <CardDescription>
            Imposta una nuova password per il tuo account Finance Manager.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'validating' && (
            <p className="py-6 text-center text-sm text-muted-foreground">Verifica del link…</p>
          )}

          {status === 'invalid' && (
            <div className="space-y-4 py-2 text-center">
              <XCircle className="mx-auto h-10 w-10 text-rose-600" />
              <p className="text-sm text-muted-foreground">
                Il link non è valido o è scaduto. Richiedi un nuovo reset dalla pagina di login.
              </p>
              <Button type="button" onClick={() => void navigate({ to: '/login' })}>
                Torna al login
              </Button>
            </div>
          )}

          {status === 'ready' && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nuova password</Label>
                <PasswordInput
                  id="newPassword"
                  autoComplete="new-password"
                  stripWhitespaceOnPaste={false}
                  {...register('newPassword')}
                  aria-invalid={!!errors.newPassword}
                />
                {errors.newPassword && (
                  <p className="text-xs text-destructive">{errors.newPassword.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Conferma password</Label>
                <PasswordInput
                  id="confirmPassword"
                  autoComplete="new-password"
                  stripWhitespaceOnPaste={false}
                  {...register('confirmPassword')}
                  aria-invalid={!!errors.confirmPassword}
                />
                {errors.confirmPassword && (
                  <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
                )}
              </div>
              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Salvataggio…' : 'Imposta nuova password'}
              </Button>
            </form>
          )}

          {status === 'done' && (
            <div className="space-y-4 py-2 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <p className="text-sm text-muted-foreground">
                Password aggiornata. Ora puoi accedere con le nuove credenziali.
              </p>
              <Button type="button" onClick={() => void navigate({ to: '/login' })}>
                Vai al login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
