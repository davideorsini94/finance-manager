import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDropzone } from 'react-dropzone';
import { Download, Upload, AlertTriangle, Save, KeyRound } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/features/auth/useAuth';
import { applyTheme, useUIStore, type Theme } from '@/store/uiStore';
import { PasswordInput } from '@/components/shared/PasswordInput';
import { settingsApi } from './settingsApi';
import { SmtpSettingsCard } from './SmtpSettingsCard';
import { LlmSettingsCard } from './LlmSettingsCard';
import { BankSyncCredentialsCard } from './BankSyncCredentialsCard';
import { BankConnectionsCard } from './BankConnectionsCard';
import { InviteUsersCard } from './InviteUsersCard';
import { ViewportDiagnosticsCard } from './ViewportDiagnosticsCard';
import { useConfirm } from '@/components/shared/confirm';

const profileSchema = z.object({
  fullName: z.string().max(100).optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Le password non coincidono',
    path: ['confirmPassword'],
  });

export function SettingsPage() {
  const { i18n } = useTranslation();
  const confirm = useConfirm();
  const user = useAuth((s) => s.user);
  const setUnauthenticated = useAuth((s) => s.setUnauthenticated);
  const navigate = useNavigate();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const isAdmin = user?.role === 'admin';

  // ---------- Profilo ----------
  const profileForm = useForm<{ fullName?: string }>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: user?.fullName ?? '' },
  });
  const profileMutation = useMutation({
    mutationFn: (data: { fullName?: string }) => settingsApi.updateProfile(data),
  });

  // ---------- Password ----------
  const passwordForm = useForm<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const passwordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      settingsApi.changePassword(data),
    onSuccess: async () => {
      passwordForm.reset();
      // Il backend ha revocato i refresh token: forziamo logout
      setUnauthenticated();
      await navigate({ to: '/login' });
    },
  });

  // ---------- Backup ----------
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const restoreMutation = useMutation({
    mutationFn: (file: File) => settingsApi.restoreBackup(file),
    onSuccess: (r) => {
      const total = Object.values(r.restored).reduce((acc, n) => acc + n, 0);
      setRestoreResult(`Ripristinati ${total} record + ${r.blobs} allegati. Effettua nuovamente il login.`);
      setUnauthenticated();
    },
    onError: (e) => setRestoreResult(`Errore: ${(e as Error).message}`),
  });

  const onDrop = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const ok = await confirm({
      title: 'Ripristinare il backup?',
      description:
        'ATTENZIONE: il restore CANCELLA tutti i dati attuali e li sostituisce con quelli del backup. L\'operazione non è reversibile.',
      confirmLabel: 'Ripristina',
      destructive: true,
    });
    if (!ok) return;
    restoreMutation.mutate(file);
  };

  const dropzone = useDropzone({
    onDrop,
    accept: { 'application/zip': ['.zip'] },
    maxSize: 500 * 1024 * 1024,
    multiple: false,
    disabled: !isAdmin || restoreMutation.isPending,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Impostazioni</h1>

      {/* Profilo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profilo</CardTitle>
          <CardDescription>{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={profileForm.handleSubmit((v) => profileMutation.mutate(v))}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="fullName">Nome completo</Label>
              <Input id="fullName" {...profileForm.register('fullName')} />
            </div>
            {profileMutation.isSuccess && (
              <p className="text-xs text-emerald-600">Profilo aggiornato.</p>
            )}
            <Button type="submit" disabled={profileMutation.isPending}>
              <Save className="h-4 w-4 mr-2" /> Salva
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Aspetto */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aspetto</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Tema</Label>
            <Select
              value={theme}
              onValueChange={(v) => {
                const t = v as Theme;
                setTheme(t);
                applyTheme(t);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Chiaro</SelectItem>
                <SelectItem value="dark">Scuro</SelectItem>
                <SelectItem value="system">Sistema</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Lingua</Label>
            <Select
              value={i18n.resolvedLanguage ?? 'it'}
              onValueChange={(v) => void i18n.changeLanguage(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="it">Italiano</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Cambia password
          </CardTitle>
          <CardDescription>
            Dopo il cambio, tutte le sessioni vengono terminate e dovrai effettuare nuovamente il login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={passwordForm.handleSubmit((v) =>
              passwordMutation.mutate({
                currentPassword: v.currentPassword,
                newPassword: v.newPassword,
              }),
            )}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Password attuale</Label>
              <PasswordInput
                id="currentPassword"
                autoComplete="current-password"
                stripWhitespaceOnPaste={false}
                {...passwordForm.register('currentPassword')}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nuova password</Label>
                <PasswordInput
                  id="newPassword"
                  autoComplete="new-password"
                  stripWhitespaceOnPaste={false}
                  {...passwordForm.register('newPassword')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Conferma</Label>
                <PasswordInput
                  id="confirmPassword"
                  autoComplete="new-password"
                  stripWhitespaceOnPaste={false}
                  {...passwordForm.register('confirmPassword')}
                />
              </div>
            </div>
            {passwordForm.formState.errors.confirmPassword && (
              <p className="text-xs text-destructive">
                {passwordForm.formState.errors.confirmPassword.message}
              </p>
            )}
            {passwordMutation.isError && (
              <p className="text-xs text-destructive">
                {(passwordMutation.error as Error).message}
              </p>
            )}
            <Button type="submit" disabled={passwordMutation.isPending}>
              Cambia password
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Collegamenti bancari (tutti gli utenti: ognuno gestisce i propri) */}
      <BankConnectionsCard />

      {/* Inviti utenti (solo admin) */}
      {isAdmin && <InviteUsersCard />}

      {/* SMTP (solo admin) */}
      {isAdmin && <SmtpSettingsCard />}

      {/* LLM / Ollama (solo admin) */}
      {isAdmin && <LlmSettingsCard />}

      {/* Credenziali Enable Banking (solo admin) */}
      {isAdmin && <BankSyncCredentialsCard />}

      {/* Backup / Restore (solo admin) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Backup &amp; Restore</CardTitle>
            <CardDescription>
              Esporta tutti i dati (database + allegati MinIO) in un file .zip, oppure
              ripristina da un backup precedente. Solo amministratori.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                onClick={async () => {
                  setBackupBusy(true);
                  try {
                    await settingsApi.downloadBackup();
                  } catch (e) {
                    alert((e as Error).message);
                  } finally {
                    setBackupBusy(false);
                  }
                }}
                disabled={backupBusy}
              >
                <Download className="h-4 w-4 mr-2" />
                {backupBusy ? 'Generazione…' : 'Scarica backup .zip'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Tutti i dati e gli allegati in un unico archivio.
              </p>
            </div>

            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">Attenzione: il restore è distruttivo</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Tutti i dati attuali (utenti compresi) vengono cancellati e sostituiti con
                    quelli del backup. Dopo il restore tutte le sessioni sono invalidate.
                  </p>
                </div>
              </div>
            </div>

            <div
              {...dropzone.getRootProps()}
              className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-sm transition ${
                dropzone.isDragActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground'
              } ${restoreMutation.isPending ? 'opacity-50' : 'cursor-pointer hover:bg-accent/40'}`}
            >
              <input {...dropzone.getInputProps()} />
              <Upload className="h-5 w-5" />
              {restoreMutation.isPending ? (
                <p>Restore in corso… (può richiedere qualche minuto)</p>
              ) : (
                <p>Trascina qui un .zip di backup o clicca per scegliere</p>
              )}
            </div>

            {restoreResult && (
              <p
                className={`text-sm ${restoreResult.startsWith('Errore') ? 'text-destructive' : 'text-emerald-600'}`}
              >
                {restoreResult}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Diagnostica viewport (debug problemi layout iOS/PWA) */}
      <ViewportDiagnosticsCard />
    </div>
  );
}
