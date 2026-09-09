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

/**
 * Da dove viene la risposta che stiamo giudicando: `usage` è un endpoint
 * autenticato che non coinvolge alcun modello, `chat` è il ripiego su
 * `chat/completions` (quindi nella risposta si mescola la salute del modello).
 */
export type KeyCheckSource = 'usage' | 'chat';

/**
 * La risposta dimostra che la API key è autenticata? `null` = non lo dimostra
 * né lo smentisce (nessuna risposta: rete, DNS, timeout).
 *
 * La regola vale **solo sull'autenticazione**, mai sulla salute di un modello:
 * legare la validità della chiave a un modello la faceva dichiarare invalida
 * quando era perfetta (modello deprecato, a opt-in, o momentaneamente rotto).
 * Quindi `402` credito esaurito, `429` rate limit, `400` modello non
 * supportato e `500/503` del gateway **dimostrano** che la chiave è passata.
 * Il `403` è ambiguo e dipende dalla fonte: su `usage` è un rifiuto della
 * chiave, su `chat` è il modello che richiede un'adesione esplicita.
 */
export function keyIsAuthenticated(source: KeyCheckSource, status: number): boolean | null {
  if (status === 0) return null;
  if (status === 401) return false;
  if (status === 403) return source === 'chat';
  return true;
}

/** Esito del controllo di una API key su una singola tier. */
export interface TierKeyCheck {
  tier: OpencodeTier;
  /** La chiave ha superato l'autenticazione su questa tier. */
  ok: boolean;
  /** Stato HTTP osservato (`0` = nessuna risposta: rete o timeout). */
  status: number;
  detail: string;
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

/**
 * Modello usato come ripiego per validare una chiave quando la tier non
 * espone `GET /usage` (vedi `checkKeyOnTier`). Non è un requisito: un errore
 * SUO non rende invalida la chiave, conta solo se la richiesta ha passato
 * l'autenticazione.
 */
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
    return (await this.probeTierDetailed(apiKey, preferred)).tier;
  }

  /**
   * Come `probeTier`, ma conserva **cosa ha risposto ogni tier**: serve a dire
   * all'admin perché una chiave è stata rifiutata (chiave errata, credito
   * esaurito, rate limit, gateway giù) invece del nudo "non valida".
   */
  async probeTierDetailed(
    apiKey: string,
    preferred?: OpencodeTier,
  ): Promise<{ tier: OpencodeTier | null; checks: TierKeyCheck[] }> {
    const candidates: OpencodeTier[] = preferred
      ? [preferred, ...(['zen', 'go'] as OpencodeTier[]).filter((t) => t !== preferred)]
      : ['zen', 'go'];

    const checks: TierKeyCheck[] = [];
    for (const tier of candidates) {
      const check = await this.checkKeyOnTier(tier, apiKey);
      checks.push(check);
      if (check.ok) return { tier, checks };
    }
    return { tier: null, checks };
  }

  /**
   * La chiave è autenticata su questa tier?
   *
   * **Non si valuta la salute di un modello**: il gateway elenca modelli che
   * poi risponde 500/503/400/403 (vedi `probeModel`), e legare la validità
   * della chiave a uno di essi la faceva dichiarare "non valida" quando era
   * perfetta — bastava che il modello di probe fosse deprecato, a opt-in, o
   * momentaneamente rotto. Conta una cosa sola: la richiesta ha superato
   * l'autenticazione? Quindi **solo un 401 (e un 403 su un endpoint non
   * legato ai modelli) significa chiave non valida**; qualunque altra
   * risposta — 402 credito esaurito, 429 rate limit, 500 del gateway, 400
   * modello non supportato — dimostra che la chiave è stata accettata.
   */
  private async checkKeyOnTier(tier: OpencodeTier, apiKey: string): Promise<TierKeyCheck> {
    // 1) Endpoint autenticato e indipendente dai modelli. Esiste sulla tier Go
    //    (404 su Zen): è il controllo più pulito quando c'è.
    const usage = await this.authenticatedStatus(`${this.baseUrlFor(tier)}/usage`, apiKey);
    if (usage.status !== 404) {
      const verdict = keyIsAuthenticated('usage', usage.status);
      if (verdict !== null) {
        return { tier, ok: verdict, status: usage.status, detail: usage.detail };
      }
    }

    // 2) Ripiego: tier senza `/usage`, oppure `/usage` che non ha risposto.
    const probe = await this.probeModel(tier, apiKey, PROBE_MODEL);
    if (probe.ok) return { tier, ok: true, status: 200, detail: 'ok' };
    return {
      tier,
      ok: keyIsAuthenticated('chat', probe.status) === true,
      status: probe.status,
      detail: probe.detail,
    };
  }

  /** GET autenticata che ritorna solo stato e corpo d'errore leggibile. */
  private async authenticatedStatus(
    url: string,
    apiKey: string,
  ): Promise<{ status: number; detail: string }> {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      return { status: res.status, detail: res.ok ? 'ok' : await readErrorBody(res) };
    } catch (e) {
      return { status: 0, detail: (e as Error).message || 'nessuna risposta' };
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

  /**
   * Verifica che il gateway sappia servire **questo** modello con **questa**
   * chiave: `GET /models` non è un indicatore di disponibilità (elenca modelli
   * che poi rispondono 500/503/400). Micro-chiamata da 1 token.
   */
  async probeModel(
    tier: OpencodeTier,
    apiKey: string,
    model: string,
  ): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
    try {
      const res = await fetch(`${this.baseUrlFor(tier)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return { ok: true };
      return { ok: false, status: res.status, detail: await readErrorBody(res) };
    } catch (e) {
      return { ok: false, status: 0, detail: (e as Error).message || 'nessuna risposta' };
    }
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
      throw gatewayError(body.model, res.status, await readErrorBody(res));
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
      throw gatewayError(body.model, res.status, await readErrorBody(res));
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };
    if (json.error?.message) throw new ServiceUnavailableException(json.error.message);
    return json.choices?.[0]?.message?.content ?? '';
  }
}

/**
 * Errore di una chiamata a `chat/completions` reso comprensibile. Il gateway
 * OpenCode elenca in `GET /models` anche modelli che poi **non sa servire** (con
 * questa chiave o del tutto): rispondono 500 "Internal server error", 503
 * "Endpoint is unavailable", 400 "Unsupported model", 403 (opt-in richiesto).
 * Senza il nome del modello e il suggerimento di cambiarlo, l'utente legge solo
 * "Internal server error" e non ha idea di cosa fare.
 */
function gatewayError(model: string, status: number, detail: string): ServiceUnavailableException {
  const base = `Il modello "${model}" non è utilizzabile su OpenCode (HTTP ${status}: ${detail}).`;
  const hint =
    status === 403
      ? ' Richiede un opt-in esplicito sul tuo workspace OpenCode.'
      : status === 401
        ? ' Controlla la chiave API e il credito del workspace nelle Impostazioni.'
        : ' Scegline un altro nelle Impostazioni → Modello AI: il gateway lo elenca ma non lo serve.';
  return new ServiceUnavailableException(base + hint);
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