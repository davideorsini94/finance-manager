import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HTTPError } from 'ky';
import ReactMarkdown from 'react-markdown';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MARKDOWN_COMPONENTS } from '@/components/shared/markdown';
import { useConfirm } from '@/components/shared/confirm';
import { llmReportsApi, type LlmReportScope } from './reportsLlmApi';

interface Props {
  scope: LlmReportScope;
  year: number;
  /** Solo per lo scope mensile. */
  month?: number;
  accountIds: string[];
  /** Elenco ordinato: chiave di cache stabile a prescindere dall'ordine di selezione. */
  accountIdsKey: string[];
}

/** Ogni quanto ricontrollare lo stato mentre la generazione è in corso. */
const POLL_MS = 3000;

export function LlmReportCard({ scope, year, month, accountIds, accountIdsKey }: Props) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const params = { scope, year, month, accountIds: accountIds.length > 0 ? accountIds : undefined };
  const queryKey = ['report', 'llm', scope, year, month ?? null, accountIdsKey];

  const query = useQuery({
    queryKey,
    queryFn: () => llmReportsApi.get(params),
    // Polling SOLO mentre sta generando: fuori da lì la riga non cambia da sola.
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? POLL_MS : false),
    refetchOnWindowFocus: true,
  });

  const generate = useMutation({
    mutationFn: (force: boolean) => llmReportsApi.generate(params, force),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e) => {
      // 409 = un'altra scheda (o un altro dispositivo) ha già il lock: non è un
      // errore per l'utente, basta rimettersi in ascolto.
      if (e instanceof HTTPError && e.response.status === 409) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const data = query.data;
  const status = data?.status;
  const isGenerating = status === 'generating' || generate.isPending;

  // Generazione automatica alla prima apertura di un periodo senza report.
  // Il set tiene traccia di cosa abbiamo già avviato in questa sessione: senza,
  // un refetch che torna ancora `missing` la farebbe ripartire in loop.
  const autoStarted = useRef<Set<string>>(new Set());
  const autoKey = queryKey.join('|');
  useEffect(() => {
    if (status !== 'missing') return;
    if (autoStarted.current.has(autoKey)) return;
    autoStarted.current.add(autoKey);
    generate.mutate(false);
    // `generate` è stabile per React Query, non va nelle dipendenze.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, autoKey]);

  // Cronometro: il server dice da quanti secondi genera, noi aggiungiamo il
  // tempo passato dall'ultima risposta così il numero sale ogni secondo.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isGenerating) return;
    const id = window.setInterval(() => forceTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isGenerating]);
  const elapsed =
    data?.elapsedSeconds != null
      ? data.elapsedSeconds + Math.max(0, Math.round((Date.now() - query.dataUpdatedAt) / 1000))
      : 0;

  const onGenerate = async () => {
    if (isGenerating) return;
    if (data?.content) {
      const ok = await confirm({
        title: 'Rigenerare il report?',
        description: `Il report attuale${
          data.generatedAt ? ` (generato il ${formatDateTime(data.generatedAt)})` : ''
        } verrà sovrascritto e non sarà più recuperabile.`,
        confirmLabel: 'Rigenera',
        destructive: true,
      });
      if (!ok) return;
      generate.mutate(true);
      return;
    }
    generate.mutate(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Report dell'assistente
          </CardTitle>
          <CardDescription>
            {isGenerating
              ? `Sto scrivendo il report… ${formatElapsed(elapsed)}`
              : status === 'ready' && data?.generatedAt
                ? `Generato il ${formatDateTime(data.generatedAt)}${data.model ? ` · ${data.model}` : ''}`
                : 'Analisi del periodo scritta dal modello selezionato nelle impostazioni'}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating}
          className="shrink-0"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              In generazione…
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {data?.content ? 'Rigenera' : 'Genera'}
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.stale && !isGenerating && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            I movimenti del periodo sono cambiati dopo la generazione: il report potrebbe non essere
            aggiornato.
          </p>
        )}

        {isGenerating && !data?.content && <ReportSkeleton />}

        {isGenerating && data?.content && (
          <div className="opacity-40 transition-opacity">
            <MarkdownReport content={data.content} />
          </div>
        )}

        {!isGenerating && status === 'error' && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {data?.errorMessage ?? 'Generazione fallita.'}
          </p>
        )}

        {/* Il testo si mostra anche in stato `error`: un lock scaduto sopra un
            report già scritto non deve far sparire il report. */}
        {!isGenerating && data?.content && <MarkdownReport content={data.content} />}

        {!isGenerating && !data?.content && status === 'missing' && (
          <p className="text-sm text-muted-foreground">Nessun report per questo periodo.</p>
        )}
      </CardContent>
    </Card>
  );
}

function MarkdownReport({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{content}</ReactMarkdown>
    </div>
  );
}

/** Righe fantasma pulsanti: rende visibile che c'è del lavoro in corso. */
function ReportSkeleton() {
  const widths = ['w-1/3', 'w-full', 'w-11/12', 'w-4/5', 'w-1/4', 'w-full', 'w-3/4'];
  return (
    <div className="space-y-2" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className={`h-3 animate-pulse rounded bg-muted ${w}`} />
      ))}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
