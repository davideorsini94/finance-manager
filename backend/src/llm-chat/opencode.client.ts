import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Client per l'API di OpenCode (Zen/Go): endpoint `chat/completions`
 * OpenAI-compatible e `models`. Un solo formato di richiesta serve per tutti
 * i modelli (GPT, Claude, Gemini, DeepSeek, …): il gateway li instrada.
 *
 * - Streaming via SSE (`stream: true`) per la chat, con supporto tool-calling.
 * - Non-stream (JSON mode) per la categorizzazione delle transazioni.
 * - `GET /models` (pubblico, senza chiave) per l'elenco dei modelli della tier.
 * - `probeTier()` auto-rileva la tier della API key (Zen o Go) provandola sui
 *   due endpoint con una micro-chiamata.
 */

export type OpencodeTier = 'zen' | 'go';

export interface OpenAiToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Delta incrementale di un tool call in streaming (OpenAI spezza arguments su più chunk). */
export interface OpenAiToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

/** Chunk normalizzato prodotto dal parse dello stream SSE. */
export interface OpenAiStreamChunk {
  content?: string;
  /** Token di ragionamento (modelli reasoning): segnala attività, non testo di risposta. */
  thinking?: string;
  toolCalls?: OpenAiToolCallDelta[];
}

export interface OpenAiChatBody {
  model: string;
  messages: OpenAiMessage[];
  tools?: OpenAiToolDef[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
  stream?: boolean;
}

const DEFAULT_ZEN_URL = 'https://opencode.ai/zen/v1';
const DEFAULT_GO_URL = 'https://opencode.ai/zen/go/v1';

/** Modello presente su entrambe le tier: usato come probe per la chiave. */
const PROBE_MODEL = 'deepseek-v4-flash';

/**
 * Se lo stream non produce NESSUNA riga per questo intervallo, viene
 * abortito: un modello reasoning che non emette token, o una connessione
 * rimasta appesa dal gateway, non devono bloccare la chat per sempre.
 */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

/**
 * Se per questo intervallo lo stream produce solo "ragionamento" o delta vuoti
 * senza MAI arrivare a contenuto o tool call, viene abortito. Copre il caso
 * (frequente con i modelli reasoning tramite il gateway) in cui i bytes
 * continuano ad arrivare — quindi l'idle timeout sopra non scatta — ma non
 * esce nessuna risposta.
 */
const STREAM_NO_OUTPUT_TIMEOUT_MS = 120_000;

/** Tetto assoluto di durata per una singola chiamata in streaming. */
const STREAM_TOTAL_TIMEOUT_MS = 480_000;

@Injectable()
export class OpencodeClient {
  private readonly logger = new Logger(OpencodeClient.name);
  private readonly zenUrl: string;
  private readonly goUrl: string;

  constructor(config: ConfigService) {
    this.zenUrl = config.get<string>('OPENCODE_ZEN_URL')?.trim() || DEFAULT_ZEN_URL;
    this.goUrl = config.get<string>('OPENCODE_GO_URL')?.trim() || DEFAULT_GO_URL;
  }

  baseUrlFor(tier: OpencodeTier): string {
    return tier === 'zen' ? this.zenUrl : this.goUrl;
  }

  /**
   * Auto-rileva la tier della chiave. Ordine: Zen poi Go (una chiave Go non
   * dovrebbe valere su Zen). Se `preferred` è dato, lo si prova per primo e lo
   * si usa se valido. Ritorna `null` se nessun endpoint accetta la chiave.
   */
  async probeTier(apiKey: string, preferred?: OpencodeTier): Promise<OpencodeTier | null> {
    const candidates: OpencodeTier[] = preferred
      ? [preferred, ...(['zen', 'go'] as OpencodeTier[]).filter((t) => t !== preferred)]
      : ['zen', 'go'];

    for (const tier of candidates) {
      if (await this.tierAcceptsKey(tier, apiKey)) return tier;
    }
    return null;
  }

  private async tierAcceptsKey(tier: OpencodeTier, apiKey: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrlFor(tier)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: PROBE_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Elenco dei model ID disponibili sulla tier (endpoint pubblico, senza chiave). */
  async listModels(tier: OpencodeTier): Promise<string[]> {
    const res = await fetch(`${this.baseUrlFor(tier)}/models`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Impossibile elencare i modelli OpenCode (HTTP ${res.status}).`,
      );
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
  }

  /** Chat completions in streaming (SSE) con supporto tool-calling. */
  async *streamChat(
    tier: OpencodeTier,
    apiKey: string,
    body: Omit<OpenAiChatBody, 'stream'>,
  ): AsyncGenerator<OpenAiStreamChunk> {
    // Due watchdog:
    // 1. Connessione: il timeout copre solo l'apertura (i primi header), così
    //    una risposta lunga non viene troncata.
    // 2. Idle: se l'endpoint non invia NESSUNA riga per troppo tempo (es. un
    //    modello reasoning che non produce output, o una connessione lasciata
    //    appesa dal gateway) si abortisce con un errore riconoscibile invece
    //    di restare bloccati per sempre — è il caso che ha "fregato" la chat.
    const abort = new AbortController();
    const connectTimer = setTimeout(() => abort.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrlFor(tier)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: abort.signal,
      });
    } catch {
      if (abort.signal.aborted) {
        throw new ServiceUnavailableException(
          'OpenCode non risponde (connessione in timeout): riprova tra qualche secondo.',
        );
      }
      throw new ServiceUnavailableException('OpenCode non raggiungibile.');
    } finally {
      clearTimeout(connectTimer);
    }

    if (!res.ok) {
      throw new ServiceUnavailableException(
        `OpenCode non raggiungibile (HTTP ${res.status}): ${await readErrorBody(res)}`,
      );
    }
    if (!res.body) {
      throw new ServiceUnavailableException('OpenCode non ha restituito uno stream.');
    }

    let lastDataAt = Date.now();
    let lastOutputAt = Date.now();
    const startedAt = Date.now();
    const watchdog = setInterval(() => {
      const now = Date.now();
      if (now - lastDataAt > STREAM_IDLE_TIMEOUT_MS) {
        abort.abort();
      } else if (now - lastOutputAt > STREAM_NO_OUTPUT_TIMEOUT_MS) {
        abort.abort();
      } else if (now - startedAt > STREAM_TOTAL_TIMEOUT_MS) {
        abort.abort();
      }
    }, 5_000);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawSse = false;

    try {
      while (true) {
        let value: Uint8Array | undefined;
        let done: boolean;
        try {
          ({ done, value } = await reader.read());
        } catch {
          if (abort.signal.aborted) {
            const sinceStart = Date.now() - startedAt;
            throw new ServiceUnavailableException(
              `OpenCode non ha risposto in tempo (${Math.round(sinceStart / 1000)}s senza una risposta): riprova.`,
            );
          }
          throw new ServiceUnavailableException('Connessione a OpenCode interrotta.');
        }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        lastDataAt = Date.now();

        let sepIdx = buffer.indexOf('\n\n');
        while (sepIdx !== -1) {
          const block = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            sawSse = true;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') return;
            if (!payload) continue;
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{
                  delta?: {
                    content?: string | null;
                    reasoning_content?: string | null;
                    tool_calls?: Array<OpenAiToolCallDelta & { function?: { name?: string; arguments?: string } }>;
                  };
                }>;
                error?: { message?: string };
              };
              if (parsed.error?.message) {
                throw new Error(parsed.error.message);
              }
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;
              // reasoning_content: i modelli reasoning "pensano" prima di
              // rispondere. Viene inoltrato come segnale di attività (la UI
              // mostra "sto ragionando…") e fa avanzare l'orologio di output.
              if (delta.reasoning_content) {
                lastOutputAt = Date.now();
                yield { thinking: delta.reasoning_content };
              }
              if (delta.content) {
                lastOutputAt = Date.now();
                yield { content: delta.content };
              }
              if (delta.tool_calls?.length) {
                lastOutputAt = Date.now();
                yield { toolCalls: delta.tool_calls };
              }
            } catch (e) {
              throw new ServiceUnavailableException(
                `Risposta OpenCode non valida: ${(e as Error).message}`,
              );
            }
          }
          sepIdx = buffer.indexOf('\n\n');
        }
      }

      // Fallback "non-SSE": alcuni modelli reasoning tramite il gateway possono
      // rispondere con un singolo JSON (niente `data:`), con la connessione che
      // si chiude subito. In quel caso il buffer contiene la risposta completa:
      // la si parsa come chat.completions non-stream invece di restituire nulla.
      if (!sawSse && buffer.trim()) {
        const parsed = JSON.parse(buffer) as {
          choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }>;
          error?: { message?: string };
        };
        if (parsed.error?.message) throw new Error(parsed.error.message);
        const message = parsed.choices?.[0]?.message;
        if (message?.content) yield { content: message.content };
        if (message?.tool_calls?.length) {
          yield {
            toolCalls: message.tool_calls.map((tc, i) => ({
              index: i,
              id: tc.id,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          };
        }
      }
    } finally {
      clearInterval(watchdog);
    }
  }

  /** Chat completions non in streaming (es. categorizzazione JSON). */
  async chat(
    tier: OpencodeTier,
    apiKey: string,
    body: Omit<OpenAiChatBody, 'stream'>,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrlFor(tier)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...body, stream: false }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      throw new ServiceUnavailableException(
        `OpenCode non raggiungibile (HTTP ${res.status}): ${await readErrorBody(res)}`,
      );
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };
    if (json.error?.message) throw new ServiceUnavailableException(json.error.message);
    return json.choices?.[0]?.message?.content ?? '';
  }
}

/** Legge il body di errore senza andare in crash se non è JSON. */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: string } };
      return json.error?.message ?? text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return 'body illeggibile';
  }
}