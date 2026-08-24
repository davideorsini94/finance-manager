import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama } from 'ollama';
import {
  LlmConfigService,
  type LlmProvider,
} from './llm-config.service';
import { OpencodeClient, type OpencodeTier } from './opencode.client';
import { isCatalogModel, LLM_CATALOG, type LlmCatalogEntry } from './llm-catalog';
import { OPENCODE_MODEL_META, isOpencodeCatalogModel } from './opencode-catalog';

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  parameterSize?: string;
  quantization?: string;
  /** ISO 8601. */
  modifiedAt?: string;
}

export interface OpencodeModelEntry {
  modelId: string;
  displayName: string;
  family: string | null;
  /** USD per 1M token di input. `null` se non nel catalogo metadati. */
  inputPrice: number | null;
  /** USD per 1M token di output. `null` se non nel catalogo metadati. */
  outputPrice: number | null;
  /** Qualità curata. `null` se non nel catalogo metadati. */
  quality: string | null;
  description: string | null;
  recommended: boolean;
}

export interface LlmOverview {
  provider: LlmProvider;
  activeModel: string;
  source: 'db' | 'env';
  /** false se il server Ollama non risponde (container spento, ancora in avvio…). */
  serverOk: boolean;
  installed: InstalledModel[];
  opencode: {
    configured: boolean;
    apiKeyMasked: string | null;
    tier: OpencodeTier | null;
    model: string | null;
  };
}

export interface PullStatus {
  active: boolean;
  model?: string;
  status?: string;
  completedBytes?: number;
  totalBytes?: number;
  percent?: number;
  error?: string;
  done?: boolean;
}

/** Stato del job di download, tenuto in memoria (uno solo alla volta). */
interface PullJobState {
  model: string;
  active: boolean;
  status: string;
  completed: number;
  total: number;
  error?: string;
  done: boolean;
}

/**
 * Gestione dei modelli sul server Ollama: elenco installati, download,
 * eliminazione e selezione del modello attivo.
 *
 * Il download è un job **detached** lato server: parte con la POST e continua
 * anche se la PWA viene chiusa (su iPhone la pagina viene uccisa appena passa
 * in background), il client fa polling su `getPullStatus()`.
 */
@Injectable()
export class LlmModelsService {
  private readonly logger = new Logger(LlmModelsService.name);
  private readonly ollama: Ollama | null;
  /** null = nessun download mai avviato in questo processo. */
  private pullJob: PullJobState | null = null;

  constructor(
    config: ConfigService,
    private readonly llmConfig: LlmConfigService,
    private readonly opencode: OpencodeClient,
  ) {
    const host = config.get<string>('OLLAMA_BASE_URL');
    this.ollama = host ? new Ollama({ host }) : null;
  }

  async getOverview(): Promise<LlmOverview> {
    const status = await this.llmConfig.getStatus();
    let serverOk = false;
    let installed: InstalledModel[] = [];

    // L'elenco Ollama è sempre tentato (con try/catch): se il container è
    // spento l'overview degrada a `serverOk: false` senza mai fallire, anche
    // quando il provider attivo è opencode.
    if (this.ollama) {
      try {
        const res = await this.ollama.list();
        installed = res.models.map((m) => ({
          name: m.name || m.model,
          sizeBytes: Number(m.size ?? 0),
          parameterSize: m.details?.parameter_size || undefined,
          quantization: m.details?.quantization_level || undefined,
          modifiedAt: toIso(m.modified_at),
        }));
        serverOk = true;
      } catch (e) {
        this.logger.warn(`Ollama non raggiungibile: ${(e as Error).message}`);
      }
    }

    return {
      provider: status.provider,
      activeModel: status.activeModel,
      source: status.source,
      serverOk,
      installed,
      opencode: status.opencode,
    };
  }

  getCatalog(): { items: readonly LlmCatalogEntry[] } {
    return { items: LLM_CATALOG };
  }

  getPullStatus(): PullStatus {
    const job = this.pullJob;
    if (!job) return { active: false };
    return {
      active: job.active,
      model: job.model,
      status: job.status,
      completedBytes: job.completed,
      totalBytes: job.total,
      percent: job.total > 0 ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 0,
      error: job.error,
      done: job.done,
    };
  }

  /**
   * Avvia il download. Il tag è validato contro il catalogo (allowlist): mai
   * inoltrare a Ollama una stringa arbitraria che arriva dal client.
   */
  startPull(model: string): { started: true } {
    if (!this.ollama) {
      throw new BadRequestException('Server Ollama non configurato (OLLAMA_BASE_URL mancante).');
    }
    if (!isCatalogModel(model)) {
      throw new BadRequestException('Modello non presente nel catalogo.');
    }
    if (this.pullJob?.active) {
      throw new ConflictException(
        `Un download è già in corso (${this.pullJob.model}): attendi che finisca.`,
      );
    }

    this.pullJob = {
      model,
      active: true,
      status: 'avvio',
      completed: 0,
      total: 0,
      done: false,
    };

    // Detached: la richiesta HTTP ritorna subito 202, il download prosegue in
    // background. Nessun await, ma try/catch dentro runPull così un errore non
    // diventa una unhandled rejection (che in Node 18+ termina il processo).
    void this.runPull(model);

    return { started: true };
  }

  private async runPull(model: string): Promise<void> {
    const isCurrentJob = () => this.pullJob?.model === model && this.pullJob.active;
    try {
      const stream = await this.ollama!.pull({ model, stream: true });
      for await (const part of stream) {
        // Se nel frattempo lo stato è stato sostituito (processo riusato per un
        // altro job) non sovrascrivere il job nuovo.
        if (!isCurrentJob()) return;
        const job = this.pullJob!;
        if (part.status) job.status = part.status;
        // Ollama riporta completed/total del LIVELLO in download, non del
        // totale: la percentuale riparte a ogni layer. Va bene per una barra di
        // avanzamento "grezza", ed è l'unico dato disponibile dallo stream.
        if (typeof part.completed === 'number') job.completed = part.completed;
        if (typeof part.total === 'number') job.total = part.total;
      }
      if (!isCurrentJob()) return;
      const job = this.pullJob!;
      job.active = false;
      job.done = true;
      job.status = 'completato';
      if (job.total > 0) job.completed = job.total;
      this.logger.log(`Download modello ${model} completato`);
    } catch (e) {
      const message = (e as Error).message;
      this.logger.error(`Download modello ${model} fallito: ${message}`);
      if (!isCurrentJob()) return;
      const job = this.pullJob!;
      job.active = false;
      job.done = true;
      job.status = 'errore';
      job.error = message;
    }
  }

  /** Elimina un modello installato. Il modello attivo non è eliminabile. */
  async deleteModel(name: string): Promise<void> {
    if (!this.ollama) {
      throw new BadRequestException('Server Ollama non configurato (OLLAMA_BASE_URL mancante).');
    }
    const active = await this.llmConfig.getActiveConfig();
    if (sameModel(name, active.model)) {
      throw new BadRequestException(
        'Non puoi eliminare il modello attivo: selezionane un altro e riprova.',
      );
    }
    if (this.pullJob?.active && sameModel(name, this.pullJob.model)) {
      throw new BadRequestException('Modello in download: attendi la fine per eliminarlo.');
    }

    try {
      await this.ollama.delete({ model: name });
    } catch (e) {
      throw new BadRequestException(
        `Eliminazione del modello non riuscita: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Seleziona il modello attivo. Accetta solo modelli effettivamente
   * installati: puntare a un tag assente romperebbe chat e categorizzazione.
   */
  async setActiveModel(userId: string, model: string): Promise<{ activeModel: string }> {
    if (!this.ollama) {
      throw new BadRequestException('Server Ollama non configurato (OLLAMA_BASE_URL mancante).');
    }

    let installed: string[];
    try {
      const res = await this.ollama.list();
      installed = res.models.map((m) => m.name || m.model);
    } catch (e) {
      throw new BadRequestException(
        `Impossibile verificare i modelli installati (server Ollama non raggiungibile): ${(e as Error).message}`,
      );
    }

    const match = installed.find((n) => sameModel(n, model));
    if (!match) {
      throw new BadRequestException(
        `Il modello "${model}" non risulta installato: scaricalo prima di attivarlo.`,
      );
    }

    // Salva il nome come lo conosce Ollama (con eventuale ":latest" esplicito).
    const saved = await this.llmConfig.setActiveModel(userId, match);
    this.logger.log(`Modello LLM attivo impostato a ${saved.model} da utente ${userId}`);
    return { activeModel: saved.model };
  }

  // ---------------------------------------------------------------------------
  // Provider OpenCode (Zen/Go)
  // ---------------------------------------------------------------------------

  /** Attiva il provider OpenCode come provider LLM dell'app. */
  async setProvider(userId: string, provider: LlmProvider): Promise<{ provider: LlmProvider }> {
    await this.llmConfig.setProvider(userId, provider);
    this.logger.log(`Provider LLM impostato a ${provider} da utente ${userId}`);
    return { provider };
  }

  /**
   * Salva la API key OpenCode: la si prova su entrambe le tier (Zen e Go) per
   * auto-rilevare quella che la accetta, così i modelli mostrati sono quelli
   * corrispondenti alla tipologia di chiave.
   */
  async saveOpencodeApiKey(
    userId: string,
    apiKey: string,
    preferredTier?: OpencodeTier,
  ): Promise<{ tier: OpencodeTier; apiKeyMasked: string }> {
    const key = apiKey.trim();
    if (!key) {
      throw new BadRequestException('La API key non può essere vuota.');
    }
    const tier = await this.opencode.probeTier(key, preferredTier);
    if (!tier) {
      throw new BadRequestException(
        'La API key non è stata accettata da nessun endpoint OpenCode (Zen o Go): verificala e riprova.',
      );
    }
    await this.llmConfig.setOpencodeCredentials(userId, key, tier);
    this.logger.log(`API key OpenCode salvata (tier ${tier}) da utente ${userId}`);
    return { tier, apiKeyMasked: maskKey(key) };
  }

  async removeOpencodeKey(): Promise<void> {
    await this.llmConfig.removeOpencodeKey();
  }

  /**
   * Elenco dei modelli della tier (Zen o Go, default: quella della chiave
   * salvata), arricchito con costo e qualità dal catalogo metadati. Viene
   * letto dall'endpoint pubblico `GET /models`: la lista è quindi quella reale
   * della tipologia di chiave.
   */
  async getOpencodeModels(tier?: OpencodeTier): Promise<OpencodeModelEntry[]> {
    const status = await this.llmConfig.getStatus();
    const effective = tier ?? status.opencode.tier;
    if (!effective) {
      throw new BadRequestException(
        'Nessuna tier OpenCode configurata: salva la API key per rilevarla automaticamente.',
      );
    }
    const ids = await this.opencode.listModels(effective);
    return ids.map((modelId) => {
      const meta = OPENCODE_MODEL_META.get(modelId);
      return meta
        ? {
            modelId,
            displayName: meta.displayName,
            family: meta.family,
            inputPrice: meta.inputPrice,
            outputPrice: meta.outputPrice,
            quality: meta.quality,
            description: meta.description,
            recommended: meta.recommended ?? false,
          }
        : {
            modelId,
            displayName: modelId,
            family: null,
            inputPrice: null,
            outputPrice: null,
            quality: null,
            description: null,
            recommended: false,
          };
    });
  }

  /** Seleziona il modello OpenCode attivo e attiva il provider opencode. */
  /**
   * Salva il modello OpenCode attivo, **provandolo prima sul gateway**.
   *
   * `GET /models` elenca anche modelli che poi non vengono serviti (500
   * "Internal server error", 503 "Endpoint is unavailable", 400 "Unsupported
   * model", 403 opt-in richiesto). Sceglierne uno lasciava la chat muta: il
   * fallimento arrivava solo al primo messaggio, per ogni messaggio. Meglio
   * rifiutare qui, quando l'admin sta scegliendo e può leggere il perché.
   */
  async selectOpencodeModel(
    userId: string,
    model: string,
  ): Promise<{ activeModel: string }> {
    if (!isOpencodeCatalogModel(model)) {
      throw new BadRequestException('Modello non presente nel catalogo OpenCode.');
    }

    const key = await this.llmConfig.getOpencodeKey();
    if (key) {
      const tier = (await this.opencode.probeTier(key)) ?? undefined;
      if (tier) {
        const probe = await this.opencode.probeModel(tier, key, model);
        if (!probe.ok) {
          this.logger.warn(
            `Modello OpenCode ${model} rifiutato dal gateway (HTTP ${probe.status}): ${probe.detail}`,
          );
          throw new BadRequestException(
            `Il gateway OpenCode elenca "${model}" ma non lo serve (HTTP ${probe.status}: ${probe.detail}). Scegli un altro modello.`,
          );
        }
      }
      // Senza tier valida non si può provare nulla: si salva comunque, il test
      // della chiave dirà all'admin cosa non torna.
    }

    await this.llmConfig.setProvider(userId, 'opencode');
    const saved = await this.llmConfig.setOpencodeModel(userId, model);
    this.logger.log(`Modello OpenCode attivo impostato a ${saved.model} da utente ${userId}`);
    return { activeModel: saved.model };
  }

  /** Verifica che la chiave salvata sia ancora valida e su quale tier. */
  async testOpencode(): Promise<{ ok: boolean; tier: OpencodeTier | null; error?: string }> {
    const key = await this.llmConfig.getOpencodeKey();
    if (!key) {
      return { ok: false, tier: null, error: 'Chiave API OpenCode non configurata.' };
    }
    const tier = await this.opencode.probeTier(key);
    if (!tier) {
      return { ok: false, tier: null, error: 'La chiave salvata non è più valida.' };
    }
    return { ok: true, tier };
  }
}

/**
 * Confronto tra tag Ollama tollerante sul tag implicito: `ollama list`
 * restituisce sempre `nome:latest`, mentre l'utente/env può scrivere solo `nome`.
 */
function sameModel(a: string, b: string): boolean {
  return withTag(a) === withTag(b);
}

function withTag(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}

function toIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Primi 4 + … + ultimi 4 della API key. Chiavi corte mascherate per intero. */
function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
