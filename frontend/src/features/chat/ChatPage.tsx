import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Plus, Send, Trash2, MessageSquare, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { chatApi, type ChatMessage } from './chatApi';
import { useChatStream, type ChatWorking } from './useChatStream';
import { llmApi } from '@/features/settings/llmApi';
import { useConfirm } from '@/components/shared/confirm';
import { MARKDOWN_COMPONENTS } from '@/components/shared/markdown';

export function ChatPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ['chat', 'sessions'],
    queryFn: () => chatApi.listSessions(),
  });

  const sessionQuery = useQuery({
    queryKey: ['chat', 'session', activeId],
    queryFn: () => chatApi.getSession(activeId!),
    enabled: !!activeId,
  });

  const createSession = useMutation({
    mutationFn: () => chatApi.createSession(),
    onSuccess: (s) => {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
      setActiveId(s.id);
    },
  });

  const deleteSession = useMutation({
    mutationFn: (id: string) => chatApi.deleteSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
      setActiveId(null);
    },
  });

  const stream = useChatStream();

  const llmQuery = useQuery({
    queryKey: ['llm-settings'],
    queryFn: () => llmApi.get(),
    staleTime: 60_000,
  });
  const modelLabel = (() => {
    const s = llmQuery.data;
    if (!s?.activeModel) return null;
    return s.provider === 'opencode'
      ? `OpenCode ${s.opencode.tier === 'go' ? 'Go' : 'Zen'} · ${s.activeModel}`
      : `Ollama · ${s.activeModel}`;
  })();

  useEffect(() => {
    if (!activeId && sessionsQuery.data && sessionsQuery.data.length > 0) {
      setActiveId(sessionsQuery.data[0].id);
    }
  }, [activeId, sessionsQuery.data]);

  // Cambio conversazione: azzera anche l'errore, altrimenti quello dell'ultimo
  // invio resterebbe appeso sotto i messaggi di un'altra chat.
  useEffect(() => {
    stream.reset();
  }, [activeId, stream.reset]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessionQuery.data?.messages, stream.pending]);

  const onSend = async () => {
    if (!input.trim() || !activeId || stream.isStreaming) return;
    let sessionId = activeId;
    if (!sessionId) {
      const s = await createSession.mutateAsync();
      sessionId = s.id;
    }
    const text = input.trim();
    setInput('');
    // Mostra subito il messaggio dell'utente (il refetch della sessione con il
    // messaggio salvato arriva a stream finito): così si vede che è partito.
    setLastSent(text);
    await stream.send(sessionId, text);
    setLastSent(null);
    // Solo il testo in streaming: l'eventuale errore deve restare visibile
    // (il refetch qui sotto porta il messaggio salvato, non l'errore).
    stream.clearPending();
    void queryClient.invalidateQueries({ queryKey: ['chat', 'session', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
  };

  const messages = (sessionQuery.data?.messages ?? []).filter((m) => m.role !== 'tool');

  return (
    <div className="grid gap-4 h-[calc(100dvh-9rem)] lg:h-[calc(100dvh-7rem)] lg:grid-cols-[260px_1fr]">
      {/* Sidebar sessioni */}
      <aside
        className={cn(
          'flex flex-col gap-2 lg:relative lg:flex',
          showSidebar
            ? 'fixed inset-0 z-40 bg-background p-4 flex'
            : 'hidden',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Conversazioni</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => createSession.mutate()}
            disabled={createSession.isPending}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Nuova
          </Button>
        </div>
        <ul className="flex-1 overflow-y-auto space-y-1">
          {(sessionsQuery.data ?? []).map((s) => (
            <li key={s.id}>
              <button
                onClick={() => {
                  setActiveId(s.id);
                  setShowSidebar(false);
                }}
                className={cn(
                  'group flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-sm transition-colors text-left',
                  activeId === s.id
                    ? 'bg-secondary'
                    : 'hover:bg-accent',
                )}
              >
                <span className="truncate">{s.title ?? 'Nuova conversazione'}</span>
                <Trash2
                  className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirm({
                      title: 'Eliminare la conversazione?',
                      description: s.title ?? undefined,
                      confirmLabel: 'Elimina',
                      destructive: true,
                    });
                    if (ok) deleteSession.mutate(s.id);
                  }}
                />
              </button>
            </li>
          ))}
          {(sessionsQuery.data ?? []).length === 0 && (
            <li className="text-xs text-muted-foreground text-center py-4">
              Nessuna conversazione. Inizia chiedendo qualcosa sui tuoi conti.
            </li>
          )}
        </ul>
      </aside>

      {/* Main */}
      <div className="flex flex-col gap-3 min-h-0">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Chat finanziaria
          </h1>
          <Button
            size="sm"
            variant="outline"
            className="lg:hidden"
            onClick={() => setShowSidebar(true)}
          >
            Sessioni
          </Button>
        </div>

        <Card className="flex-1 min-h-0">
          <CardContent className="p-0 flex flex-col h-full min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {!activeId ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  Crea una nuova conversazione per iniziare.
                </p>
              ) : messages.length === 0 && !stream.pending && !stream.isStreaming ? (
                <ExamplePrompts onPick={(t) => setInput(t)} modelLabel={modelLabel} />
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageBubble key={m.id} message={m} />
                  ))}
                  {lastSent && stream.isStreaming && (
                    <MessageBubble
                      message={{
                        id: 'last-sent',
                        sessionId: activeId,
                        role: 'user',
                        content: lastSent,
                        toolName: null,
                        createdAt: new Date().toISOString(),
                      }}
                    />
                  )}
                  {stream.working && !stream.pending && <WorkingBubble working={stream.working} />}
                  {stream.pending && (
                    <MessageBubble
                      message={{
                        id: 'pending',
                        sessionId: activeId,
                        role: 'assistant',
                        content: stream.pending,
                        toolName: null,
                        createdAt: new Date().toISOString(),
                      }}
                      streaming
                    />
                  )}
                  {stream.fallbackModel && !stream.error && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      OpenCode non era disponibile: ha risposto il modello locale{' '}
                      <span className="font-medium">{stream.fallbackModel}</span>.
                    </p>
                  )}
                  {stream.error && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                      <p className="font-medium text-destructive flex items-center gap-1.5">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        Non sono riuscito a rispondere
                      </p>
                      <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{stream.error}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Puoi riprovare riscrivendo la domanda. Se l&apos;errore persiste, verifica
                        nelle Impostazioni che il modello AI sia configurato.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="border-t p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                  placeholder="Chiedi qualcosa sui tuoi conti…"
                  disabled={!activeId || stream.isStreaming}
                  className="resize-none"
                />
                <Button onClick={() => void onSend()} disabled={!input.trim() || stream.isStreaming}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Invio per inviare · Shift+Invio per nuova riga
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Etichette amichevoli per i tool del backend. */
const TOOL_LABELS: Record<string, string> = {
  list_transactions: 'sto consultando le tue transazioni…',
  period_totals: 'sto calcolando i totali del periodo…',
  category_breakdown: 'sto raggruppando le spese per categoria…',
  list_accounts: 'sto leggendo i saldi dei tuoi conti…',
  list_categories: 'sto leggendo le tue categorie…',
  budget_status: 'sto confrontando il budget…',
};

function workingLabel(working: ChatWorking): string {
  if (working.phase === 'tool') {
    return TOOL_LABELS[working.tool] ?? `sto eseguendo ${working.tool}…`;
  }
  return 'sto pensando…';
}

/**
 * Bubble mostrato mentre il backend lavora senza aver ancora prodotto testo:
 * attesa del primo token (modello reasoning lento) o esecuzione di un tool
 * call. Mostra cosa sta facendo e un cronometro, così la chat non sembra
 * "ferma" o rotta.
 */
function WorkingBubble({ working }: { working: ChatWorking }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex justify-start">
      <div className="rounded-lg bg-secondary px-3 py-2.5 text-sm text-secondary-foreground inline-flex items-center gap-2">
        {working.phase === 'tool' ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <span className="inline-flex gap-1" aria-label="Sta lavorando">
            <span
              className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </span>
        )}
        <span className="text-xs text-muted-foreground">{workingLabel(working)}</span>
        <span className="text-[11px] text-muted-foreground/70 tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      </div>
    </div>
  );
}

/** `12s` → `1m 05s`, poi `4m 30s`. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function MessageBubble({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown components={MARKDOWN_COMPONENTS}>{message.content}</ReactMarkdown>
            {streaming && <span className="inline-block animate-pulse">▋</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ExamplePrompts({
  onPick,
  modelLabel,
}: {
  onPick: (text: string) => void;
  modelLabel: string | null;
}) {
  const examples = [
    'Quanto ho speso questo mese in totale?',
    'Quali sono le mie 3 categorie con più uscite negli ultimi 30 giorni?',
    'Confronta le mie spese di questo mese con il mese scorso.',
    'Dammi 3 consigli per ridurre le spese fisse.',
  ];
  return (
    <div className="space-y-3 py-8">
      <p className="text-sm text-muted-foreground text-center">
        Prova a chiedere:
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {examples.map((e, i) => (
          <button
            key={i}
            onClick={() => onPick(e)}
            className="rounded-md border bg-card p-3 text-left text-sm hover:bg-accent transition-colors"
          >
            {e}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground text-center pt-4">
        {modelLabel && <Badge variant="outline" className="mr-1">{modelLabel}</Badge>}
        Solo i tuoi conti accessibili sono visibili all'assistente.
      </p>
    </div>
  );
}
