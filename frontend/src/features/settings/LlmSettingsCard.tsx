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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useConfirm } from '@/components/shared/confirm';
import { llmApi, type CatalogItem } from './llmApi';

/** Formatta i byte del modello in GB/MB per la lista "installati". */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
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

export function LlmSettingsCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [pullResult, setPullResult] = useState<{ ok: boolean; model: string; message: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
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

  const settings = settingsQuery.data;
  const installed = settings?.installed ?? [];
  const catalog = catalogQuery.data?.items ?? [];
  const pullStatus = pullStatusQuery.data;
  const pullActive = !!pullStatus?.active;
  const anyPullBusy = pullMutation.isPending || pullActive;
  const installedTags = new Set(installed.map((m) => m.name));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Cpu className="h-4 w-4" />
          Modello AI locale (Ollama)
          {settings &&
            (settings.serverOk ? (
              <Badge variant="success" className="ml-1">Server raggiungibile</Badge>
            ) : (
              <Badge variant="destructive" className="ml-1">Server non raggiungibile</Badge>
            ))}
        </CardTitle>
        <CardDescription>
          Modello usato per la chat AI e la categorizzazione automatica delle transazioni.
          Gira interamente in locale (container Ollama, limite 8 GB di RAM). Download e
          selezione riservati agli amministratori.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Modello attivo */}
        <div className="rounded-md border p-3 flex flex-wrap items-center gap-2 text-sm">
          <Server className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Modello attivo:</span>
          <span className="font-mono font-medium break-all">{settings?.activeModel ?? '—'}</span>
          {settings?.source === 'env' && (
            <Badge variant="outline" className="font-normal">da variabile ambiente</Badge>
          )}
        </div>

        {selectError && (
          <p className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle className="h-4 w-4 shrink-0" /> {selectError}
          </p>
        )}

        {/* Modelli installati */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Modelli installati</h4>
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
          <h4 className="text-sm font-medium">Catalogo modelli disponibili</h4>
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
      </CardContent>
    </Card>
  );
}
