import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatRole } from '@prisma/client';
import { Ollama, type Message, type ToolCall } from 'ollama';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { LlmConfigService, type ActiveLlmConfig } from './llm-config.service';
import { OpencodeClient, type OpenAiMessage, type OpenAiToolDef } from './opencode.client';
import { isFallbackWorthy, isQuotaError } from './llm-fallback';
import { ToolRegistry } from './tools/tool-registry';

/**
 * Turno di conversazione in formato neutro: sia Ollama sia OpenCode consumano
 * lo stesso contenuto, convertito per-provider a ogni round. Gli arguments dei
 * tool sono sempre oggetti (Ollama li dà come oggetti, OpenCode come stringa
 * JSON da parsare).
 */
interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

/**
 * Evento SSE prodotto dallo stream della risposta. `status` segnala al
 * frontend cosa sta facendo il backend (es. esecuzione di un tool) così la UI
 * non sembra "ferma" mentre il modello lavora.
 */
export interface ChatStreamEvent {
  delta: string;
  done: boolean;
  status?: 'thinking' | 'tool' | 'fallback';
  tool?: string;
  /** Solo con `status: 'fallback'`: il modello locale che ha preso il posto del cloud. */
  model?: string;
}

@Injectable()
export class LlmChatService {
  private readonly logger = new Logger(LlmChatService.name);
  private readonly ollama: Ollama | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly toolRegistry: ToolRegistry,
    private readonly policy: AccountPolicyService,
    private readonly llmConfig: LlmConfigService,
    private readonly opencode: OpencodeClient,
  ) {
    // L'host resta fisso (topologia docker); il modello no: è scelto a runtime
    // dalle impostazioni ed è quindi risolto a ogni richiesta.
    const host = config.get<string>('OLLAMA_BASE_URL');
    this.ollama = host ? new Ollama({ host }) : null;
  }

  async listSessions(userId: string) {
    return this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true, createdAt: true },
    });
  }

  async createSession(userId: string, title?: string) {
    return this.prisma.chatSession.create({
      data: { userId, title: title ?? null },
    });
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session || session.userId !== userId) throw new NotFoundException('Session not found');
    return session;
  }

  async deleteSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('Session not found');
    await this.prisma.chatSession.delete({ where: { id: sessionId } });
  }

  /**
   * Costruisce il system prompt con il contesto utente in linea: data
   * corrente, intervallo mese/anno corrente, elenco conti accessibili,
   * lista categorie. Senza questo contesto il modello (qwen2.5:7b) usa
   * date arbitrarie del suo training (spesso 2024) e i tool ritornano
   * sempre 0 risultati. Questo è ciò che fa la differenza fra un LLM
   * "che dice di non avere dati" e uno che risponde correttamente.
   */
  private async buildSystemPrompt(userId: string): Promise<string> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = today.toISOString().slice(0, 10);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const monthEnd = new Date(nextMonthStart.getTime() - 86400_000);
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const monthName = monthStart.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

    // Carica conti + categorie per dare contesto immediato all'LLM (così
    // non deve necessariamente chiamare list_accounts/list_categories per
    // domande semplici, e sa già "Spesa, Trasporti, ..." quando l'utente
    // dice "quanto ho speso in spesa?").
    const [accounts, categories] = await Promise.all([
      this.prisma.account.findMany({
        where: this.policy.accessibleAccountsWhere(userId),
        select: { name: true, type: true, balanceCents: true, currency: true },
      }),
      this.prisma.category.findMany({
        where: { userId },
        select: { name: true, isIncome: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const accountsLine =
      accounts.length === 0
        ? 'Nessun conto registrato.'
        : accounts
            .map(
              (a) =>
                `${a.name} (${a.type}, saldo ${(Number(a.balanceCents) / 100).toFixed(2)} ${a.currency})`,
            )
            .join('; ');
    const expenseCats = categories.filter((c) => !c.isIncome).map((c) => c.name);
    const incomeCats = categories.filter((c) => c.isIncome).map((c) => c.name);

    return `Sei un assistente di finanza personale per la famiglia dell'utente.
Hai accesso solo ai dati dei CONTI dell'utente attualmente loggato. Non puoi mai vedere i dati di altri utenti.

== CONTESTO TEMPORALE (USA QUESTI VALORI ESATTI, NON DATE INVENTATE) ==
- Oggi: ${todayIso}
- Mese corrente: ${monthName} (dal ${monthStart.toISOString().slice(0, 10)} al ${monthEnd.toISOString().slice(0, 10)})
- Anno corrente: dal ${yearStart.toISOString().slice(0, 10)} al ${todayIso}

== CONTESTO UTENTE ==
- Conti: ${accountsLine}
- Categorie spesa: ${expenseCats.join(', ') || '—'}
- Categorie entrata: ${incomeCats.join(', ') || '—'}

== REGOLE TASSATIVE ==
1. Quando l'utente fa una domanda numerica (quanto ho speso, quanto guadagno, qual è il saldo, ecc.) DEVI usare i tool. NON inventare numeri MAI.
2. Quando l'utente dice "questo mese" / "mese corrente" / "a maggio" usa l'intervallo del mese corrente sopra.
3. Quando l'utente dice "anno" / "quest'anno" / "YTD" usa l'intervallo anno corrente sopra.
4. Per il TOTALE delle spese del periodo → tool \`period_totals\`.
5. Per la RIPARTIZIONE per categoria → tool \`category_breakdown\`.
6. Per VEDERE le transazioni una per una → tool \`list_transactions\`.
7. Per i SALDI dei conti → tool \`list_accounts\`.
8. Per BUDGET vs speso → tool \`budget_status\`.
9. Se un tool restituisce \`{ ok: true, data: [] }\` o totali a 0, chiarisci che NON ci sono dati per quel periodo, NON dire genericamente "non hai spese".
10. Rispondi sempre in italiano, conciso, con elenchi puntati per riepiloghi e cifre formattate in € (es. €1.234,50).
11. Tutte le date che passi ai tool DEVONO essere nel formato YYYY-MM-DD basate sul contesto temporale sopra.

Esempi:
- "quanto ho speso questo mese?" → period_totals(from=${monthStart.toISOString().slice(0, 10)}, to=${monthEnd.toISOString().slice(0, 10)}) → riassumi le uscite.
- "spese per categoria a maggio" → category_breakdown(from=${monthStart.toISOString().slice(0, 10)}, to=${monthEnd.toISOString().slice(0, 10)}).
- "ultime 10 spese" → list_transactions(type='expense', limit=10).`;
  }

  /**
   * La riserva locale da usare per questo errore, oppure `null` se non si deve
   * ripiegare: errore nostro, Ollama non configurato, oppure il round ha **già
   * emesso testo** — ricominciare mostrerebbe all'utente due risposte cucite
   * insieme, quindi in quel caso l'errore arriva a schermo come sempre.
   */
  private fallbackFor(error: unknown, roundContent: string): ActiveLlmConfig | null {
    if (roundContent) return null;
    if (!isFallbackWorthy(error)) return null;
    // Il cooldown va aperto comunque: anche se qui non possiamo ripiegare, le
    // richieste successive non devono continuare a sbattere sul limite.
    if (isQuotaError(error)) this.llmConfig.noteOpencodeQuotaExhausted();
    if (!this.ollama) return null;
    const fallback = this.llmConfig.getFallbackConfig();
    return fallback?.model ? fallback : null;
  }

  /**
   * Async generator che produce token via SSE. Gestisce internamente eventuali
   * tool call (loop fino a 6 round) e salva i messaggi finali a fine streaming.
   *
   * Il provider è risolto a ogni richiesta (`LlmConfigService`): se è
   * `opencode` Ollama non viene mai contattato, quindi spento o irraggiungibile
   * non manda in errore la chat.
   */
  async *streamReply(
    userId: string,
    sessionId: string,
    userMessage: string,
  ): AsyncGenerator<ChatStreamEvent> {
    const session = await this.getSession(userId, sessionId);

    // `let`: se il cloud fallisce senza aver ancora emesso testo, la riserva
    // locale prende il suo posto per i round rimanenti.
    let config = await this.llmConfig.getActiveConfig();
    if (!config.model) {
      throw new ServiceUnavailableException(
        'Nessun modello LLM configurato: selezionane uno in Impostazioni.',
      );
    }
    if (config.provider === 'opencode' && (!config.apiKey || !config.tier)) {
      throw new ServiceUnavailableException(
        'Chiave API OpenCode non configurata: impostala in Impostazioni.',
      );
    }

    // Salva subito il messaggio utente
    await this.prisma.chatMessage.create({
      data: { sessionId, role: ChatRole.user, content: userMessage },
    });

    const systemPrompt = await this.buildSystemPrompt(userId);

    const history: ChatTurn[] = [
      { role: 'system', content: systemPrompt },
      // Tieni solo gli ultimi 12 messaggi user/assistant per non saturare
      // la context window di modelli piccoli (qwen2.5:7b ha 32k ma con
      // history lunga + risultati tool il tool-calling degrada).
      ...session.messages
        .filter((m) => m.role !== ChatRole.tool)
        .slice(-12)
        .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      { role: 'user', content: userMessage },
    ];

    const tools: OpenAiToolDef[] = this.toolRegistry.getDefinitions().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    let assistantBuffer = '';
    /** Vero se a rispondere è stato il modello di riserva invece del cloud. */
    let usedFallback = false;
    const MAX_ROUNDS = 6;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      let roundContent = '';
      const collected: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

      if (config.provider === 'opencode') {
        // OpenAI-compatible: i tool call in streaming arrivano in delta
        // incrementali (index + arguments spezzati): si accumulano per index.
        // Niente `temperature`: alcuni modelli reasoning la rifiutano.
        const acc = new Map<number, { id: string; name: string; arguments: string }>();
        const roundStartedAt = Date.now();
        let lastThinkingAt = 0;
        try {
          for await (const chunk of this.opencode.streamChat(config.tier!, config.apiKey!, {
            model: config.model,
            messages: history.map(toOpenAiMessage),
            tools,
          })) {
            if (chunk.thinking) {
              // Il reasoning arriva token per token: lo segnaliamo al frontend
              // al massimo ogni 2s, per non inondare la UI di eventi.
              const now = Date.now();
              if (now - lastThinkingAt > 2000) {
                lastThinkingAt = now;
                yield { delta: '', done: false, status: 'thinking' };
              }
            }
            if (chunk.content) {
              roundContent += chunk.content;
              assistantBuffer += chunk.content;
              yield { delta: chunk.content, done: false };
            }
            if (chunk.toolCalls) {
              for (const tc of chunk.toolCalls) {
                const cur =
                  acc.get(tc.index) ?? { id: tc.id ?? syntheticId(round, tc.index), name: '', arguments: '' };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name += tc.function.name;
                if (tc.function?.arguments) cur.arguments += tc.function.arguments;
                acc.set(tc.index, cur);
              }
            }
          }
        } catch (e) {
          const fallback = this.fallbackFor(e, roundContent);
          if (!fallback) throw e;
          this.logger.warn(
            `Chat: OpenCode ha fallito al round ${round} (${(e as Error).message}), riprovo con il modello locale ${fallback.model}.`,
          );
          config = fallback;
          usedFallback = true;
          // Il round va rifatto da capo con la riserva: `history` è in formato
          // neutro e viene riconvertita per provider, quindi non serve altro.
          // Niente resti del tentativo fallito (nessun testo è uscito: lo
          // garantisce `fallbackFor`).
          collected.length = 0;
          yield { delta: '', done: false, status: 'fallback', model: fallback.model };
          round--;
          continue;
        }
        this.logger.debug(
          `Round ${round} OpenCode completato in ${Math.round((Date.now() - roundStartedAt) / 1000)}s (${acc.size} tool call, ${roundContent.length} char)`,
        );
        for (const [, tc] of acc) {
          collected.push({ id: tc.id, name: tc.name, arguments: parseToolArgs(tc.arguments) });
        }
      } else {
        if (!this.ollama) {
          throw new ServiceUnavailableException(
            'Server Ollama non configurato (OLLAMA_BASE_URL mancante).',
          );
        }
        const stream = await this.ollama.chat({
          model: config.model,
          messages: history.map(toOllamaMessage),
          tools,
          stream: true,
          // temperature bassa: tool calling più consistente, risposte
          // numeriche più affidabili. num_ctx: garantisce abbastanza
          // contesto per system prompt + history + tool results.
          options: {
            temperature: 0.2,
            top_p: 0.9,
            num_ctx: 8192,
          },
        });

        for await (const part of stream) {
          if (part.message?.tool_calls?.length) {
            for (const t of part.message.tool_calls) {
              collected.push({
                id: syntheticId(round, collected.length),
                name: t.function.name,
                arguments: (t.function.arguments ?? {}) as Record<string, unknown>,
              });
            }
          }
          const delta = part.message?.content ?? '';
          if (delta) {
            roundContent += delta;
            assistantBuffer += delta;
            yield { delta, done: false };
          }
        }
      }

      if (collected.length === 0) {
        // Nessun tool call: la risposta è completa
        break;
      }

      this.logger.debug(
        `Round ${round}: ${collected.length} tool call(s) — ${collected
          .map((c) => c.name)
          .join(', ')}`,
      );

      // Esegui i tool call e aggiungi i risultati alla history. Prima di ogni
      // esecuzione viene emesso un evento `status: tool` così il frontend può
      // mostrare cosa sta facendo ("consulto le tue transazioni…") invece di un
      // puntino che gira a vuoto.
      history.push({ role: 'assistant', content: roundContent, tool_calls: collected });

      for (const call of collected) {
        yield { delta: '', done: false, status: 'tool', tool: call.name };
        const result = await this.toolRegistry.execute(call.name, call.arguments, userId);
        const resultContent = JSON.stringify(result);
        history.push({ role: 'tool', content: resultContent, tool_call_id: call.id });

        await this.prisma.chatMessage.create({
          data: {
            sessionId,
            role: ChatRole.tool,
            content: resultContent,
            toolName: call.name,
            toolArgs: call.arguments as object,
          },
        });
      }
    }

    // Risposta completamente vuota (nessun token mai generato, es. stream
    // finito senza contenuto né tool call): non lasciamo la chat in silenzio,
    // si trasforma in un errore parlante lato frontend.
    if (!assistantBuffer.trim()) {
      this.logger.warn(`Risposta LLM vuota per la sessione ${sessionId} (provider ${config.provider})`);
      throw new ServiceUnavailableException(
        'Il modello non ha prodotto nessuna risposta (nessun token generato). Riprova o scegli un altro modello nelle Impostazioni.',
      );
    }

    if (usedFallback) {
      this.logger.log(
        `Sessione ${sessionId}: risposta prodotta dal modello locale ${config.model} (riserva di OpenCode).`,
      );
    }

    // Salva il messaggio assistant finale
    await this.prisma.chatMessage.create({
      data: { sessionId, role: ChatRole.assistant, content: assistantBuffer },
    });

    // Auto-titola la sessione se ancora senza titolo
    if (!session.title && userMessage) {
      const title = userMessage.length > 80 ? userMessage.slice(0, 77) + '...' : userMessage;
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: { title, updatedAt: new Date() },
      });
    } else {
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });
    }

    yield { delta: '', done: true };
  }
}

/** Converte un turno neutro nel formato `Message` di Ollama. */
function toOllamaMessage(t: ChatTurn): Message {
  if (t.role === 'assistant' && t.tool_calls?.length) {
    return {
      role: 'assistant',
      content: t.content ?? '',
      tool_calls: t.tool_calls.map((tc) => ({
        function: { name: tc.name, arguments: tc.arguments },
      })) as ToolCall[],
    };
  }
  return { role: t.role as 'system' | 'user' | 'assistant' | 'tool', content: t.content ?? '' };
}

/** Converte un turno neutro nel formato OpenAI-compatible (`chat/completions`). */
function toOpenAiMessage(t: ChatTurn): OpenAiMessage {
  if (t.role === 'assistant' && t.tool_calls?.length) {
    return {
      role: 'assistant',
      content: t.content ?? '',
      tool_calls: t.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }
  if (t.role === 'tool') {
    return { role: 'tool', content: t.content ?? '', tool_call_id: t.tool_call_id };
  }
  return { role: t.role, content: t.content ?? '' };
}

/** ID sintetico per i tool call che non lo espongono (es. Ollama). */
function syntheticId(round: number, index: number): string {
  return `call_${round}_${index}`;
}

/** Gli arguments di OpenAI arrivano come stringa JSON: li si parsano con fallback. */
function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
