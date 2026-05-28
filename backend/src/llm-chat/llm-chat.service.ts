import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatRole } from '@prisma/client';
import { Ollama, type Message, type ToolCall } from 'ollama';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { ToolRegistry } from './tools/tool-registry';

@Injectable()
export class LlmChatService {
  private readonly logger = new Logger(LlmChatService.name);
  private readonly ollama: Ollama;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly toolRegistry: ToolRegistry,
    private readonly policy: AccountPolicyService,
  ) {
    this.ollama = new Ollama({ host: this.config.getOrThrow<string>('OLLAMA_BASE_URL') });
    this.model = this.config.getOrThrow<string>('OLLAMA_MODEL');
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
   * Async generator che produce token via SSE. Gestisce internamente eventuali
   * tool call (loop fino a 6 round) e salva i messaggi finali a fine streaming.
   */
  async *streamReply(
    userId: string,
    sessionId: string,
    userMessage: string,
  ): AsyncGenerator<{ delta: string; done: boolean }> {
    const session = await this.getSession(userId, sessionId);

    // Salva subito il messaggio utente
    await this.prisma.chatMessage.create({
      data: { sessionId, role: ChatRole.user, content: userMessage },
    });

    const systemPrompt = await this.buildSystemPrompt(userId);

    const history: Message[] = [
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

    const tools = this.toolRegistry.getDefinitions().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    let assistantBuffer = '';
    const MAX_ROUNDS = 6;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = await this.ollama.chat({
        model: this.model,
        messages: history,
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

      const collectedToolCalls: ToolCall[] = [];
      let roundContent = '';

      for await (const part of stream) {
        if (part.message?.tool_calls?.length) {
          collectedToolCalls.push(...part.message.tool_calls);
        }
        const delta = part.message?.content ?? '';
        if (delta) {
          roundContent += delta;
          assistantBuffer += delta;
          yield { delta, done: false };
        }
      }

      if (collectedToolCalls.length === 0) {
        // Nessun tool call: la risposta è completa
        break;
      }

      this.logger.debug(
        `Round ${round}: ${collectedToolCalls.length} tool call(s) — ${collectedToolCalls
          .map((c) => c.function.name)
          .join(', ')}`,
      );

      // Esegui i tool call e aggiungi i risultati alla history
      history.push({
        role: 'assistant',
        content: roundContent,
        tool_calls: collectedToolCalls,
      } as Message);

      for (const call of collectedToolCalls) {
        const fnName = call.function.name;
        const args = (call.function.arguments ?? {}) as Record<string, unknown>;
        const result = await this.toolRegistry.execute(fnName, args, userId);
        const resultContent = JSON.stringify(result);
        history.push({
          role: 'tool',
          content: resultContent,
        } as Message);

        await this.prisma.chatMessage.create({
          data: {
            sessionId,
            role: ChatRole.tool,
            content: resultContent,
            toolName: fnName,
            toolArgs: args as object,
          },
        });
      }
    }

    // Salva il messaggio assistant finale
    if (assistantBuffer.trim()) {
      await this.prisma.chatMessage.create({
        data: { sessionId, role: ChatRole.assistant, content: assistantBuffer },
      });
    }

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
