import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'singleton';

export interface ActiveLlmModel {
  /** Tag del modello Ollama da usare. Stringa vuota se non configurato. */
  model: string;
  /** `db` se scelto dall'admin nelle impostazioni, `env` se dal default del compose. */
  source: 'db' | 'env';
}

/**
 * Risolve il modello Ollama attivo: `LlmConfig.model` (scelta dell'admin) con
 * fallback su `OLLAMA_MODEL` (default del compose).
 *
 * I consumatori (`LlmChatService`, `CategoryAiService`) chiamano
 * `getActiveModel()` A OGNI richiesta: il modello si cambia a runtime dalle
 * impostazioni e non deve servire un riavvio del backend. Per non pagare una
 * query per token di streaming il valore è cachato in-process e invalidato da
 * `setActiveModel()`. La cache è per-processo: sta in piedi perché il backend
 * gira in un singolo container (nessun altro scrittore possibile).
 */
@Injectable()
export class LlmConfigService {
  private readonly logger = new Logger(LlmConfigService.name);
  private cached: ActiveLlmModel | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getActiveModel(): Promise<ActiveLlmModel> {
    if (this.cached) return this.cached;

    let dbModel: string | null = null;
    try {
      const row = await this.prisma.llmConfig.findUnique({ where: { id: SINGLETON_ID } });
      dbModel = row?.model?.trim() || null;
    } catch (e) {
      // Il DB non deve poter rompere la chat: si degrada sul valore d'ambiente.
      this.logger.warn(`Lettura LlmConfig fallita, uso OLLAMA_MODEL: ${(e as Error).message}`);
    }

    const resolved: ActiveLlmModel = dbModel
      ? { model: dbModel, source: 'db' }
      : { model: this.config.get<string>('OLLAMA_MODEL')?.trim() ?? '', source: 'env' };

    this.cached = resolved;
    return resolved;
  }

  /** Salva la scelta dell'admin sul singleton e invalida la cache. */
  async setActiveModel(userId: string, model: string): Promise<ActiveLlmModel> {
    await this.prisma.llmConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, model, updatedBy: userId },
      update: { model, updatedBy: userId },
    });
    this.cached = { model, source: 'db' };
    return this.cached;
  }

  /** Svuota la cache (usato quando il singleton può essere cambiato altrove, es. restore da backup). */
  invalidate(): void {
    this.cached = null;
  }
}
