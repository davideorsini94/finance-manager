import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark,
  Search,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { accountsApi } from '@/features/accounts/accountsApi';
import type { Account } from '@/types/domain';
import {
  bankSyncApi,
  type BankInstitution,
  type ProviderAccount,
} from './bankSyncApi';

type Step = 'institution' | 'authorize' | 'map' | 'summary';

/** Scelta di mapping per un singolo conto bancario. */
interface Choice {
  mode: 'none' | 'existing' | 'new';
  accountId?: string;
  newName: string;
}

interface LinkOutcome {
  uid: string;
  label: string;
  ok: boolean;
  message: string;
}

const NONE_VALUE = '__none__';
const NEW_VALUE = '__new__';

/** Logo dell'istituto con fallback all'icona quando l'immagine non carica. */
export function InstitutionLogo({
  logo,
  name,
  className = 'h-8 w-8',
}: {
  logo: string | null;
  name: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!logo || broken) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded bg-muted ${className}`}
        aria-hidden
      >
        <Landmark className="h-4 w-4 text-muted-foreground" />
      </span>
    );
  }
  return (
    <img
      src={logo}
      alt={name}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`shrink-0 rounded object-contain ${className}`}
    />
  );
}

function accountLabel(a: ProviderAccount): string {
  return a.name ?? a.iban ?? a.uid;
}

function suggestedName(a: ProviderAccount, institutionName: string): string {
  if (a.name && a.name.trim().length > 0) return a.name.trim();
  const tail = a.iban ? a.iban.slice(-4) : null;
  return tail ? `${institutionName} ${tail}` : institutionName;
}

/**
 * Wizard di collegamento a una banca: scelta istituto → autorizzazione sul
 * sito della banca (con polling sullo stato della connessione) → mapping dei
 * conti bancari sui conti dell'app.
 */
/** Ripresa del mapping su una connessione già autorizzata (es. dialog chiuso tornando da Safari). */
export interface WizardResume {
  connectionId: string;
  institutionName: string;
  institutionLogo?: string | null;
}

export function BankLinkWizard({
  open,
  onOpenChange,
  resume,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resume?: WizardResume | null;
}) {
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('institution');
  const [query, setQuery] = useState('');
  // 'IT' di default; passa ad 'ALL' se la lista italiana è vuota (es. app
  // Enable Banking sandbox: espone solo la Mock ASPSP, che non è italiana).
  const [countryScope, setCountryScope] = useState<'IT' | 'ALL'>('IT');
  const [institution, setInstitution] = useState<BankInstitution | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [outcomes, setOutcomes] = useState<LinkOutcome[]>([]);

  // Reset completo a ogni apertura: il wizard è usa-e-getta. Con `resume`
  // salta direttamente al mapping di una connessione già autorizzata.
  useEffect(() => {
    if (open) {
      setQuery('');
      setCountryScope('IT');
      setAuthUrl(null);
      setChoices({});
      setOutcomes([]);
      if (resume) {
        setStep('map');
        setConnectionId(resume.connectionId);
        setInstitution({
          name: resume.institutionName,
          country: '',
          logo: resume.institutionLogo ?? null,
          maximumConsentValidity: null,
          psuTypes: [],
        });
      } else {
        setStep('institution');
        setInstitution(null);
        setConnectionId(null);
      }
    }
  }, [open, resume]);

  const institutionsQuery = useQuery({
    queryKey: ['bank-institutions', countryScope],
    queryFn: () => bankSyncApi.institutions(countryScope),
    enabled: open,
    staleTime: 60 * 60 * 1000, // il backend cacha 24h: inutile insistere
    retry: false,
  });

  // Fallback automatico: nessuna banca italiana → riprova senza filtro paese.
  useEffect(() => {
    if (
      countryScope === 'IT' &&
      institutionsQuery.isSuccess &&
      institutionsQuery.data.items.length === 0
    ) {
      setCountryScope('ALL');
    }
  }, [countryScope, institutionsQuery.isSuccess, institutionsQuery.data]);

  const createConnection = useMutation({
    mutationFn: (inst: BankInstitution) =>
      bankSyncApi.createConnection({
        aspspName: inst.name,
        aspspCountry: inst.country,
        institutionLogo: inst.logo ?? undefined,
      }),
    onSuccess: (r) => {
      setConnectionId(r.connectionId);
      setAuthUrl(r.authUrl);
      setStep('authorize');
      void queryClient.invalidateQueries({ queryKey: ['bank-connections'], refetchType: 'all' });
    },
  });

  // Polling sullo stato locale della connessione: il callback pubblico può
  // atterrare in Safari fuori dalla PWA, quindi l'app non riceve nessun
  // evento di ritorno — deve chiedere.
  const connectionQuery = useQuery({
    queryKey: ['bank-connection', connectionId],
    queryFn: () => bankSyncApi.getConnection(connectionId as string),
    enabled: open && step === 'authorize' && !!connectionId,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2000 : false),
  });

  const connectionStatus = connectionQuery.data?.status;

  useEffect(() => {
    if (step === 'authorize' && connectionStatus === 'linked') {
      setStep('map');
      void queryClient.invalidateQueries({ queryKey: ['bank-connections'], refetchType: 'all' });
    }
  }, [step, connectionStatus, queryClient]);

  const providerAccountsQuery = useQuery({
    queryKey: ['bank-connection-accounts', connectionId],
    queryFn: () => bankSyncApi.connectionAccounts(connectionId as string),
    enabled: open && step === 'map' && !!connectionId,
    retry: false,
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
    enabled: open && step === 'map',
  });

  const connectionsQuery = useQuery({
    queryKey: ['bank-connections'],
    queryFn: () => bankSyncApi.listConnections(),
    enabled: open && step === 'map',
  });

  // Conti dell'app già collegati a una banca: non sono riutilizzabili
  // (vincolo 1 conto app = 1 conto banca).
  const linkedAccountIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of connectionsQuery.data?.items ?? []) {
      for (const l of c.links) set.add(l.accountId);
    }
    return set;
  }, [connectionsQuery.data]);

  const eligibleAccounts = useMemo(
    () =>
      (accountsQuery.data ?? []).filter(
        (a: Account) => a.type === 'checking' && !a.archivedAt && !linkedAccountIds.has(a.id),
      ),
    [accountsQuery.data, linkedAccountIds],
  );

  const providerAccounts = useMemo(
    () => providerAccountsQuery.data?.items ?? [],
    [providerAccountsQuery.data],
  );

  // Inizializza le scelte quando arrivano i conti dalla banca.
  useEffect(() => {
    if (providerAccounts.length === 0 || !institution) return;
    setChoices((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, Choice> = {};
      for (const a of providerAccounts) {
        next[a.uid] = { mode: 'none', newName: suggestedName(a, institution.name) };
      }
      return next;
    });
  }, [providerAccounts, institution]);

  const createLinks = useMutation({
    mutationFn: async () => {
      const results: LinkOutcome[] = [];
      for (const a of providerAccounts) {
        const choice = choices[a.uid];
        if (!choice || choice.mode === 'none' || a.alreadyLinked) continue;
        try {
          const r = await bankSyncApi.createLink({
            connectionId: connectionId as string,
            providerAccountId: a.uid,
            ...(choice.mode === 'existing'
              ? { accountId: choice.accountId }
              : { newAccount: { name: choice.newName.trim() } }),
          });
          results.push({
            uid: a.uid,
            label: accountLabel(a),
            ok: true,
            message: `collegato a "${r.link.accountName}"`,
          });
        } catch (e) {
          results.push({ uid: a.uid, label: accountLabel(a), ok: false, message: (e as Error).message });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      setOutcomes(results);
      setStep('summary');
      void queryClient.invalidateQueries({ queryKey: ['bank-connections'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['accounts'], refetchType: 'all' });
    },
  });

  const filteredInstitutions = useMemo(() => {
    const items = institutionsQuery.data?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [institutionsQuery.data, query]);

  const selectableCount = providerAccounts.filter(
    (a) => !a.alreadyLinked && choices[a.uid] && choices[a.uid].mode !== 'none',
  ).length;

  const invalidChoice = providerAccounts.some((a) => {
    const c = choices[a.uid];
    if (!c || a.alreadyLinked) return false;
    if (c.mode === 'existing') return !c.accountId;
    if (c.mode === 'new') return c.newName.trim().length === 0;
    return false;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Collega una banca</DialogTitle>
          <DialogDescription>
            {step === 'institution' && 'Scegli la banca a cui vuoi collegarti.'}
            {step === 'authorize' && 'Autorizza l’accesso in sola lettura sul sito della banca.'}
            {step === 'map' && 'Abbina i conti della banca ai conti di Finance Manager.'}
            {step === 'summary' && 'Riepilogo del collegamento.'}
          </DialogDescription>
        </DialogHeader>

        {/* ---------- Step 1: scelta istituto ---------- */}
        {step === 'institution' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca la tua banca…"
                className="pl-9"
                autoComplete="off"
              />
            </div>

            {institutionsQuery.isLoading && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Caricamento delle banche…
              </p>
            )}

            {institutionsQuery.isError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
                <p className="font-medium text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> Impossibile caricare la lista delle banche
                </p>
                <p className="text-muted-foreground">
                  Chiedi all’amministratore di configurare le credenziali Enable Banking nelle
                  impostazioni.
                </p>
                <p className="text-xs text-muted-foreground">
                  Dettaglio: {(institutionsQuery.error as Error).message}
                </p>
              </div>
            )}

            {institutionsQuery.isSuccess && filteredInstitutions.length === 0 && (
              <p className="text-sm text-muted-foreground">Nessuna banca trovata.</p>
            )}

            {countryScope === 'ALL' && institutionsQuery.isSuccess && (
              <p className="text-xs text-muted-foreground">
                Nessuna banca italiana disponibile con le credenziali attuali (app sandbox?):
                mostro tutte le banche visibili all’app, incluse quelle di test.
              </p>
            )}

            <ul className="space-y-2">
              {filteredInstitutions.map((inst) => (
                <li key={`${inst.name}-${inst.country}`}>
                  <button
                    type="button"
                    disabled={createConnection.isPending}
                    onClick={() => {
                      setInstitution(inst);
                      createConnection.mutate(inst);
                    }}
                    className="flex w-full items-center gap-3 rounded-md border p-3 text-left transition hover:bg-accent disabled:opacity-50"
                  >
                    <InstitutionLogo logo={inst.logo} name={inst.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {inst.name}
                        {countryScope === 'ALL' && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            · {inst.country}
                          </span>
                        )}
                      </span>
                      {inst.maximumConsentValidity != null && (
                        <span className="block text-xs text-muted-foreground">
                          Consenso valido fino a {consentValidityDays(inst.maximumConsentValidity)}{' '}
                          giorni
                        </span>
                      )}
                    </span>
                    {createConnection.isPending && institution?.name === inst.name && (
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {createConnection.isError && (
              <p className="text-sm text-destructive flex items-start gap-1">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {(createConnection.error as Error).message}
              </p>
            )}
          </div>
        )}

        {/* ---------- Step 2: autorizzazione ---------- */}
        {step === 'authorize' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border p-3">
              <InstitutionLogo logo={institution?.logo ?? null} name={institution?.name ?? ''} />
              <span className="text-sm font-medium">{institution?.name}</span>
            </div>

            <p className="text-sm text-muted-foreground">
              Si aprirà il sito della banca in una nuova scheda del browser: accedi e conferma
              l’accesso <strong>in sola lettura</strong> ai tuoi conti. Al termine vedrai una
              pagina di conferma: torna qui, questa finestra si aggiorna da sola.
            </p>

            <Button
              type="button"
              className="w-full"
              onClick={() => {
                if (authUrl) window.open(authUrl, '_blank', 'noopener,noreferrer');
              }}
              disabled={!authUrl}
            >
              <ExternalLink className="h-4 w-4 mr-2" /> Apri il sito della banca
            </Button>

            {(!connectionStatus || connectionStatus === 'pending') && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> In attesa dell’autorizzazione…
              </p>
            )}

            {connectionStatus && connectionStatus !== 'pending' && connectionStatus !== 'linked' && (
              <div className="space-y-2">
                <p className="text-sm text-destructive flex items-start gap-1">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  Autorizzazione non riuscita ({statusLabel(connectionStatus)}). Puoi riprovare
                  dall’inizio.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setConnectionId(null);
                    setAuthUrl(null);
                    setInstitution(null);
                    setStep('institution');
                  }}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" /> Riprova
                </Button>
              </div>
            )}

            {connectionQuery.isError && (
              <p className="text-sm text-destructive flex items-start gap-1">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {(connectionQuery.error as Error).message}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Puoi chiudere questa finestra: il collegamento resta in sospeso e lo ritrovi
              nell’elenco dei collegamenti bancari.
            </p>
          </div>
        )}

        {/* ---------- Step 3: mapping conti ---------- */}
        {step === 'map' && (
          <div className="space-y-4">
            {providerAccountsQuery.isLoading && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Lettura dei conti dalla banca…
              </p>
            )}

            {providerAccountsQuery.isError && (
              <p className="text-sm text-destructive flex items-start gap-1">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {(providerAccountsQuery.error as Error).message}
              </p>
            )}

            {providerAccountsQuery.isSuccess && providerAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                La banca non ha restituito nessun conto per questo consenso.
              </p>
            )}

            <ul className="space-y-3">
              {providerAccounts.map((a) => {
                const choice = choices[a.uid] ?? { mode: 'none' as const, newName: '' };
                const compatible = eligibleAccounts.filter(
                  (acc) => !a.currency || acc.currency === a.currency,
                );
                const value =
                  choice.mode === 'new'
                    ? NEW_VALUE
                    : choice.mode === 'existing' && choice.accountId
                      ? choice.accountId
                      : NONE_VALUE;
                return (
                  <li key={a.uid} className="rounded-md border p-3 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{accountLabel(a)}</p>
                        {a.iban && (
                          <p className="text-xs text-muted-foreground font-mono break-all">
                            {a.iban}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {a.currency && (
                          <Badge variant="outline" className="font-normal">{a.currency}</Badge>
                        )}
                        {a.alreadyLinked && <Badge variant="success">Già collegato</Badge>}
                      </div>
                    </div>

                    {!a.alreadyLinked && (
                      <div className="space-y-2">
                        <Label className="text-xs">Conto di Finance Manager</Label>
                        <Select
                          value={value}
                          onValueChange={(v) =>
                            setChoices((prev) => {
                              const cur = prev[a.uid] ?? {
                                mode: 'none' as const,
                                newName: institution ? suggestedName(a, institution.name) : '',
                              };
                              if (v === NONE_VALUE) return { ...prev, [a.uid]: { ...cur, mode: 'none' } };
                              if (v === NEW_VALUE) return { ...prev, [a.uid]: { ...cur, mode: 'new' } };
                              return { ...prev, [a.uid]: { ...cur, mode: 'existing', accountId: v } };
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_VALUE}>Non collegare</SelectItem>
                            <SelectItem value={NEW_VALUE}>Crea un nuovo conto</SelectItem>
                            {compatible.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id}>
                                {acc.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {compatible.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Nessun conto corrente disponibile con questa valuta: crea un nuovo
                            conto.
                          </p>
                        )}

                        {choice.mode === 'new' && (
                          <div className="space-y-1">
                            <Label className="text-xs" htmlFor={`new-name-${a.uid}`}>
                              Nome del nuovo conto
                            </Label>
                            <Input
                              id={`new-name-${a.uid}`}
                              maxLength={100}
                              value={choice.newName}
                              onChange={(e) =>
                                setChoices((prev) => ({
                                  ...prev,
                                  [a.uid]: { ...choice, newName: e.target.value },
                                }))
                              }
                            />
                            <p className="text-xs text-muted-foreground">
                              Verrà creato un conto corrente in EUR.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {createLinks.isError && (
              <p className="text-sm text-destructive flex items-start gap-1">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {(createLinks.error as Error).message}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Più tardi
              </Button>
              <Button
                type="button"
                disabled={selectableCount === 0 || invalidChoice || createLinks.isPending}
                onClick={() => createLinks.mutate()}
              >
                {createLinks.isPending ? 'Collegamento…' : `Collega ${selectableCount} conti`}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ---------- Step 4: riepilogo ---------- */}
        {step === 'summary' && (
          <div className="space-y-4">
            <ul className="space-y-2">
              {outcomes.map((o) => (
                <li key={o.uid} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                  {o.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium break-all">{o.label}</span>{' '}
                    <span className={o.ok ? 'text-muted-foreground' : 'text-destructive'}>
                      {o.ok ? o.message : `errore: ${o.message}`}
                    </span>
                  </span>
                </li>
              ))}
              {outcomes.length === 0 && (
                <li className="text-sm text-muted-foreground">Nessun conto collegato.</li>
              )}
            </ul>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Fine
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Enable Banking espone `maximum_consent_validity` in secondi; se il backend
 * dovesse già normalizzarlo in giorni (valore piccolo) lo mostriamo com'è.
 */
function consentValidityDays(value: number): number {
  return value >= 86_400 ? Math.round(value / 86_400) : value;
}

/** Etichetta leggibile per uno stato di connessione non "in corso" (usata anche da BankConnectionsCard per l'esito del rinnovo). */
export function statusLabel(status: string): string {
  switch (status) {
    case 'expired':
      return 'consenso scaduto';
    case 'suspended':
      return 'consenso sospeso';
    case 'revoked':
      return 'consenso revocato';
    case 'error':
      return 'errore';
    default:
      return status;
  }
}
