import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Plus, Send, Trash2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { chatApi, type ChatMessage } from './chatApi';
import { useChatStream } from './useChatStream';
import { useConfirm } from '@/components/shared/confirm';

export function ChatPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
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

  useEffect(() => {
    if (!activeId && sessionsQuery.data && sessionsQuery.data.length > 0) {
      setActiveId(sessionsQuery.data[0].id);
    }
  }, [activeId, sessionsQuery.data]);

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
    await stream.send(sessionId, text);
    stream.reset();
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
              ) : messages.length === 0 && !stream.pending ? (
                <ExamplePrompts onPick={(t) => setInput(t)} />
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageBubble key={m.id} message={m} />
                  ))}
                  {stream.isStreaming && !stream.pending && <ThinkingBubble />}
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
                  {stream.error && (
                    <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                      {stream.error}
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

/**
 * Bubble mostrato mentre attendiamo il primo token (latenza iniziale del modello,
 * o esecuzione di un tool call lato server che blocca lo stream). Tre puntini
 * animati, stesso allineamento dei messaggi assistant.
 */
function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="rounded-lg bg-secondary px-3 py-2.5 text-sm text-secondary-foreground inline-flex items-center gap-2">
        <span className="inline-flex gap-1" aria-label="Sta pensando">
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
        <span className="text-xs text-muted-foreground">sto pensando…</span>
      </div>
    </div>
  );
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
            <ReactMarkdown>{message.content}</ReactMarkdown>
            {streaming && <span className="inline-block animate-pulse">▋</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ExamplePrompts({ onPick }: { onPick: (text: string) => void }) {
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
        <Badge variant="outline">
          Locale · Ollama
        </Badge>{' '}
        I dati restano sul tuo server. Solo i tuoi conti accessibili sono visibili all'assistente.
      </p>
    </div>
  );
}
