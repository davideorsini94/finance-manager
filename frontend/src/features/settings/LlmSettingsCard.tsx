import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cpu,
  Server,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Download,
  HardDrive,
  Cloud,
  KeyRound,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/shared/PasswordInput';
import { useConfirm } from '@/components/shared/confirm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { llmApi, type CatalogItem, type LlmProvider, type OpencodeModelEntry, type OpencodeTier } from './llmApi';

/** Formatta i byte del modello in GB/MB per la lista "installati". */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Prezzo USD per 1M token in formato italiano (es. "$1,32"). */
function formatUsd(value: number | null): string {
  if (value === null || value === undefined) return '—';
  const s = value.toFixed(2).replace('.', ',');
  return `$${s}`;
}

/**
 * Il contratto espone solo `overLimit` (oltre gli 8 GB del container). Per la
 * voce "quasi al limite" (es. gemma2:9b, overLimit=false ma RAM alta) deriviamo
 * un avviso più tenue parsando il numero in `ramRequired` — non c'è un campo
 * dedicato lato API per questo caso intermedio.
 */
function ramWarningLevel(item: CatalogItem): 'over' | 'high' | null {
  if (item.overLimit) return 'over';
  const match = item.ramRequired.match(/(\d+(?:[.,]\d+)?)/);
  if (match && parseFloat(match[1].replace(',', '.')) >= 7) return 'high';
  return null;
}

function qualityBadgeVariant(quality: string | null): 'success' | 'outline' | 'secondary' {
  if (!quality) return 'outline';
  if (quality === 'eccellente') return 'success';
  return 'outline';
}

function qualityLabel(quality: string | null): string {
  if (!quality) return 'qualità n.d.';
  return `qualità ${quality}`;
}

export function LlmSettingsCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [pullResult, setPullResult] = useState<{ ok: boolean; model: string; message: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [opencodeKey, setOpencodeKey] = useState('');
  const [opencodeTierOverride, setOpencodeTierOverride] = useState<'auto' | OpencodeTier>('auto');
  const [opencodeKeyError, setOpencodeKeyError] = useState<string | null>(null);
  const [opencodeTestResult, setOpencodeTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const wasActiveRef = useRef(false);

  const settingsQuery = useQuery({
    queryKey: ['llm-settings'],
    queryFn: () => llmApi.get(),
  });

  const catalogQuery = useQuery({
    queryKey: ['llm-catalog'],
    queryFn: () => llmApi.catalog(),
    staleTime: Infinity, // catalogo statico lato backend
  });

  const pullStatusQuery = useQuery({
    queryKey: ['llm-pull-status'],
    queryFn: () => llmApi.pullStatus(),
    refetchInterval: (query) => (query.state.data?.active ? 1500 : false),
  });

  const settings = settingsQuery.data;
  const provider: LlmProvider = settings?.provider ?? 'ollama';
  const opencodeConfigured = !!settings?.opencode.configured;
  const opencodeTier = settings?.opencode.tier ?? undefined;

  const opencodeModelsQuery = useQuery({
    queryKey: ['llm-opencode-models', opencodeTier],
    queryFn: () => llmApi.opencodeModels(opencodeTier),
    enabled: opencodeConfigured && !!opencodeTier,
    staleTime: 5 * 60_000,
  });

  // Quando il pull passa da attivo a non-attivo: mostra l'esito e aggiorna
  // la lista installati (il download è terminato con successo o errore).
  useEffect(() => {
    const data = pullStatusQuery.data;
    if (!data) return;
    if (wasActiveRef.current && !data.active) {
      void queryClient.invalidateQueries({ queryKey: ['llm-settings'], refetchType: 'all' });
      setPullResult(
        data.error
          ? { ok: false, model: data.model ?? '', message: data.error }
          : { ok: true, model: data.model ?? '', message: 'Download completato.' },
      );
    }
    wasActiveRef.current = data.active;
  }, [pullStatusQuery.data, queryClient]);

  const selectMutation = useMutation({
    mutationFn: (model: string) => llmApi.select(model),
    onMutate: () => setSelectError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['llm-settings'], refetchType: 'all' });
    },
    onError: (e) => setSelectError((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => llmApi.remove(name),
    onMutate: () => setDeleteError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['llm-settings'], refetchType: 'all' });
    },
    onError: (e) => setDeleteError((e as Error).message),
  });

  const pullMutation = useMutation({
    mutationFn: (model: string) => llmApi.pull(model),
    onMutate: () => setPullResult(null),
    onSuccess: () => {
      // Il job è detached lato server: avviamo subito il polling dello stato.
      void queryClient.invalidateQueries({ queryKey: ['llm-pull-status'], refetchType: 'all' });
    },
    onError: (e, model) => {
      setPullResult({ ok: false, model, message: (e as Error).message });
      void queryClient.invalidateQueries({ queryKey: ['llm-pull-status'], refetchType: 'all' });
    },
  });

  // ---------- OpenCode ----------
  const providerMutation = useMutation({
    mutationFn: (p: LlmProvider) => llmApi.setProvider(p),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['llm-settings'], refetchType: 'all' });
    },
  });

  const saveOpencodeKeyMutation = useMutation({
    mutationFn: ({ apiKey, tier }: { apiKey: string; tier?: OpencodeTier }) =>
      llmApi.saveOpencodeKey(apiKey, tier),
    onMutate: () => {
      setOpencodeKeyError(null);
      setOpencodeTestResult(null);
    },
    onSuccess: () => {
      setOpencodeKey('');
      setOpencodeTierOverride('auto');
      void queryClient.invalidateQueries({ queryKey: ['llm-settings'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['llm-opencode-models'], refetchType: 'all' });
    },
    onError: (e) => setOpencodeKeyError((e as Error).message),
  });

  const removeOpencodeKeyMutation = useMutation({
    mutationFn: () => llmApi.removeOpencodeKey(),
    onMutate: () => setOpencodeKeyError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['llm-settings'], refetchType: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['llm-opencode-models'], refetchType: 'all' });
    },
    onError: (e) => setOpencodeKeyError((e as Error).message),
  });

  const selectOpencodeMutation = useMutation({
    mutationFn: (model: string) => llmApi.selectOpencodeModel(model),
    onMutate: () => setSelectError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['llm-settings'], refetchType: 'all' });
    },
    onError: (e) => setSelectError((e as Error).message),
  });

  const testOpencodeMutation = useMutation({
    mutationFn: () => llmApi.testOpencode(),
    onMutate: () => setOpencodeTestResult(null),
    onSuccess: (r) => {
      setOpencodeTestResult(
        r.ok
          ? { ok: true, message: `Connessione OK — tier ${r.tier ?? '?'}.` }
          : { ok: false, message: r.error ?? 'Connessione fallita.' },
      );
    },
    onError: (e) => setOpencodeTestResult({ ok: false, message: (e as Error).message }),
  });

  const installed = settings?.installed ?? [];
  const catalog = catalogQuery.data?.items ?? [];
  const pullStatus = pullStatusQuery.data;
  const pullActive = !!pullStatus?.active;
  const anyPullBusy = pullMutation.isPending || pullActive;
  const installedTags = new Set(installed.map((m) => m.name));

  return (
    <CollapsibleCard
      title={
        <>
          <Cpu className="h-4 w-4" />
          Modello AI
          {provider === 'ollama' &&
            settings &&
            (settings.serverOk ? (
              <Badge variant="success" className="ml-1">Ollama raggiungibile</Badge>
            ) : (
              <Badge variant="destructive" className="ml-1">Ollama non raggiungibile</Badge>
            ))}
          {provider === 'opencode' && settings?.opencode.configured && (
            <Badge variant="success" className="ml-1">
              OpenCode {settings.opencode.tier === 'go' ? 'Go' : 'Zen'} connesso
            </Badge>
          )}
        </>
      }
      description="Modello usato per la chat AI e la categorizzazione automatica delle transazioni. Due provider: Ollama (locale, container dedicato) o OpenCode (cloud, con la tua API key: i modelli mostrati dipendono dalla tipologia di chiave). Modifiche riservate agli amministratori."
      storageKey="fm-cfg-llm"
    >
      <div className="space-y-6">
        {/* Selettore provider */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Provider:</span>
          <Button
            type="button"
            size="sm"
            variant={provider === 'ollama' ? 'default' : 'outline'}
            disabled={providerMutation.isPending}
            onClick={() => providerMutation.mutate('ollama')}
          >
            <Cpu className="h-4 w-4 mr-1.5" />
            Ollama (locale)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={provider === 'opencode' ? 'default' : 'outline'}
            disabled={providerMutation.isPending}
            onClick={() => providerMutation.mutate('opencode')}
          >
            <Cloud className="h-4 w-4 mr-1.5" />
            OpenCode (cloud)
          </Button>
        </div>

        {/* Modello attivo */}
        <div className="rounded-md border p-3 flex flex-wrap items-center gap-2 text-sm">
          <Server className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Modello attivo:</span>
          <span className="font-mono font-medium break-all">
            {settings?.activeModel || '—'}
          </span>
          {settings?.source === 'env' && (
            <Badge variant="outline" className="font-normal">da variabile ambiente</Badge>
          )}
        </div>

        {selectError && (
          <p className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle className="h-4 w-4 shrink-0" /> {selectError}
          </p>
        )}

        {provider === 'ollama' ? (
          <>
            {/* Modelli installati */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Modelli installati (Ollama)</h4>
              {settingsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Caricamento…</p>
              ) : installed.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nessun modello installato.</p>
              ) : (
                <ul className="space-y-2">
                  {installed.map((m) => {
                    const isActive = m.name === settings?.activeModel;
                    return (
                      <li
                        key={m.name}
                        className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
                      >
                        <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-mono truncate flex-1 min-w-0">{m.name}</span>
                        <Badge variant="outline" className="font-normal">{formatBytes(m.sizeBytes)}</Badge>
                        {isActive ? (
                          <Badge variant="success">Attivo</Badge>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={selectMutation.isPending}
                            onClick={() => selectMutation.mutate(m.name)}
                          >
                            Usa questo
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Elimina modello"
                          title={isActive ? 'Non puoi eliminare il modello attivo' : 'Elimina'}
                          disabled={isActive || deleteMutation.isPending}
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Eliminare il modello?',
                              description: `"${m.name}" verrà rimosso e andrà riscaricato per essere riutilizzato.`,
                              confirmLabel: 'Elimina',
                              destructive: true,
                            });
                            if (ok) deleteMutation.mutate(m.name);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {deleteError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {deleteError}
                </p>
              )}
            </div>

            {/* Progresso download in corso */}
            {pullActive && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                <p className="text-sm font-medium font-mono break-all">{pullStatus?.model}</p>
                <Progress value={pullStatus?.percent ?? 0} />
                <p className="text-xs text-muted-foreground">
                  {pullStatus?.status ?? 'Download in corso…'}
                  {typeof pullStatus?.percent === 'number' && ` — ${Math.round(pullStatus.percent)}%`}
                </p>
              </div>
            )}

            {pullResult && (
              <p
                className={`text-sm flex items-start gap-1 ${pullResult.ok ? 'text-emerald-600' : 'text-destructive'}`}
              >
                {pullResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span>
                  {pullResult.ok
                    ? `Modello "${pullResult.model}" scaricato con successo.`
                    : `Errore nel download di "${pullResult.model}": ${pullResult.message}`}
                </span>
              </p>
            )}

            {/* Catalogo */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Catalogo modelli disponibili (Ollama)</h4>
              {catalogQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Caricamento…</p>
              ) : (
                <ul className="space-y-2">
                  {catalog.map((item) => {
                    const alreadyInstalled = installedTags.has(item.tag);
                    const warning = ramWarningLevel(item);
                    const isThisDownloading = pullActive && pullStatus?.model === item.tag;
                    return (
                      <li key={item.tag} className="rounded-md border p-3 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm flex items-center gap-2 flex-wrap">
                              {item.displayName}
                              {warning === 'over' && (
                                <Badge variant="destructive" className="font-normal">
                                  <AlertTriangle className="h-3 w-3 mr-1" /> oltre il limite (8 GB)
                                </Badge>
                              )}
                              {warning === 'high' && (
                                <Badge
                                  variant="outline"
                                  className="font-normal border-amber-500/50 text-amber-700 dark:text-amber-400"
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" /> RAM elevata
                                </Badge>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono break-all">{item.tag}</p>
                          </div>
                          {alreadyInstalled ? (
                            <Badge variant="outline" className="font-normal shrink-0">Installato</Badge>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              disabled={anyPullBusy}
                              onClick={() => pullMutation.mutate(item.tag)}
                            >
                              <Download className="h-3.5 w-3.5 mr-1.5" />
                              {isThisDownloading ? 'In corso…' : 'Scarica'}
                            </Button>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>Download: {item.downloadSize}</span>
                          <span>RAM richiesta: {item.ramRequired}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            {/* API key OpenCode */}
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                <h4 className="text-sm font-medium">API key OpenCode</h4>
                {settings?.opencode.configured ? (
                  <Badge variant="success" className="font-normal">
                    Configurata ({settings.opencode.tier === 'go' ? 'Go' : 'Zen'})
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="font-normal">Non configurata</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                La chiave viene cifrata at-rest e non esce mai dalle API. Al salvataggio viene
                rilevata automaticamente la tipologia (Zen o Go) e vengono mostrati i modelli
                corrispondenti.
              </p>
              {settings?.opencode.configured && (
                <p className="text-xs text-muted-foreground font-mono">
                  Chiave salvata: {settings.opencode.apiKeyMasked}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <Label htmlFor="opencode-key">
                    {settings?.opencode.configured ? 'Nuova chiave (per sostituirla)' : 'Chiave API'}
                  </Label>
                  <PasswordInput
                    id="opencode-key"
                    value={opencodeKey}
                    onChange={(e) => setOpencodeKey(e.target.value)}
                    placeholder="sk-…"
                    stripWhitespaceOnPaste
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5 min-w-[9rem]">
                  <Label htmlFor="opencode-tier">Tipologia</Label>
                  <Select
                    value={opencodeTierOverride}
                    onValueChange={(v) => setOpencodeTierOverride(v as 'auto' | OpencodeTier)}
                  >
                    <SelectTrigger id="opencode-tier">
                      <SelectValue placeholder="Automatica" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automatica</SelectItem>
                      <SelectItem value="zen">OpenCode Zen</SelectItem>
                      <SelectItem value="go">OpenCode Go</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!opencodeKey.trim() || saveOpencodeKeyMutation.isPending}
                  onClick={() =>
                    saveOpencodeKeyMutation.mutate({
                      apiKey: opencodeKey.trim(),
                      tier: opencodeTierOverride === 'auto' ? undefined : opencodeTierOverride,
                    })
                  }
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {saveOpencodeKeyMutation.isPending ? 'Verifica…' : 'Salva e verifica'}
                </Button>
                {settings?.opencode.configured && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={testOpencodeMutation.isPending}
                      onClick={() => testOpencodeMutation.mutate()}
                    >
                      <Zap className="h-4 w-4 mr-1.5" />
                      Test connessione
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={removeOpencodeKeyMutation.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Rimuovere la chiave?',
                          description:
                            'La chiave API OpenCode verrà rimossa e il provider non sarà più utilizzabile finché non ne inserisci una nuova.',
                          confirmLabel: 'Rimuovi',
                          destructive: true,
                        });
                        if (ok) removeOpencodeKeyMutation.mutate();
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Rimuovi
                    </Button>
                  </>
                )}
              </div>
              {opencodeKeyError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {opencodeKeyError}
                </p>
              )}
              {opencodeTestResult && (
                <p
                  className={`text-sm flex items-center gap-1 ${opencodeTestResult.ok ? 'text-emerald-600' : 'text-destructive'}`}
                >
                  {opencodeTestResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0" />
                  )}
                  {opencodeTestResult.message}
                </p>
              )}
            </div>

            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <p className="text-muted-foreground">
                Con OpenCode attivo Ollama non viene usato: puoi tenerlo spento senza che chat e
                categorizzazione vadano in errore.
              </p>
            </div>

            {/* Modelli OpenCode */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">
                Modelli disponibili ({settings?.opencode.tier === 'go' ? 'OpenCode Go' : 'OpenCode Zen'})
              </h4>
              {!settings?.opencode.configured ? (
                <p className="text-sm text-muted-foreground">
                  Salva la API key per elencare i modelli della tua tipologia di chiave.
                </p>
              ) : opencodeModelsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Caricamento…</p>
              ) : opencodeModelsQuery.isError ? (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {opencodeModelsQuery.error instanceof Error
                    ? opencodeModelsQuery.error.message
                    : 'Errore nel caricamento dei modelli.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {opencodeModelsQuery.data?.map((m: OpencodeModelEntry) => {
                    const isActive = m.modelId === settings?.activeModel;
                    return (
                      <li key={m.modelId} className="rounded-md border p-3 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm flex items-center gap-2 flex-wrap">
                              {m.displayName}
                              {m.recommended && (
                                <Badge variant="success" className="font-normal">Consigliato</Badge>
                              )}
                              {m.family && (
                                <Badge variant="outline" className="font-normal">{m.family}</Badge>
                              )}
                              <Badge
                                variant={qualityBadgeVariant(m.quality)}
                                className="font-normal"
                              >
                                {qualityLabel(m.quality)}
                              </Badge>
                            </p>
                            <p className="text-xs text-muted-foreground font-mono break-all">{m.modelId}</p>
                          </div>
                          {isActive ? (
                            <Badge variant="success" className="shrink-0">Attivo</Badge>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              disabled={selectOpencodeMutation.isPending}
                              onClick={() => selectOpencodeMutation.mutate(m.modelId)}
                            >
                              Usa questo
                            </Button>
                          )}
                        </div>
                        {m.description && (
                          <p className="text-sm text-muted-foreground">{m.description}</p>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            Costo: {formatUsd(m.inputPrice)} in / {formatUsd(m.outputPrice)} out per
                            1M token
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}