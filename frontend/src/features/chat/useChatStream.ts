import { useCallback, useRef, useState } from 'react';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

interface StreamChunk {
  delta: string;
  done: boolean;
  /** Stato di lavoro segnalato dal backend durante l'attesa. */
  status?: 'thinking' | 'tool' | 'fallback';
  /** Nome del tool in esecuzione quando `status === 'tool'`. */
  tool?: string;
  /** Modello locale subentrato quando `status === 'fallback'`. */
  model?: string;
}

/** Cosa sta facendo il backend mentre la risposta non è ancora testo. */
export type ChatWorking =
  | { phase: 'thinking' }
  | { phase: 'tool'; tool: string };

export interface UseChatStream {
  /** Testo della risposta accumulato finora (vuoto finché non arriva il primo token). */
  pending: string;
  isStreaming: boolean;
  error: string | null;
  /** Stato di lavoro: `null` quando stiamo mostrando testo o non stiamo streaming. */
  working: ChatWorking | null;
  /**
   * Modello locale che ha risposto al posto del cloud, quando è scattata la
   * riserva. Vive solo per la risposta in corso: non è persistito, quindi
   * ricaricando la conversazione la nota sparisce.
   */
  fallbackModel: string | null;
  send: (sessionId: string, content: string) => Promise<void>;
  /**
   * Scarta il testo in streaming (il messaggio salvato arriva dal refetch) SENZA
   * toccare `error`: va chiamata a stream finito. Se azzerasse anche l'errore,
   * questo verrebbe cancellato nello stesso istante in cui è stato impostato e
   * la chat resterebbe muta — è il bug che rendeva invisibili i fallimenti.
   */
  clearPending: () => void;
  /** Azzera tutto, errore compreso: cambio conversazione. */
  reset: () => void;
}

/**
 * Se il server non manda NESSUNA riga per questo intervallo, la richiesta viene
 * interrotta lato client (backstop del watchdog server-side da 120s).
 */
const CLIENT_IDLE_TIMEOUT_MS = 130_000;

/**
 * Hook che gestisce l'invio di un messaggio in chat con risposta SSE token-by-token.
 * Mantiene `pending` aggiornato in tempo reale; quando lo stream finisce, il chiamante
 * fa refetch della sessione per avere il messaggio salvato canonico.
 *
 * Espone anche `working`: mentre non c'è testo ma il backend sta lavorando
 * (attesa del primo token, esecuzione di un tool call) la UI può mostrare
 * "sto pensando… / sto consultando le tue transazioni…" con un cronometro,
 * invece di sembrare ferma.
 */
export function useChatStream(): UseChatStream {
  const [pending, setPending] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<ChatWorking | null>(null);
  const [fallbackModel, setFallbackModel] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearPending = useCallback(() => {
    clearIdleTimer();
    setPending('');
    setWorking(null);
  }, [clearIdleTimer]);

  const reset = useCallback(() => {
    clearIdleTimer();
    setPending('');
    setError(null);
    setWorking(null);
    setFallbackModel(null);
  }, [clearIdleTimer]);

  const send = useCallback(
    async (sessionId: string, content: string) => {
      setPending('');
      setError(null);
      setWorking({ phase: 'thinking' });
      setFallbackModel(null);
      setIsStreaming(true);
      const controller = new AbortController();
      controllerRef.current = controller;

      // Watchdog client: se non arriva NESSUN dato per troppo tempo abortiamo
      // con un errore parlante invece di restare appesi per sempre.
      let lastEventAt = Date.now();
      idleTimerRef.current = setInterval(() => {
        if (Date.now() - lastEventAt > CLIENT_IDLE_TIMEOUT_MS) {
          controller.abort();
        }
      }, 5000);

      try {
        const response = await fetch(`${BASE}/chat/sessions/${sessionId}/messages`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lastEventAt = Date.now();
          buffer += decoder.decode(value, { stream: true });

          // SSE: blocchi separati da \n\n
          let sepIdx = buffer.indexOf('\n\n');
          while (sepIdx !== -1) {
            const block = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            let gotErrorEvent = false;
            for (const line of block.split('\n')) {
              if (line.startsWith('data: ')) {
                const json = line.slice(6).trim();
                if (json) {
                  try {
                    const chunk = JSON.parse(json) as StreamChunk;
                    if (chunk.status === 'tool' && chunk.tool) {
                      setWorking({ phase: 'tool', tool: chunk.tool });
                    } else if (chunk.status === 'thinking') {
                      setWorking({ phase: 'thinking' });
                    } else if (chunk.status === 'fallback') {
                      // Il cloud ha fallito prima di produrre testo: risponde il
                      // modello locale. Torniamo in "sto pensando" perché il
                      // round riparte da capo.
                      setFallbackModel(chunk.model ?? 'modello locale');
                      setWorking({ phase: 'thinking' });
                    }
                    if (chunk.delta) {
                      setWorking(null);
                      setPending((p) => p + chunk.delta);
                    }
                    if (chunk.done) break;
                  } catch {
                    // ignore
                  }
                }
              } else if (line.startsWith('event: error')) {
                gotErrorEvent = true;
                const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
                if (dataLine) {
                  try {
                    const err = JSON.parse(dataLine.slice(6)) as { message: string };
                    setError(err.message);
                  } catch {
                    setError('Errore sconosciuto durante la risposta.');
                  }
                }
              }
            }
            if (gotErrorEvent) {
              setWorking(null);
              throw new Error('server-error');
            }
            sepIdx = buffer.indexOf('\n\n');
          }
        }
      } catch (e) {
        const err = e as Error;
        if (err.name === 'AbortError') {
          setWorking(null);
          setError(
            'Il server non ha risposto in tempo (nessun dato per oltre 2 minuti). Il modello potrebbe essere sovraccarico: riprova tra poco.',
          );
        } else if (err.message !== 'server-error') {
          setError(
            `Impossibile contattare il server (${err.message}). Controlla che il modello AI sia configurato e raggiungibile.`,
          );
        }
      } finally {
        clearIdleTimer();
        setIsStreaming(false);
        setWorking(null);
        controllerRef.current = null;
      }
    },
    [clearIdleTimer],
  );

  return { pending, isStreaming, error, working, fallbackModel, send, clearPending, reset };
}