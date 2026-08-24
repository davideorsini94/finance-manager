import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OPENCODE_CRYPTO_CONTEXT, CryptoService } from '../common/services/crypto.service';
import type { OpencodeTier } from './opencode.client';

const SINGLETON_ID = 'singleton';

export type LlmProvider = 'ollama' | 'opencode';

/** Configurazione risolta del provider LLM attivo, pronta per una richiesta. */
export interface ActiveLlmConfig {
  provider: LlmProvider;
  /** Tag/modello da usare. Stringa vuota se non configurato. */
  model: string;
  /** `db` se scelto dall'admin, `env` se dal default del compose. */
  source: 'db' | 'env';
  /** Solo opencode: API key in chiaro, `undefined` se non configurata. */
  apiKey?: string;
  /** Solo opencode: tier rilevata dalla chiave. */
  tier?: OpencodeTier;
}

/** Stato esposto alle impostazioni (chiave mascherata, mai in chiaro). */
export interface LlmConfigStatus {
  provider: LlmProvider;
  activeModel: string;
  source: 'db' | 'env';
  opencode: {
    configured: boolean;
    apiKeyMasked: string | null;
    tier: OpencodeTier | null;
    model: string | null;
  };
}

/**
 * Risolve il provider LLM attivo (Ollama locale o OpenCode cloud).
 *
 * I consumatori (`LlmChatService`, `CategoryAiService`) chiamano
 * `getActiveConfig()` A OGNI richiesta: modello e provider si cambiano a
 * runtime dalle impostazioni e non deve servire un riavvio del backend. Per
 * non pagare una query per token di streaming il valore è cachato in-process e
 * invalidato da ogni `set*` e dal restore backup. La cache è per-processo:
 * sta in piedi perché il backend gira in un singolo container.
 *
 * Ollama: `model` a NULL significa "usa `OLLAMA_MODEL`". OpenCode: la API key
 * è cifrata at-rest (contesto `fm-opencode-v1`) e decifrata solo quando il
 * provider attivo è opencode; non viene mai esposta dalle API (solo
 * mascherata via `getStatus()`).
 */
@Injectable()
export class LlmConfigService {
  private readonly logger = new Logger(LlmConfigService.name);
  private cached: ActiveLlmConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  async getActiveConfig(): Promise<ActiveLlmConfig> {
    if (this.cached) return this.cached;

    let row: { provider: string | null; model: string | null; opencodeTier: string | null; opencodeModel: string | null; opencodeApiKeyEncrypted: string | null } | null = null;
    try {
      row = await this.prisma.llmConfig.findUnique({ where: { id: SINGLETON_ID } });
    } catch (e) {
      // Il DB non deve poter rompere la chat: si degrada su Ollama + env.
      this.logger.warn(`Lettura LlmConfig fallita, uso OLLAMA_MODEL: ${(e as Error).message}`);
    }

    const provider: LlmProvider = row?.provider === 'opencode' ? 'opencode' : 'ollama';
    const resolved: ActiveLlmConfig =
      provider === 'opencode'
        ? this.resolveOpencode(
            row ?? { opencodeTier: null, opencodeModel: null, opencodeApiKeyEncrypted: null },
          )
        : {
            provider: 'ollama',
            model: row?.model?.trim() ?? this.config.get<string>('OLLAMA_MODEL')?.trim() ?? '',
            source: row?.model?.trim() ? 'db' : 'env',
          };

    this.cached = resolved;
    return resolved;
  }

  private resolveOpencode(row: {
    opencodeTier: string | null;
    opencodeModel: string | null;
    opencodeApiKeyEncrypted: string | null;
  }): ActiveLlmConfig {
    const tier = row.opencodeTier === 'go' ? 'go' : row.opencodeTier === 'zen' ? 'zen' : undefined;
    let apiKey: string | undefined;
    if (row.opencodeApiKeyEncrypted) {
      try {
        apiKey = this.crypto.decrypt(row.opencodeApiKeyEncrypted, OPENCODE_CRYPTO_CONTEXT);
      } catch (e) {
        // Tipicamente: JWT_ACCESS_SECRET ruotato dopo il salvataggio.
        this.logger.warn(`Decifratura API key OpenCode fallita: ${(e as Error).message}`);
      }
    }
    return {
      provider: 'opencode',
      model: row.opencodeModel?.trim() ?? '',
      source: 'db',
      apiKey,
      tier,
    };
  }

  /** Stato per le impostazioni: maschera la chiave, legge dal DB (no cache). */
  async getStatus(): Promise<LlmConfigStatus> {
    const row = await this.prisma.llmConfig.findUnique({ where: { id: SINGLETON_ID } });
    const provider: LlmProvider = row?.provider === 'opencode' ? 'opencode' : 'ollama';
    const activeModel =
      provider === 'opencode'
        ? (row?.opencodeModel ?? '').trim()
        : (row?.model ?? '').trim() ||
          this.config.get<string>('OLLAMA_MODEL')?.trim() ||
          '';
    const source = provider === 'opencode' ? 'db' : row?.model?.trim() ? 'db' : 'env';

    let apiKeyMasked: string | null = null;
    if (row?.opencodeApiKeyEncrypted) {
      try {
        apiKeyMasked = maskApiKey(
          this.crypto.decrypt(row.opencodeApiKeyEncrypted, OPENCODE_CRYPTO_CONTEXT),
        );
      } catch {
        apiKeyMasked = null;
      }
    }

    return {
      provider,
      activeModel,
      source,
      opencode: {
        configured: !!row?.opencodeApiKeyEncrypted,
        apiKeyMasked,
        tier: row?.opencodeTier === 'go' ? 'go' : row?.opencodeTier === 'zen' ? 'zen' : null,
        model: row?.opencodeModel ?? null,
      },
    };
  }

  /** Salva il provider attivo e invalida la cache. */
  async setProvider(userId: string, provider: LlmProvider): Promise<void> {
    if (provider !== 'ollama' && provider !== 'opencode') {
      throw new Error(`Provider LLM non valido: ${provider}`);
    }
    await this.prisma.llmConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, provider, updatedBy: userId },
      update: { provider, updatedBy: userId },
    });
    this.invalidate();
  }

  /** Salva la scelta del modello Ollama attivo e invalida la cache. */
  async setActiveModel(userId: string, model: string): Promise<ActiveLlmConfig> {
    await this.prisma.llmConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, model, updatedBy: userId },
      update: { model, updatedBy: userId },
    });
    this.invalidate();
    return { provider: 'ollama', model, source: 'db' };
  }

  /** Salva API key OpenCode (cifrata at-rest) + tier rilevata, e invalida. */
  async setOpencodeCredentials(
    userId: string,
    apiKey: string,
    tier: OpencodeTier,
  ): Promise<void> {
    await this.prisma.llmConfig.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        opencodeApiKeyEncrypted: this.crypto.encrypt(apiKey, OPENCODE_CRYPTO_CONTEXT),
        opencodeTier: tier,
        updatedBy: userId,
      },
      update: {
        opencodeApiKeyEncrypted: this.crypto.encrypt(apiKey, OPENCODE_CRYPTO_CONTEXT),
        opencodeTier: tier,
        updatedBy: userId,
      },
    });
    this.invalidate();
  }

  /** Salva il modello OpenCode attivo e invalida la cache. */
  async setOpencodeModel(userId: string, model: string): Promise<ActiveLlmConfig> {
    await this.prisma.llmConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, opencodeModel: model, updatedBy: userId },
      update: { opencodeModel: model, updatedBy: userId },
    });
    this.invalidate();
    return { provider: 'opencode', model, source: 'db' };
  }

  /** Decifra la API key OpenCode a prescindere dal provider attivo (per test). */
  async getOpencodeKey(): Promise<string | undefined> {
    const row = await this.prisma.llmConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!row?.opencodeApiKeyEncrypted) return undefined;
    try {
      return this.crypto.decrypt(row.opencodeApiKeyEncrypted, OPENCODE_CRYPTO_CONTEXT);
    } catch {
      return undefined;
    }
  }

  /** Rimuove la API key OpenCode (e quindi disattiva di fatto il provider). */
  async removeOpencodeKey(): Promise<void> {
    await this.prisma.llmConfig.updateMany({
      where: { id: SINGLETON_ID },
      data: {
        opencodeApiKeyEncrypted: null,
        opencodeTier: null,
        opencodeModel: null,
      },
    });
    this.invalidate();
  }

  /** Svuota la cache (usato quando il singleton può essere cambiato altrove, es. restore da backup). */
  invalidate(): void {
    this.cached = null;
  }
}

/** Primi 4 + … + ultimi 4 della chiave. Chiavi corte mascherate per intero. */
function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}