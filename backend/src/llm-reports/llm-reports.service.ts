import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama } from 'ollama';
import { LlmReportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { LlmConfigService, type ActiveLlmConfig } from '../llm-chat/llm-config.service';
import { OpencodeClient } from '../llm-chat/opencode.client';
import {
  EmptyLlmResponseError,
  isFallbackWorthy,
  isQuotaError,
} from '../llm-chat/llm-fallback';
import {
  STALE_LOCK_MS,
  buildAccountsKey,
  buildFingerprint,
  buildPeriodKey,
  isStaleLock,
  periodLabel,
  periodRange,
  previousPeriodRange,
  type LlmReportScope,
} from './llm-report.keys';
import { buildReportPrompt, type ReportSnapshot } from './llm-report.prompt';

/** Chiave univoca della riga: è anche il lock della generazione. */
interface LlmReportKey {
  userId: string;
  scope: LlmReportScope;
  periodKey: string;
  accountsKey: string;
}

/** Parametri del periodo, uguali per GET e POST. */
export interface LlmReportParams {
  scope: LlmReportScope;
  year: number;
  month?: number;
  accountIds?: string[];
}

/** Payload letto dalla UI. `missing` = non è mai stato generato. */
export interface LlmReportView {
  status: 'missing' | 'generating' | 'ready' | 'error';
  content: string | null;
  generatedAt: string | null;
  provider: string | null;
  model: string | null;
  /** I dati del periodo sono cambiati dopo la generazione. */
  stale: boolean;
  /** Secondi trascorsi dall'inizio della generazione in corso. */
  elapsedSeconds: number | null;
  errorMessage: string | null;
}

/**
 * Tetto per la chiamata a Ollama, sotto i 300s di `headersTimeout` di undici:
 * così a scadere è il NOSTRO abort, con un messaggio riconoscibile, invece di
 * un opaco "fetch failed". OpenCode ha già il suo tetto (120s) dentro
 * `OpencodeClient.chat`.
 */
const OLLAMA_TIMEOUT_MS = 240_000;
/** Il modello resta caricato tra una generazione e l'altra: su CPU il caricamento è la parte lenta. */
const OLLAMA_KEEP_ALIVE = '30m';

/**
 * Report testuale del periodo scritto dall'LLM attivo.
 *
 * La generazione è un job **detached**: la POST ritorna 202 e il lavoro
 * prosegue in background. Lo stato sta a DB e non in memoria — deve
 * sopravvivere alla PWA uccisa da iOS, valere tra dispositivi diversi e non
 * tornare "premibile" se il backend si riavvia a metà.
 */
@Injectable()
export class LlmReportsService {
  private readonly logger = new Logger(LlmReportsService.name);
  private readonly ollama: Ollama | null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly llmConfig: LlmConfigService,
    private readonly opencode: OpencodeClient,
  ) {
    const host = config.get<string>('OLLAMA_BASE_URL');
    // Fetch personalizzato: il client `ollama` non espone un AbortSignal per le
    // chiamate non in streaming, ma accetta un fetch alternativo.
    this.ollama = host ? new Ollama({ host, fetch: fetchWithTimeout }) : null;
  }

  async getStatus(userId: string, params: LlmReportParams): Promise<LlmReportView> {
    const key = this.keyOf(userId, params);
    const row = await this.prisma.llmReport.findUnique({
      where: { userId_scope_periodKey_accountsKey: key },
    });
    if (!row) return emptyView();

    // Un job rimasto appeso (backend riavviato) non deve tenere la UI in
    // caricamento per sempre: lo raccontiamo come errore, e la claim successiva
    // lo riprende.
    if (row.status === LlmReportStatus.generating && isStaleLock(row.startedAt)) {
      return {
        status: 'error',
        content: row.content,
        generatedAt: row.completedAt?.toISOString() ?? null,
        provider: row.provider,
        model: row.model,
        stale: false,
        elapsedSeconds: null,
        errorMessage: 'La generazione precedente si è interrotta. Riprova.',
      };
    }

    let stale = false;
    if (row.status === LlmReportStatus.ready && row.dataFingerprint) {
      const { from, to } = periodRange(params.scope, params.year, params.month);
      const totals = await this.reports.periodTotals(userId, from, to, params.accountIds);
      stale = buildFingerprint(totals) !== row.dataFingerprint;
    }

    return {
      status: row.status,
      content: row.content,
      generatedAt: row.completedAt?.toISOString() ?? null,
      provider: row.provider,
      model: row.model,
      stale,
      elapsedSeconds:
        row.status === LlmReportStatus.generating
          ? Math.round((Date.now() - row.startedAt.getTime()) / 1000)
          : null,
      errorMessage: row.errorMessage,
    };
  }

  /**
   * Prende il lock e avvia la generazione. Il lock è la riga stessa: la claim è
   * un `updateMany` condizionale, atomico lato Postgres, quindi due click
   * simultanei da due dispositivi non generano due volte.
   */
  async requestGeneration(
    userId: string,
    params: LlmReportParams,
    force: boolean,
  ): Promise<{ status: 'generating' }> {
    const key = this.keyOf(userId, params);
    const now = new Date();
    const existing = await this.prisma.llmReport.findUnique({
      where: { userId_scope_periodKey_accountsKey: key },
    });

    if (existing) {
      if (existing.status === LlmReportStatus.generating && !isStaleLock(existing.startedAt, now)) {
        throw new ConflictException('Un report per questo periodo è già in generazione.');
      }
      if (existing.status === LlmReportStatus.ready && !force) {
        throw new ConflictException(
          'Esiste già un report per questo periodo: conferma la sovrascrittura per rigenerarlo.',
        );
      }
      const claimed = await this.prisma.llmReport.updateMany({
        where: {
          id: existing.id,
          OR: [
            { status: { not: LlmReportStatus.generating } },
            { startedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
          ],
        },
        data: {
          status: LlmReportStatus.generating,
          startedAt: now,
          completedAt: null,
          errorMessage: null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Un report per questo periodo è già in generazione.');
      }
    } else {
      try {
        await this.prisma.llmReport.create({
          data: { ...key, status: LlmReportStatus.generating, startedAt: now },
        });
      } catch (e) {
        // P2002 = un'altra richiesta ha creato la riga nello stesso istante:
        // il lock ce l'ha lei, non noi.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Un report per questo periodo è già in generazione.');
        }
        throw e;
      }
    }

    // Detached: nessun await. Il try/catch è dentro `runGeneration`, altrimenti
    // un errore diventerebbe una unhandled rejection.
    void this.runGeneration(userId, params, key);
    return { status: 'generating' };
  }

  private keyOf(userId: string, params: LlmReportParams): LlmReportKey {
    if (params.scope === 'monthly' && !params.month) {
      throw new BadRequestException('Il report mensile richiede il mese.');
    }
    return {
      userId,
      scope: params.scope,
      periodKey: buildPeriodKey(params.scope, params.year, params.month),
      accountsKey: buildAccountsKey(params.accountIds),
    };
  }

  private async runGeneration(
    userId: string,
    params: LlmReportParams,
    key: LlmReportKey,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const snapshot = await this.buildSnapshot(userId, params);
      // Chiave di sessione per OpenCode: stabile per report, così una
      // rigenerazione dello stesso periodo riusa il prompt caching.
      const { content, config } = await this.generateContent(
        snapshot,
        `report-${key.scope}-${key.periodKey}-${key.accountsKey}`,
      );
      await this.prisma.llmReport.update({
        where: { userId_scope_periodKey_accountsKey: key },
        data: {
          status: LlmReportStatus.ready,
          content,
          // Provider e modello **effettivi**: se è intervenuta la riserva
          // locale, è quella che finisce a DB e quindi sotto al report.
          provider: config.provider,
          model: config.model,
          dataFingerprint: buildFingerprint(snapshot.totals),
          errorMessage: null,
          completedAt: new Date(),
        },
      });
      this.logger.log(
        `Report LLM ${key.scope} ${key.periodKey} generato in ${elapsedSeconds(startedAt)}s (${config.provider} ${config.model})`,
      );
    } catch (e) {
      const message = describeError(e);
      this.logger.warn(
        `Report LLM ${key.scope} ${key.periodKey} fallito dopo ${elapsedSeconds(startedAt)}s: ${message}`,
      );
      await this.prisma.llmReport
        .update({
          where: { userId_scope_periodKey_accountsKey: key },
          data: {
            status: LlmReportStatus.error,
            errorMessage: message,
            completedAt: new Date(),
          },
        })
        // Se anche la scrittura dell'errore fallisce (DB giù) non resta che
        // loggare: il lock scaduto rimetterà comunque la cella in gioco.
        .catch((err) =>
          this.logger.error(`Impossibile salvare l'errore del report: ${describeError(err)}`),
        );
    }
  }

  /**
   * Scrive il report col provider attivo e, se il cloud fallisce per causa sua,
   * ripiega sul modello locale. Restituisce anche la configurazione **davvero**
   * usata: è quella che viene salvata a DB e mostrata sotto al report.
   */
  private async generateContent(
    snapshot: ReportSnapshot,
    sessionKey: string,
  ): Promise<{ content: string; config: ActiveLlmConfig }> {
    const config = await this.llmConfig.getActiveConfig();
    if (!config.model) {
      throw new ServiceUnavailableException(
        'Nessun modello LLM configurato: scegline uno in Impostazioni → Modello AI.',
      );
    }
    // Il prompt di base è quello scelto dall'admin nelle impostazioni, se c'è.
    const prompt = buildReportPrompt(snapshot, config.reportPrompt);
    try {
      return { content: await this.runOn(config, prompt, sessionKey), config };
    } catch (e) {
      if (config.provider !== 'opencode' || !isFallbackWorthy(e)) throw e;
      if (isQuotaError(e)) this.llmConfig.noteOpencodeQuotaExhausted();
      const fallback = this.llmConfig.getFallbackConfig();
      // Senza Ollama non c'è riserva: l'errore del cloud deve arrivare a schermo.
      if (!fallback) throw e;
      this.logger.warn(
        `Report LLM: OpenCode ha fallito (${describeError(e)}), riprovo con il modello locale ${fallback.model}.`,
      );
      try {
        return { content: await this.runOn(fallback, prompt, sessionKey), config: fallback };
      } catch (fallbackError) {
        // L'utente deve vedere che hanno fallito ENTRAMBI, non solo il secondo.
        throw new ServiceUnavailableException(
          `OpenCode non ha risposto (${describeError(e)}) e anche il modello locale "${fallback.model}" ha fallito: ${describeError(fallbackError)}`,
        );
      }
    }
  }

  /** Una singola generazione su un provider preciso. Vuoto = fallimento. */
  private async runOn(
    config: ActiveLlmConfig,
    prompt: string,
    sessionKey: string,
  ): Promise<string> {
    const content = (await this.callLlm(config, prompt, sessionKey)).trim();
    if (!content) throw new EmptyLlmResponseError(config.model);
    return content;
  }

  private async callLlm(
    config: ActiveLlmConfig,
    prompt: string,
    sessionKey: string,
  ): Promise<string> {
    if (config.provider === 'opencode') {
      if (!config.apiKey || !config.tier) {
        throw new ServiceUnavailableException(
          'OpenCode è il provider attivo ma manca la API key: configurala in Impostazioni.',
        );
      }
      // Niente `temperature`: alcuni modelli reasoning la rifiutano.
      return this.opencode.chat(
        config.tier,
        config.apiKey,
        {
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
        },
        sessionKey,
      );
    }
    if (!this.ollama) {
      throw new ServiceUnavailableException(
        'Server Ollama non configurato (OLLAMA_BASE_URL mancante).',
      );
    }
    const res = await this.ollama.chat({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { temperature: 0.3, num_ctx: 8192 },
    });
    return res.message?.content ?? '';
  }

  private async buildSnapshot(userId: string, params: LlmReportParams): Promise<ReportSnapshot> {
    const { scope, year, month, accountIds } = params;
    const { from, to } = periodRange(scope, year, month);
    const prev = previousPeriodRange(scope, year, month);

    const [totals, previousTotals, expenseTree, incomeTree, topExpenses, series] = await Promise.all(
      [
        this.reports.periodTotals(userId, from, to, accountIds),
        this.reports.periodTotals(userId, prev.from, prev.to, accountIds),
        this.reports.categoryBreakdownTree(userId, from, to, accountIds, undefined, 'expense'),
        this.reports.categoryBreakdownTree(userId, from, to, accountIds, undefined, 'income'),
        this.reports.topTransactions(userId, from, to, accountIds),
        scope === 'annual'
          ? this.reports.monthlyAggregates(userId, year, accountIds).then((rows) =>
              rows.map((m) => ({
                label: String(m.month).padStart(2, '0'),
                incomeCents: m.incomeCents,
                expenseCents: m.expenseCents,
              })),
            )
          : this.reports.dailyTimeSeries(userId, from, to, accountIds).then((rows) =>
              rows.map((d) => ({
                label: d.date.slice(8, 10),
                incomeCents: d.incomeCents,
                expenseCents: d.expenseCents,
              })),
            ),
      ],
    );

    return {
      scope,
      label: periodLabel(scope, year, month),
      previousLabel:
        scope === 'annual'
          ? periodLabel('annual', year - 1)
          : periodLabel('monthly', prev.from.getUTCFullYear(), prev.from.getUTCMonth() + 1),
      // Niente nomi di conto: servirebbe una query ACL in più per un dettaglio
      // che il report non usa davvero.
      accountsLabel:
        accountIds && accountIds.length > 0
          ? `${accountIds.length} conti selezionati`
          : 'tutti i conti',
      totals,
      previousTotals,
      series,
      expenseTree,
      incomeTree,
      topExpenses,
    };
  }
}

function emptyView(): LlmReportView {
  return {
    status: 'missing',
    content: null,
    generatedAt: null,
    provider: null,
    model: null,
    stale: false,
    elapsedSeconds: null,
    errorMessage: null,
  };
}

function elapsedSeconds(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 1000);
}

/** Tira fuori anche la `cause`: il fetch di Node dice "fetch failed" e nasconde il motivo vero. */
function describeError(e: unknown): string {
  const err = e as Error & { cause?: unknown };
  const cause = err?.cause instanceof Error ? ` (${err.cause.message})` : '';
  return `${err?.message ?? String(e)}${cause}`;
}

/** Fetch con tetto di tempo per la singola chiamata a Ollama. */
const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });
