import { useCallback, useRef, useState } from 'react';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

interface StreamChunk {
  delta: string;
  done: boolean;
}

export interface UseChatStream {
  pending: string;
  isStreaming: boolean;
  error: string | null;
  send: (sessionId: string, content: string) => Promise<void>;
  reset: () => void;
}

/**
 * Hook che gestisce l'invio di un messaggio in chat con risposta SSE token-by-token.
 * Mantiene `pending` aggiornato in tempo reale; quando lo stream finisce, il chiamante
 * fa refetch della sessione per avere il messaggio salvato canonico.
 */
export function useChatStream(): UseChatStream {
  const [pending, setPending] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setPending('');
    setError(null);
  }, []);

  const send = useCallback(async (sessionId: string, content: string) => {
    setPending('');
    setError(null);
    setIsStreaming(true);
    const controller = new AbortController();
    controllerRef.current = controller;

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
        buffer += decoder.decode(value, { stream: true });

        // SSE: blocchi separati da \n\n
        let sepIdx = buffer.indexOf('\n\n');
        while (sepIdx !== -1) {
          const block = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data: ')) {
              const json = line.slice(6).trim();
              if (json) {
                try {
                  const chunk = JSON.parse(json) as StreamChunk;
                  if (chunk.delta) setPending((p) => p + chunk.delta);
                  if (chunk.done) break;
                } catch {
                  // ignore
                }
              }
            } else if (line.startsWith('event: error')) {
              const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
              if (dataLine) {
                try {
                  const err = JSON.parse(dataLine.slice(6)) as { message: string };
                  setError(err.message);
                } catch {
                  setError('Errore sconosciuto');
                }
              }
            }
          }
          sepIdx = buffer.indexOf('\n\n');
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message);
      }
    } finally {
      setIsStreaming(false);
      controllerRef.current = null;
    }
  }, []);

  return { pending, isStreaming, error, send, reset };
}
