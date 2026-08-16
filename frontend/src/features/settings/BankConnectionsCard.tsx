import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import {
  Building2,
  Plus,
  Trash2,
  Unlink,
  AlertCircle,
  CalendarClock,
  RefreshCw,
  ClipboardList,
  KeyRound,
  Loader2,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { formatDate } from '@/lib/utils/date';
import { formatCents } from '@/lib/utils/currency';
import { useConfirm } from '@/components/shared/confirm';
import { accountsApi } from '@/features/accounts/accountsApi';
import type { Account } from '@/types/domain';
import {
  bankSyncApi,
  MAX_SYNC_TIMES,
  type BankAccountLink,
  type BankConnection,
  type BankConnectionStatus,
  type SyncResult,
} from './bankSyncApi';
import { BankLinkWizard, InstitutionLogo, statusLabel, type WizardResume } from './BankLinkWizard';
import { SyncSummaryPanel, syncErrorMessage } from './syncSummary';

/** Tempo massimo di attesa del polling dopo un rinnovo del consenso. */
const RENEW_TIMEOUT_MS = 5 * 60_000;

/** Connessione il cui consenso è in corso di rinnovo (autorizzazione in banca in attesa). */
interface RenewState {
  connectionId: string;
  startedAt: number;
  /** Snapshot di syncEnabled per link, PRIMA del rinnovo: serve a rilevare i link non rimappati. */
  linksBefore: Record<string, boolean>;
}

/** Esito del rinnovo mostrato inline sulla connessione interessata. */
interface RenewOutcome {
  connectionId: string;
  kind: 'success' | 'failed' | 'timeout';
  /** Solo per kind === 'failed': lo stato finale della connessione. */
  status?: BankConnectionStatus;
  /** Numero di link che erano sincronizzati e ora non lo sono più (rimappatura fallita). */
  unmapped: number;
}

const STATUS_LABELS: Record<BankConnectionStatus, string> = {
  pending: 'In attesa',
  linked: 'Collegato',
  expired: 'Scaduto',
  suspended: 'Sospeso',
  revoked: 'Revocato',
  error: 'Errore',
};

const STATUS_VARIANTS: Record<
  BankConnectionStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'destructive'
> = {
  pending: 'outline',
  linked: 'success',
  expired: 'destructive',
  suspended: 'destructive',
  revoked: 'secondary',
  error: 'destructive',
};

/** Interruttore accessibile (stesso pattern di NotificationsPreferences). */
function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/**
 * Collegamenti bancari dell'utente loggato (visibile a tutti: ognuno gestisce
 * i propri). Le credenziali del provider stanno in una card separata riservata
 * agli amministratori — qui non vengono mai richieste.
 */
export function BankConnectionsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [wizardOpen, setWizardOpen] = useState(false);
  // Ripresa del mapping su una connessione già autorizzata (dialog chiuso al ritorno da Safari).
  const [wizardResume, setWizardResume] = useState<WizardResume | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<{
    results: SyncResult[];
    quotaRemaining: number;
  } | null>(null);
  const [renewState, setRenewState] = useState<RenewState | null>(null);
  const [renewOutcome, setRenewOutcome] = useState<RenewOutcome | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ['bank-connections'],
    queryFn: () => bankSyncApi.listConnections(),
  });

  const reviewCountQuery = useQuery({
    queryKey: ['bank-sync-review-count'],
    queryFn: () => bankSyncApi.reviewCount(),
  });

  // Saldi app per la riconciliazione con l'ultimo saldo dichiarato dalla
  // banca: stessa query della feature conti, così la cache è condivisa.
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  });

  const accountsById = useMemo(() => {
    const map = new Map<string, Account>();
    for (const a of accountsQuery.data ?? []) map.set(a.id, a);
    return map;
  }, [accountsQuery.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['bank-connections'], refetchType: 'all' });
  };

  /** Dopo un sync anche il numero di movimenti da rivedere può essere cambiato. */
  const invalidateAfterSync = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: ['bank-sync-review-count'], refetchType: 'all' });
  };

  const toggleLink = useMutation({
    mutationFn: ({ id, syncEnabled }: { id: string; syncEnabled: boolean }) =>
      bankSyncApi.updateLink(id, syncEnabled),
    onMutate: () => setActionError(null),
    onSuccess: invalidate,
    onError: (e) => setActionError((e as Error).message),
  });

  const removeLink = useMutation({
    mutationFn: (id: string) => bankSyncApi.removeLink(id),
    onMutate: () => setActionError(null),
    onSuccess: invalidate,
    onError: (e) => setActionError((e as Error).message),
  });

  const removeConnection = useMutation({
    mutationFn: (id: string) => bankSyncApi.removeConnection(id),
    onMutate: () => setActionError(null),
    onSuccess: invalidate,
    onError: (e) => setActionError((e as Error).message),
  });

  const syncAll = useMutation({
    mutationFn: () => bankSyncApi.syncAll(),
    onMutate: () => {
      setActionError(null);
      setSyncSummary(null);
    },
    onSuccess: (data) => {
      setSyncSummary(data);
      invalidateAfterSync();
    },
    onError: (e) => setActionError(syncErrorMessage(e)),
  });

  const syncLink = useMutation({
    mutationFn: (id: string) => bankSyncApi.syncLink(id),
    onMutate: () => {
      setActionError(null);
      setSyncSummary(null);
    },
    onSuccess: (data) => {
      setSyncSummary({ results: [data.result], quotaRemaining: data.quotaRemaining });
      invalidateAfterSync();
    },
    onError: (e) => setActionError(syncErrorMessage(e)),
  });

  const renewConnection = useMutation({
    mutationFn: (id: string) => bankSyncApi.renewConnection(id),
    onMutate: () => setActionError(null),
    onSuccess: (data, id) => {
      window.open(data.authUrl, '_blank', 'noopener,noreferrer');
      const conn = connectionsQuery.data?.items.find((c) => c.id === id);
      const linksBefore: Record<string, boolean> = {};
      for (const l of conn?.links ?? []) linksBefore[l.id] = l.syncEnabled;
      setRenewOutcome(null);
      setRenewState({ connectionId: id, startedAt: Date.now(), linksBefore });
    },
    onError: (e) => setActionError((e as Error).message),
  });

  // Polling sullo stato locale della connessione dopo il rinnovo, stesso
  // pattern del wizard: il callback pubblico può atterrare fuori dalla PWA.
  const renewPollQuery = useQuery({
    queryKey: ['bank-connection-renew', renewState?.connectionId],
    queryFn: () => bankSyncApi.getConnection(renewState?.connectionId as string),
    enabled: !!renewState,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2000 : false),
  });

  // Rileva l'uscita dallo stato "pending": esito riuscito o fallito.
  useEffect(() => {
    if (!renewState || !renewPollQuery.data) return;
    const data = renewPollQuery.data;
    if (data.status === 'pending') return;
    const unmapped = data.links.filter(
      (l) => renewState.linksBefore[l.id] === true && !l.syncEnabled,
    ).length;
    setRenewOutcome({
      connectionId: renewState.connectionId,
      kind: data.status === 'linked' ? 'success' : 'failed',
      status: data.status,
      unmapped,
    });
    setRenewState(null);
    invalidate();
  }, [renewState, renewPollQuery.data]);

  // Timeout indipendente dal polling: se dopo 5 minuti è ancora "pending",
  // smettiamo di aspettare (l'utente può riprovare il rinnovo).
  useEffect(() => {
    if (!renewState) return;
    const remaining = RENEW_TIMEOUT_MS - (Date.now() - renewState.startedAt);
    const timer = setTimeout(
      () => {
        setRenewOutcome({ connectionId: renewState.connectionId, kind: 'timeout', unmapped: 0 });
        setRenewState(null);
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [renewState]);

  const connections = connectionsQuery.data?.items ?? [];
  const reviewCount = reviewCountQuery.data?.count ?? 0;
  const syncing = syncAll.isPending || syncLink.isPending;
  const hasSyncableLinks = connections.some((c) => c.links.some((l) => l.syncEnabled));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Collegamenti bancari
            </CardTitle>
            <CardDescription>
              Collega i tuoi conti bancari in <strong>sola lettura</strong> per importare
              automaticamente i movimenti. Ogni utente gestisce i propri collegamenti; il consenso
              va rinnovato periodicamente (di norma ogni 90 giorni).
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {reviewCount > 0 && (
              /* Scorciatoia alla coda di revisione (Fase 4). */
              <Link
                to="/bank-review"
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
                title="Movimenti importati dalla banca in attesa di revisione"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                {reviewCount} da rivedere
              </Link>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncing || !hasSyncableLinks}
              onClick={() => syncAll.mutate()}
            >
              <RefreshCw
                className={cn('h-4 w-4 mr-2', syncAll.isPending && 'animate-spin')}
              />
              {t('bankSync.syncNow')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connectionsQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        )}

        {connectionsQuery.isError && (
          <p className="text-sm text-destructive flex items-start gap-1">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {(connectionsQuery.error as Error).message}
          </p>
        )}

        {connectionsQuery.isSuccess && connections.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nessuna banca collegata. Usa “Collega una banca” per iniziare.
          </p>
        )}

        <ul className="space-y-3">
          {connections.map((conn) => (
            <ConnectionRow
              key={conn.id}
              connection={conn}
              busy={toggleLink.isPending || removeLink.isPending || removeConnection.isPending}
              syncing={syncing}
              accountsById={accountsById}
              renewing={renewState?.connectionId === conn.id}
              renewDisabled={renewConnection.isPending || !!renewState}
              renewOutcome={renewOutcome?.connectionId === conn.id ? renewOutcome : null}
              onRenew={(id) => renewConnection.mutate(id)}
              onMapAccounts={(c) => {
                setWizardResume({
                  connectionId: c.id,
                  institutionName: c.institutionName,
                  institutionLogo: c.institutionLogo,
                });
                setWizardOpen(true);
              }}
              onDismissRenewOutcome={() => setRenewOutcome(null)}
              onToggleLink={(id, syncEnabled) => toggleLink.mutate({ id, syncEnabled })}
              onSyncLink={(id) => syncLink.mutate(id)}
              onRemoveLink={async (id, name) => {
                const ok = await confirm({
                  title: 'Scollegare il conto?',
                  description: `Il conto "${name}" non riceverà più movimenti dalla banca. I movimenti già importati restano.`,
                  confirmLabel: 'Scollega',
                  destructive: true,
                });
                if (ok) removeLink.mutate(id);
              }}
              onRemoveConnection={async (id, institutionName) => {
                const ok = await confirm({
                  title: 'Eliminare il collegamento?',
                  description: `Il consenso a "${institutionName}" verrà revocato e tutti i conti collegati smetteranno di sincronizzarsi. I movimenti già importati restano.`,
                  confirmLabel: 'Elimina',
                  destructive: true,
                });
                if (ok) removeConnection.mutate(id);
              }}
            />
          ))}
        </ul>

        {/* Orari del sync automatico: ha senso solo se c'è almeno una banca collegata. */}
        {connections.length > 0 && <SyncScheduleSection />}

        {actionError && (
          <p className="text-sm text-destructive flex items-start gap-1">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {actionError}
          </p>
        )}

        {syncSummary && (
          <SyncSummaryPanel summary={syncSummary} onDismiss={() => setSyncSummary(null)} />
        )}

        <Button
          type="button"
          onClick={() => {
            setWizardResume(null);
            setWizardOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Collega una banca
        </Button>
      </CardContent>

      <BankLinkWizard
        open={wizardOpen}
        onOpenChange={(o) => {
          setWizardOpen(o);
          if (!o) setWizardResume(null);
        }}
        resume={wizardResume}
      />
    </Card>
  );
}

/**
 * Riporta un `HH:mm` sulla griglia dei quarti d'ora arrotondando **per
 * difetto**, come fa il tick del cron lato backend. Ritorna `null` se il valore
 * non è un orario (l'input `type="time"` può tornare stringa vuota).
 */
function toQuarterHour(value: string): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isInteger(hours) || hours > 23 || !Number.isInteger(minutes) || minutes > 59) {
    return null;
  }
  const quarter = Math.floor(minutes / 15) * 15;
  return `${String(hours).padStart(2, '0')}:${String(quarter).padStart(2, '0')}`;
}

/**
 * Orari della sincronizzazione automatica (`User.bankSyncTimes`): da 0 a 4 al
 * giorno, a passi di 15 minuti, in ora italiana. Ogni aggiunta/rimozione salva
 * subito, come il toggle di sincronizzazione dei singoli conti.
 */
function SyncScheduleSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  /** Messaggio di validazione client-side (limite, duplicato, arrotondamento). */
  const [hint, setHint] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const scheduleQuery = useQuery({
    queryKey: ['bank-sync-schedule'],
    queryFn: () => bankSyncApi.getSchedule(),
  });

  const saveSchedule = useMutation({
    mutationFn: (times: string[]) => bankSyncApi.updateSchedule(times),
    onMutate: () => {
      setHint(null);
      setSaved(false);
    },
    onSuccess: (data) => {
      // La risposta è già normalizzata dal server (dedup + ordinamento).
      queryClient.setQueryData(['bank-sync-schedule'], data);
      void queryClient.invalidateQueries({ queryKey: ['bank-sync-schedule'] });
      setSaved(true);
    },
  });

  const times = scheduleQuery.data?.times ?? [];
  const busy = saveSchedule.isPending || scheduleQuery.isLoading;

  const addTime = () => {
    const normalized = toQuarterHour(draft);
    if (!normalized) {
      setHint(t('bankSync.schedule.invalid'));
      return;
    }
    if (times.includes(normalized)) {
      setHint(t('bankSync.schedule.duplicate'));
      return;
    }
    if (times.length >= MAX_SYNC_TIMES) {
      setHint(t('bankSync.schedule.maxReached', { max: MAX_SYNC_TIMES }));
      return;
    }
    setDraft('');
    saveSchedule.mutate([...times, normalized]);
    if (normalized !== draft.trim()) {
      setHint(t('bankSync.schedule.rounded', { time: normalized }));
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium flex items-center gap-2">
        <Clock className="h-4 w-4" />
        {t('bankSync.schedule.title')}
      </p>

      {scheduleQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">{t('bankSync.schedule.loading')}</p>
      ) : times.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('bankSync.schedule.disabled')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {times.map((time) => (
            <li
              key={time}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium"
            >
              <span className="font-mono">{time}</span>
              <button
                type="button"
                aria-label={t('bankSync.schedule.remove', { time })}
                title={t('bankSync.schedule.remove', { time })}
                disabled={busy}
                onClick={() => saveSchedule.mutate(times.filter((x) => x !== time))}
                className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="time"
          step={900}
          value={draft}
          aria-label={t('bankSync.schedule.addLabel')}
          disabled={busy || times.length >= MAX_SYNC_TIMES}
          onChange={(e) => {
            setDraft(e.target.value);
            setHint(null);
          }}
          className="h-9 w-32"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !draft}
          onClick={addTime}
        >
          {saveSchedule.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          {saveSchedule.isPending ? t('bankSync.schedule.saving') : t('bankSync.schedule.add')}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('bankSync.schedule.help', { max: MAX_SYNC_TIMES })}
      </p>

      {hint && <p className="text-xs text-amber-600">{hint}</p>}

      {saveSchedule.isError && (
        <p className="text-xs text-destructive flex items-start gap-1">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {(saveSchedule.error as Error).message}
        </p>
      )}

      {saved && !saveSchedule.isPending && !saveSchedule.isError && (
        <p className="text-xs text-emerald-600 flex items-start gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {t('bankSync.schedule.saved')}
        </p>
      )}
    </div>
  );
}

/** Confronta il saldo dichiarato dalla banca con quello del conto app (Fase 5). */
function BalanceReconciliation({ link, account }: { link: BankAccountLink; account?: Account }) {
  const { t } = useTranslation();
  if (link.lastBalanceCents == null || !account) return null;

  const bankCents = BigInt(link.lastBalanceCents);
  const appCents = BigInt(account.balanceCents);
  const lastAt = link.lastBalanceAt
    ? formatDate(link.lastBalanceAt, "d MMM yyyy 'alle' HH:mm")
    : null;

  if (bankCents === appCents) {
    return (
      <span className="block text-xs text-muted-foreground">
        Saldo allineato ✓{lastAt ? ` · rilevato il ${lastAt}` : ''}
      </span>
    );
  }

  const diff = bankCents > appCents ? bankCents - appCents : appCents - bankCents;
  return (
    <span className="mt-1 block space-y-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Saldo banca: {formatCents(bankCents)} · differenza {formatCents(diff)}
        </span>
        {lastAt && <span className="text-xs text-muted-foreground">rilevato il {lastAt}</span>}
      </span>
      <span className="block text-xs text-muted-foreground">
        {t('bankSync.reconciliation.pendingNote')}
      </span>
    </span>
  );
}

/** Messaggio inline con l'esito del rinnovo del consenso di una connessione. */
function RenewOutcomeMessage({ outcome }: { outcome: RenewOutcome }) {
  if (outcome.kind === 'timeout') {
    return (
      <p className="text-xs text-amber-600 flex items-start gap-1">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Tempo scaduto in attesa dell’autorizzazione: se l’hai completata sul sito della banca il
        collegamento si aggiornerà al prossimo controllo, altrimenti riprova il rinnovo.
      </p>
    );
  }
  if (outcome.kind === 'failed') {
    return (
      <p className="text-xs text-destructive flex items-start gap-1">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Rinnovo non riuscito{outcome.status ? ` (${statusLabel(outcome.status)})` : ''}.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-emerald-600 flex items-start gap-1">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Collegamento rinnovato con successo.
      </p>
      {outcome.unmapped > 0 && (
        <p className="text-xs text-amber-600 flex items-start gap-1">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {outcome.unmapped} cont{outcome.unmapped === 1 ? 'o non è stato' : 'i non sono stati'}{' '}
          ricollegat{outcome.unmapped === 1 ? 'o' : 'i'} automaticamente: ricollega i conti non
          mappati qui sotto.
        </p>
      )}
    </div>
  );
}

const RENEWABLE_STATUSES = new Set<BankConnectionStatus>(['expired', 'suspended', 'error']);

function ConnectionRow({
  connection,
  busy,
  syncing,
  accountsById,
  renewing,
  renewDisabled,
  renewOutcome,
  onRenew,
  onMapAccounts,
  onDismissRenewOutcome,
  onToggleLink,
  onSyncLink,
  onRemoveLink,
  onRemoveConnection,
}: {
  connection: BankConnection;
  busy: boolean;
  syncing: boolean;
  accountsById: Map<string, Account>;
  renewing: boolean;
  renewDisabled: boolean;
  renewOutcome: RenewOutcome | null;
  onRenew: (connectionId: string) => void;
  onMapAccounts: (connection: BankConnection) => void;
  onDismissRenewOutcome: () => void;
  onToggleLink: (linkId: string, syncEnabled: boolean) => void;
  onSyncLink: (linkId: string) => void;
  onRemoveLink: (linkId: string, accountName: string) => void;
  onRemoveConnection: (connectionId: string, institutionName: string) => void;
}) {
  const expiring = connection.consentExpiresAt
    ? new Date(connection.consentExpiresAt).getTime() - Date.now() < 7 * 86_400_000
    : false;
  const needsRenewal = RENEWABLE_STATUSES.has(connection.status) || expiring;

  return (
    <li className="rounded-md border p-3 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <InstitutionLogo logo={connection.institutionLogo} name={connection.institutionName} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{connection.institutionName}</p>
          <p className="text-xs text-muted-foreground">
            Collegato il {formatDate(connection.createdAt)}
          </p>
          {connection.consentExpiresAt && (
            <p
              className={cn(
                'text-xs flex items-center gap-1',
                expiring ? 'text-amber-600' : 'text-muted-foreground',
              )}
            >
              <CalendarClock className="h-3 w-3 shrink-0" />
              Consenso valido fino al {formatDate(connection.consentExpiresAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={STATUS_VARIANTS[connection.status]}>
            {STATUS_LABELS[connection.status]}
          </Badge>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Elimina collegamento"
            title="Elimina collegamento"
            disabled={busy}
            onClick={() => onRemoveConnection(connection.id, connection.institutionName)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {needsRenewal && (
        <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {RENEWABLE_STATUSES.has(connection.status)
                ? 'Il consenso non è più valido: rinnova il collegamento per riprendere la sincronizzazione.'
                : 'Il consenso sta per scadere: rinnovalo per non interrompere la sincronizzazione.'}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-300 bg-background text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
              disabled={busy || renewDisabled}
              onClick={() => onRenew(connection.id)}
            >
              {renewing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4 mr-2" />
              )}
              Rinnova collegamento
            </Button>
          </div>
          {renewing && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              In attesa dell’autorizzazione sul sito della banca…
            </p>
          )}
        </div>
      )}

      {renewOutcome && !renewing && (
        <div className="flex items-start justify-between gap-2 rounded-md border p-2">
          <RenewOutcomeMessage outcome={renewOutcome} />
          <button
            type="button"
            onClick={onDismissRenewOutcome}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Chiudi
          </button>
        </div>
      )}

      {connection.links.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {connection.status === 'pending'
              ? 'Autorizzazione non ancora completata sul sito della banca.'
              : 'Nessun conto collegato a questa banca.'}
          </p>
          {connection.status === 'linked' && (
            <Button size="sm" onClick={() => onMapAccounts(connection)}>
              Collega i conti
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {connection.links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2 text-sm"
            >
              {/* min-w: sotto questa larghezza le azioni vanno a capo invece di schiacciare il testo */}
              <span className="min-w-[13rem] flex-1">
                <span className="block truncate font-medium">{link.accountName}</span>
                <span className="block text-xs text-muted-foreground font-mono break-all">
                  {link.iban ?? link.providerAccountId} · {link.currency}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Ultimo sync:{' '}
                  {link.lastSyncAt ? formatDate(link.lastSyncAt, "d MMM yyyy 'alle' HH:mm") : 'mai'}
                </span>
                <BalanceReconciliation link={link} account={accountsById.get(link.accountId)} />
              </span>
              <span className="ml-auto flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {link.syncEnabled ? 'Sync attiva' : 'Sync sospesa'}
                </span>
                <Toggle
                  checked={link.syncEnabled}
                  disabled={busy}
                  label={`Sincronizzazione per ${link.accountName}`}
                  onChange={(v) => onToggleLink(link.id, v)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Sincronizza ${link.accountName}`}
                  title={link.syncEnabled ? 'Sincronizza ora' : 'Riattiva la sincronizzazione per sincronizzare'}
                  disabled={busy || syncing || !link.syncEnabled}
                  onClick={() => onSyncLink(link.id)}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Scollega conto"
                  title="Scollega conto"
                  disabled={busy}
                  onClick={() => onRemoveLink(link.id, link.accountName)}
                >
                  <Unlink className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
