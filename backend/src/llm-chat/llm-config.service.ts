import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OPENCODE_CRYPTO_CONTEXT, CryptoService } from '../common/services/crypto.service';
import type { OpencodeTier } from './opencode.client';
import { QUOTA_COOLDOWN_MS } from './llm-fallback';

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
  /**
   * Prompt di base dei report di periodo scelto dall'admin. `undefined` = si
   * usa il testo predefinito. Vale per entrambi i provider.
   */
  reportPrompt?: string;
}

/** Stato esposto alle impostazioni (chiave mascherata, mai in chiaro). */
export interface LlmConfigStatus {
  provider: LlmProvider;
  activeModel: string;
  source: 'db' | 'env';
  /** Prompt di base dei report; stringa vuota = si usa il predefinito. */
  reportPrompt: string;
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
  /**
   * Fino a quando restare su Ollama dopo un limite raggiunto su OpenCode.
   * In-process: il backend gira in un container singolo, come la cache qui
   * sopra. `null` = nessun cooldown attivo.
   */
  private opencodeCooldownUntil: number | null = null;
  /** Modello Ollama scelto dall'admin, letto insieme al resto del singleton. */
  private cachedOllamaModel: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  async getActiveConfig(): Promise<ActiveLlmConfig> {
    // Il cooldown va applicato SOPRA la cache, non dentro il valore cachato:
    // altrimenti resterebbe congelato e non scadrebbe mai (o congelerebbe il
    // ripiego anche dopo la scadenza).
    if (this.cached) return this.withCooldown(this.cached);

    let row: { provider: string | null; model: string | null; opencodeTier: string | null; opencodeModel: string | null; opencodeApiKeyEncrypted: string | null; reportPrompt: string | null } | null = null;
    try {
      row = await this.prisma.llmConfig.findUnique({ where: { id: SINGLETON_ID } });
    } catch (e) {
      // Il DB non deve poter rompere la chat: si degrada su Ollama + env.
      this.logger.warn(`Lettura LlmConfig fallita, uso OLLAMA_MODEL: ${(e as Error).message}`);
    }

    // Tenuto da parte per `resolveOllama()`: la riserva usa il modello Ollama
    // scelto dall'admin anche quando il provider attivo è OpenCode.
    this.cachedOllamaModel = row?.model ?? null;
    const reportPrompt = row?.reportPrompt?.trim() || undefined;

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
    resolved.reportPrompt = reportPrompt;

    this.cached = resolved;
    return this.withCooldown(resolved);
  }

  /**
   * Se OpenCode ha dichiarato il limite raggiunto di recente, serve direttamente
   * la configurazione Ollama: senza questo ogni richiesta pagherebbe una
   * chiamata lenta e destinata a fallire prima di ripiegare.
   */
  private withCooldown(resolved: ActiveLlmConfig): ActiveLlmConfig {
    if (resolved.provider !== 'opencode') return resolved;
    if (!this.opencodeCooldownUntil) return resolved;
    if (Date.now() >= this.opencodeCooldownUntil) {
      this.opencodeCooldownUntil = null;
      return resolved;
    }
    const fallback = this.resolveOllama();
    if (!fallback) return resolved; // niente Ollama: meglio provare e fallire parlando
    return fallback;
  }

  /**
   * Configurazione del modello locale, usata come riserva quando il provider
   * cloud fallisce. `null` se Ollama non è configurato: in quel caso non c'è
   * riserva e l'errore del cloud deve arrivare all'utente.
   */
  getFallbackConfig(): ActiveLlmConfig | null {
    return this.resolveOllama();
  }

  /** Apre la finestra di cooldown su OpenCode (limite raggiunto / credito esaurito). */
  noteOpencodeQuotaExhausted(): void {
    this.opencodeCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
    this.logger.warn(
      `Limite OpenCode raggiunto: uso il modello locale per i prossimi ${Math.round(QUOTA_COOLDOWN_MS / 60_000)} minuti.`,
    );
  }

  /** Vero se in questo momento OpenCode è in cooldown (per log e diagnostica). */
  isOpencodeOnCooldown(): boolean {
    return !!this.opencodeCooldownUntil && Date.now() < this.opencodeCooldownUntil;
  }

  private resolveOllama(): ActiveLlmConfig | null {
    if (!this.config.get<string>('OLLAMA_BASE_URL')) return null;
    const model =
      this.cachedOllamaModel?.trim() || this.config.get<string>('OLLAMA_MODEL')?.trim() || '';
    if (!model) return null;
    return {
      provider: 'ollama',
      model,
      source: this.cachedOllamaModel?.trim() ? 'db' : 'env',
    };
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
    // Tenuto da parte per `resolveOllama()`: la riserva usa il modello Ollama
    // scelto dall'admin anche quando il provider attivo è OpenCode.
    this.cachedOllamaModel = row?.model ?? null;

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
      reportPrompt: row?.reportPrompt ?? '',
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

  /**
   * Salva il prompt di base dei report. Stringa vuota = torna al predefinito
   * (salviamo NULL, così "vuoto" e "mai impostato" restano la stessa cosa).
   */
  async setReportPrompt(userId: string, prompt: string): Promise<{ reportPrompt: string }> {
    const value = prompt.trim() || null;
    await this.prisma.llmConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, reportPrompt: value, updatedBy: userId },
      update: { reportPrompt: value, updatedBy: userId },
    });
    this.invalidate();
    return { reportPrompt: value ?? '' };
  }

  /** Svuota la cache (usato quando il singleton può essere cambiato altrove, es. restore da backup). */
  invalidate(): void {
    this.cached = null;
    // Cambiare provider/chiave/modello è un intervento esplicito dell'admin:
    // deve poter riprovare OpenCode subito, senza aspettare il cooldown.
    this.opencodeCooldownUntil = null;
  }
}

/** Primi 4 + … + ultimi 4 della chiave. Chiavi corte mascherate per intero. */
function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}