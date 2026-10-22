import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama } from 'ollama';
import { ollamaChatText } from '../llm-chat/ollama-text';
import { LlmConfigService } from '../llm-chat/llm-config.service';
import { OpencodeClient } from '../llm-chat/opencode.client';
import { isQuotaError } from '../llm-chat/llm-fallback';
import {
  buildExtractionPrompt,
  cleanPdfText,
  extractJsonObject,
  isUsefulExtraction,
  normalizeExtraction,
  type ExtractedBill,
} from './bill-extraction';

/**
 * Testo passato a Ollama: meno che a OpenCode. Il modello locale gira su CPU
 * con un contesto di 8k token: 12.000 caratteri (~4k token) lasciano spazio
 * al prompt e alla risposta, e i dati utili stanno nelle prime pagine.
 */
const OLLAMA_TEXT_MAX_CHARS = 12_000;
const OLLAMA_NUM_CTX = 8192;
/** Sotto i 300s di `headersTimeout` di undici, come in `CategoryAiService`. */
// qwen3.5:4b su CPU impiega 3–5 minuti a bolletta, e con due letture in coda
// la seconda aspetta la prima: margine ampio (vedi STALE_EXTRACTION_MS).
const OLLAMA_TIMEOUT_MS = 12 * 60_000;

export interface ExtractionOutcome {
  data: ExtractedBill;
  /** `opencode:<modello>` o `ollama:<modello>`. */
  model: string;
}

/**
 * Legge i dati di una bolletta dal testo del PDF.
 *
 * Ordine fisso, chiesto dall'utente: **prima OpenCode** (chiave e modello
 * delle Impostazioni, anche se la chat usa Ollama), poi **Ollama**. Si passa
 * al secondo per qualunque problema del primo — non solo i guasti di rete
 * come nella chat: anche una risposta vuota o un JSON da cui non si ricava
 * niente, perché qui l'alternativa è far compilare tutto a mano.
 */
@Injectable()
export class BillExtractorService {
  private readonly logger = new Logger(BillExtractorService.name);
  private readonly ollama: Ollama | null;

  constructor(
    config: ConfigService,
    private readonly llmConfig: LlmConfigService,
    private readonly opencode: OpencodeClient,
  ) {
    const host = config.get<string>('OLLAMA_BASE_URL');
    this.ollama = host
      ? new Ollama({
          host,
          fetch: (input, init) =>
            fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(OLLAMA_TIMEOUT_MS) }),
        })
      : null;
  }

  /** Lancia un errore leggibile se nessun modello riesce a leggere la bolletta. */
  async extract(pdfText: string, billId: string): Promise<ExtractionOutcome> {
    const failures: string[] = [];

    const cloud = await this.llmConfig.getOpencodeConfig();
    if (cloud?.apiKey && cloud.tier) {
      const startedAt = Date.now();
      try {
        const text = await this.opencode.chat(
          cloud.tier,
          cloud.apiKey,
          { model: cloud.model, messages: [{ role: 'user', content: buildExtractionPrompt(cleanPdfText(pdfText)) }] },
          // Una sessione per bolletta: rileggere lo stesso PDF riusa la cache.
          `utility-bill-${billId}`,
        );
        const data = normalizeExtraction(extractJsonObject(text));
        if (isUsefulExtraction(data)) {
          this.logger.log(`Bolletta ${billId} letta da OpenCode ${cloud.model} in ${seconds(startedAt)}s`);
          return { data, model: `opencode:${cloud.model}` };
        }
        failures.push(`OpenCode ${cloud.model}: nessun dato riconosciuto`);
      } catch (e) {
        if (isQuotaError(e)) this.llmConfig.noteOpencodeQuotaExhausted();
        failures.push(`OpenCode ${cloud.model}: ${describeError(e)}`);
      }
      this.logger.warn(`Bolletta ${billId}: ${failures[failures.length - 1]}, provo con Ollama`);
    } else {
      failures.push('OpenCode non configurato o in pausa per quota esaurita');
    }

    // `getActiveConfig` carica in cache il modello Ollama scelto dall'admin,
    // che `getFallbackConfig` usa al posto di quello d'ambiente.
    await this.llmConfig.getActiveConfig();
    const local = this.llmConfig.getFallbackConfig();
    if (local && this.ollama) {
      const startedAt = Date.now();
      try {
        const content = await ollamaChatText(this.ollama, {
          model: local.model,
          messages: [
            { role: 'user', content: buildExtractionPrompt(cleanPdfText(pdfText, OLLAMA_TEXT_MAX_CHARS)) },
          ],
          format: 'json',
          // Scaricato subito dopo: sull'host la memoria libera è poca.
          keep_alive: '1m',
          options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX },
        });
        const data = normalizeExtraction(extractJsonObject(content));
        if (isUsefulExtraction(data)) {
          this.logger.log(`Bolletta ${billId} letta da Ollama ${local.model} in ${seconds(startedAt)}s`);
          return { data, model: `ollama:${local.model}` };
        }
        failures.push(`Ollama ${local.model}: nessun dato riconosciuto`);
      } catch (e) {
        failures.push(`Ollama ${local.model}: ${describeError(e)}`);
      }
    } else {
      failures.push('Ollama non configurato');
    }

    this.logger.warn(`Bolletta ${billId} non letta: ${failures.join(' · ')}`);
    throw new Error(failures.join(' · '));
  }
}

const seconds = (startedAt: number) => Math.round((Date.now() - startedAt) / 1000);

function describeError(e: unknown): string {
  const error = e as { message?: unknown; cause?: { message?: unknown } };
  const message = typeof error?.message === 'string' ? error.message : String(e);
  const cause = typeof error?.cause?.message === 'string' ? error.cause.message : null;
  return (cause && cause !== message ? `${message} (${cause})` : message).slice(0, 200);
}
