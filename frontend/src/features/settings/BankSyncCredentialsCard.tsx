import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Landmark,
  Save,
  Trash2,
  PlugZap,
  CheckCircle2,
  AlertCircle,
  Lock,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/shared/confirm';
import { bankSyncApi } from './bankSyncApi';

const schema = z.object({
  // MinLength(4)/MaxLength(200) come il DTO backend.
  appId: z.string().trim().min(4, 'Inserisci l’Application ID').max(200),
  privateKeyPem: z
    .string()
    .min(1, 'Incolla la chiave privata')
    .refine((v) => v.includes('BEGIN') && v.includes('PRIVATE KEY'), {
      message: 'La chiave deve essere in formato PEM (-----BEGIN PRIVATE KEY-----)',
    }),
});

type FormValues = z.infer<typeof schema>;

/**
 * Credenziali Enable Banking (solo amministratori).
 *
 * La chiave privata PEM è cifrata at-rest e non viene mai restituita dal GET:
 * la textarea parte quindi sempre vuota e per aggiornare l'Application ID
 * bisogna reincollare anche la chiave (il PUT richiede entrambi i campi).
 */
export function BankSyncCredentialsCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const statusQuery = useQuery({
    queryKey: ['bank-sync-credentials'],
    queryFn: () => bankSyncApi.getCredentials(),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { appId: '', privateKeyPem: '' },
  });

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      bankSyncApi.updateCredentials({
        appId: values.appId.trim(),
        privateKeyPem: values.privateKeyPem,
      }),
    onSuccess: () => {
      // La chiave non torna mai indietro: svuotiamo subito il form.
      reset({ appId: '', privateKeyPem: '' });
      setTestResult(null);
      void queryClient.invalidateQueries({ queryKey: ['bank-sync-credentials'], refetchType: 'all' });
    },
  });

  const remove = useMutation({
    mutationFn: () => bankSyncApi.removeCredentials(),
    onSuccess: () => {
      setTestResult(null);
      reset({ appId: '', privateKeyPem: '' });
      void queryClient.invalidateQueries({ queryKey: ['bank-sync-credentials'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['bank-institutions'], refetchType: 'all' });
    },
  });

  const test = useMutation({
    mutationFn: () => bankSyncApi.testCredentials(),
    onMutate: () => setTestResult(null),
    onSuccess: (r) => setTestResult({ ok: r.ok, message: r.message }),
    onError: (e) => setTestResult({ ok: false, message: (e as Error).message }),
  });

  const status = statusQuery.data;
  const configured = !!status?.hasCredentials;

  return (
    <CollapsibleCard
      title={
        <>
          <Landmark className="h-4 w-4" />
          Credenziali Enable Banking
          {configured ? (
            <Badge variant="success" className="ml-1">Configurate</Badge>
          ) : (
            <Badge variant="outline" className="ml-1">Non configurate</Badge>
          )}
        </>
      }
      description="Credenziali dell'applicazione registrata su enablebanking.com, usate per collegare i conti bancari in sola lettura. La chiave privata è cifrata at-rest in DB (AES-256-GCM derivata dal segreto JWT) e non è più visualizzabile dopo il salvataggio. Solo amministratori."
      storageKey="fm-cfg-banksync"
    >
      <div className="space-y-4">
        {configured && (
          <div className="rounded-md border p-3 flex flex-wrap items-center gap-2 text-sm">
            <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Application ID:</span>
            <span className="font-mono font-medium break-all">{status?.appIdMasked ?? '—'}</span>
          </div>
        )}

        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-muted-foreground">
              Registra un&apos;applicazione nel Control Panel di Enable Banking: ottieni
              l&apos;<strong>Application ID</strong> e scarichi una sola volta la{' '}
              <strong>chiave privata RS256 (.pem)</strong>. Per aggiornare le credenziali devi
              reinserire entrambi i valori.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bank-sync-app-id">Application ID</Label>
            <Input
              id="bank-sync-app-id"
              autoComplete="off"
              spellCheck={false}
              placeholder="00000000-0000-0000-0000-000000000000"
              {...register('appId')}
              aria-invalid={!!errors.appId}
            />
            {errors.appId && (
              <p className="text-xs text-destructive">{errors.appId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bank-sync-key">Chiave privata (PEM)</Label>
            <Textarea
              id="bank-sync-key"
              rows={6}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs min-h-[140px]"
              placeholder={
                configured
                  ? 'Chiave salvata e cifrata — incollane una nuova solo per sostituirla'
                  : '-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'
              }
              {...register('privateKeyPem')}
              aria-invalid={!!errors.privateKeyPem}
            />
            {errors.privateKeyPem && (
              <p className="text-xs text-destructive">{errors.privateKeyPem.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Il contenuto non viene mai rimostrato: se lo perdi, rigenera la chiave dal
              portale Enable Banking e reinseriscila qui.
            </p>
          </div>

          {save.isError && (
            <p className="text-sm text-destructive flex items-start gap-1">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {(save.error as Error).message}
            </p>
          )}
          {save.isSuccess && (
            <p className="text-sm text-emerald-600 inline-flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Credenziali salvate.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSubmitting || save.isPending}>
              <Save className="h-4 w-4 mr-2" /> Salva
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!configured || test.isPending}
              onClick={() => test.mutate()}
            >
              <PlugZap className="h-4 w-4 mr-2" />
              {test.isPending ? 'Verifica…' : 'Prova connessione'}
            </Button>
            {configured && (
              <Button
                type="button"
                variant="ghost"
                disabled={remove.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Eliminare le credenziali?',
                    description:
                      'Senza credenziali non sarà più possibile collegare banche né sincronizzare i movimenti. I collegamenti esistenti smetteranno di aggiornarsi.',
                    confirmLabel: 'Elimina',
                    destructive: true,
                  });
                  if (ok) remove.mutate();
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Elimina
              </Button>
            )}
          </div>
        </form>

        {testResult && (
          <p
            className={`text-sm flex items-start gap-1 ${testResult.ok ? 'text-emerald-600' : 'text-destructive'}`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <span>{testResult.message}</span>
          </p>
        )}

        {remove.isError && (
          <p className="text-sm text-destructive flex items-start gap-1">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {(remove.error as Error).message}
          </p>
        )}
      </div>
    </CollapsibleCard>
  );
}
