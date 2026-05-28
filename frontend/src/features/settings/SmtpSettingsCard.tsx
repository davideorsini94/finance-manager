import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Send, Trash2, Save, Lock, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PasswordInput } from '@/components/shared/PasswordInput';
import { smtpApi, type UpdateSmtpInput } from './smtpApi';
import { useConfirm } from '@/components/shared/confirm';

const schema = z
  .object({
    host: z.string().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535),
    secure: z.enum(['tls', 'starttls']),
    username: z.string().max(255).optional(),
    password: z.string().max(512).optional(),
    fromEmail: z.string().email(),
    fromName: z.string().max(100).optional(),
  })
  .refine(
    // Se imposti una password devi anche specificare uno username, altrimenti
    // il transporter non invia l'header AUTH e i provider che richiedono
    // autenticazione (Gmail, Outlook, ...) rispondono "530 Auth Required".
    (d) => !d.password || (d.username && d.username.length > 0),
    { message: 'Username è obbligatorio quando imposti una password', path: ['username'] },
  );

type FormValues = z.input<typeof schema>;

export function SmtpSettingsCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['smtp-settings'],
    queryFn: () => smtpApi.get(),
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      host: '',
      port: 587,
      secure: 'starttls',
      username: '',
      password: '',
      fromEmail: '',
      fromName: '',
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      reset({
        host: settingsQuery.data.host,
        port: settingsQuery.data.port,
        secure: settingsQuery.data.secure ? 'tls' : 'starttls',
        username: settingsQuery.data.username ?? '',
        password: '', // mai precompilata
        fromEmail: settingsQuery.data.fromEmail,
        fromName: settingsQuery.data.fromName ?? '',
      });
    }
  }, [settingsQuery.data, reset]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body: UpdateSmtpInput = {
        host: values.host,
        port: Number(values.port),
        secure: values.secure === 'tls',
        username: values.username || null,
        fromEmail: values.fromEmail,
        fromName: values.fromName || null,
      };
      // Password: se l'utente ha digitato qualcosa la inviamo, altrimenti omettiamo
      // (così resta quella in DB già cifrata).
      if (values.password && values.password.length > 0) {
        body.password = values.password;
      }
      return smtpApi.update(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['smtp-settings'] });
      setValue('password', '');
      setTestResult(null);
    },
  });

  const remove = useMutation({
    mutationFn: () => smtpApi.remove(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['smtp-settings'] });
      setTestResult(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: (to: string) => smtpApi.test(to),
    onSuccess: () => setTestResult(`Email inviata a ${testEmail}.`),
    onError: (e) => setTestResult(`Errore: ${(e as Error).message}`),
  });

  const onSubmit = handleSubmit((values) => save.mutate(values));

  const configured = !!settingsQuery.data;
  const hasPassword = settingsQuery.data?.hasPassword;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Server SMTP (invio email)
          {configured ? (
            <Badge variant="success" className="ml-1">Configurato</Badge>
          ) : (
            <Badge variant="outline" className="ml-1">Non configurato</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Usato per inviare gli inviti via email. La password è cifrata at-rest in DB
          (AES-256-GCM derivata dal segreto JWT). Solo amministratori possono modificare.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProviderHint host={watch('host')} />

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="smtp-host">Host</Label>
              <Input
                id="smtp-host"
                placeholder="smtp.example.com"
                {...register('host')}
                aria-invalid={!!errors.host}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">Porta</Label>
              <Input
                id="smtp-port"
                type="number"
                min={1}
                max={65535}
                {...register('port')}
                aria-invalid={!!errors.port}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Modalità sicurezza</Label>
            <Select
              value={watch('secure')}
              onValueChange={(v) => setValue('secure', v as 'tls' | 'starttls')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="starttls">STARTTLS (porta 587 tipica)</SelectItem>
                <SelectItem value="tls">TLS implicito (porta 465 tipica)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-username">Username (opz.)</Label>
              <Input
                id="smtp-username"
                autoComplete="off"
                {...register('username')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password" className="flex items-center gap-2">
                Password
                {hasPassword && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    salvata
                  </span>
                )}
              </Label>
              <PasswordInput
                id="smtp-password"
                placeholder={hasPassword ? '••••••••  (lascia vuoto per non cambiarla)' : ''}
                stripWhitespaceOnPaste={false}
                {...register('password')}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-from-email">Mittente (email)</Label>
              <Input
                id="smtp-from-email"
                type="email"
                placeholder="noreply@example.com"
                {...register('fromEmail')}
                aria-invalid={!!errors.fromEmail}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-from-name">Mittente (nome)</Label>
              <Input
                id="smtp-from-name"
                placeholder="Finance Manager"
                {...register('fromName')}
              />
            </div>
          </div>

          {save.isError && (
            <p className="text-sm text-destructive">{(save.error as Error).message}</p>
          )}
          {save.isSuccess && (
            <p className="text-sm text-emerald-600 inline-flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Configurazione salvata.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSubmitting || save.isPending}>
              <Save className="h-4 w-4 mr-2" /> Salva
            </Button>
            {configured && (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Rimuovere la configurazione SMTP?',
                    description:
                      "Le email di invito e notifiche non verranno più inviate finché non configurerai un nuovo provider.",
                    confirmLabel: 'Rimuovi',
                    destructive: true,
                  });
                  if (ok) remove.mutate();
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Rimuovi
              </Button>
            )}
          </div>
        </form>

        {/* Test invio */}
        {configured && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="smtp-test-to">Invia email di test a</Label>
                <Input
                  id="smtp-test-to"
                  type="email"
                  placeholder="prova@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => testMutation.mutate(testEmail)}
                disabled={!testEmail || testMutation.isPending}
              >
                <Send className="h-4 w-4 mr-2" />
                {testMutation.isPending ? 'Invio…' : 'Invia test'}
              </Button>
            </div>
            {testResult && (
              <p
                className={`text-sm inline-flex items-center gap-1 ${testResult.startsWith('Errore') ? 'text-destructive' : 'text-emerald-600'}`}
              >
                {testResult.startsWith('Errore') ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {testResult}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderHint({ host }: { host: string }) {
  const h = (host ?? '').toLowerCase();
  let provider: { name: string; tip: React.ReactNode } | null = null;

  if (h.includes('gmail')) {
    provider = {
      name: 'Gmail',
      tip: (
        <>
          Gmail <strong>NON accetta la password del tuo account</strong>: serve una{' '}
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium"
          >
            Password per le app
          </a>{' '}
          (16 caratteri). Per generarla devi avere la verifica in due passaggi attiva, poi vai
          su Account Google → Sicurezza → Password per le app. Usa quella come password qui.
          <br />
          Host: <code className="px-1 rounded bg-muted">smtp.gmail.com</code> · Porta:{' '}
          <code className="px-1 rounded bg-muted">587</code> + STARTTLS, oppure{' '}
          <code className="px-1 rounded bg-muted">465</code> + TLS implicito.
        </>
      ),
    };
  } else if (h.includes('outlook') || h.includes('office365') || h.includes('hotmail') || h.includes('live.com')) {
    provider = {
      name: 'Outlook / Microsoft 365',
      tip: (
        <>
          Microsoft richiede <strong>OAuth2</strong> per gli account personali in molti casi e
          ha disabilitato la "Basic Auth" SMTP per i tenant aziendali. Su account personali
          Outlook.com, attiva la 2FA e crea una <em>Password per le app</em> da{' '}
          <a
            href="https://account.microsoft.com/security"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium"
          >
            account.microsoft.com/security
          </a>
          . Host: <code className="px-1 rounded bg-muted">smtp-mail.outlook.com</code> · Porta:{' '}
          <code className="px-1 rounded bg-muted">587</code> + STARTTLS.
        </>
      ),
    };
  } else if (h.includes('yahoo')) {
    provider = {
      name: 'Yahoo',
      tip: (
        <>
          Yahoo richiede una <strong>Password per le app</strong> generata da{' '}
          <a
            href="https://login.yahoo.com/account/security"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium"
          >
            login.yahoo.com/account/security
          </a>
          . Host: <code className="px-1 rounded bg-muted">smtp.mail.yahoo.com</code> · Porta:{' '}
          <code className="px-1 rounded bg-muted">465</code> + TLS implicito.
        </>
      ),
    };
  } else if (h.includes('aruba')) {
    provider = {
      name: 'Aruba',
      tip: (
        <>
          Host: <code className="px-1 rounded bg-muted">smtps.aruba.it</code> · Porta:{' '}
          <code className="px-1 rounded bg-muted">465</code> + TLS implicito. Usa email e
          password della casella.
        </>
      ),
    };
  }

  if (!provider) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Suggerimento per {provider.name}</p>
          <p className="text-muted-foreground">{provider.tip}</p>
        </div>
      </div>
    </div>
  );
}
