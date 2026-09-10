import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama } from 'ollama';
import {
  LlmConfigService,
  type LlmProvider,
} from './llm-config.service';
import { OpencodeClient, type OpencodeTier, type TierKeyCheck } from './opencode.client';
import { isCatalogModel, LLM_CATALOG, type LlmCatalogEntry } from './llm-catalog';
import { OPENCODE_MODEL_META, pickReplacementModel } from './opencode-catalog';
import {
  OpencodeAvailabilityService,
  type AvailabilitySnapshot,
  type ModelAvailability,
} from './opencode-availability.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, UserRole } from '@prisma/client';
import type { LlmConfigStatus } from './llm-config.service';

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

/**
 * Elenco proposto in Impostazioni: **solo modelli verificati funzionanti**.
 * `checkedAt` dice quando è stata fatta la verifica (null = non verificati,
 * manca la API key), `excludedCount` quanti il gateway elenca ma non serve —
 * si mostra il numero e non i nomi: la tendina deve contenere solo roba che va.
 */
export interface OpencodeModelList {
  models: OpencodeModelEntry[];
  /** ISO 8601 dell'ultima verifica; `null` se non è stato possibile verificare. */
  checkedAt: string | null;
  excludedCount: number;
  /** Una passata di verifica è in corso: il client può ripollare. */
  refreshing: boolean;
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

  /** Riparazione del modello attivo in corso: una alla volta, non una per richiesta. */
  private healing: Promise<void> | null = null;

  constructor(
    config: ConfigService,
    private readonly llmConfig: LlmConfigService,
    private readonly opencode: OpencodeClient,
    private readonly availability: OpencodeAvailabilityService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
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
    const { tier, checks } = await this.opencode.probeTierDetailed(key, preferredTier);
    if (!tier) {
      this.logger.warn(
        `API key OpenCode rifiutata: ${checks
          .map((c) => `${c.tier} HTTP ${c.status} ${c.detail}`)
          .join(' · ')}`,
      );
      throw new BadRequestException(keyRejectedMessage(checks));
    }
    await this.llmConfig.setOpencodeCredentials(userId, key, tier);
    // Chiave nuova = modelli potenzialmente diversi (anche la tier può essere
    // cambiata): la foto di disponibilità non vale più.
    this.availability.invalidate();
    this.logger.log(`API key OpenCode salvata (tier ${tier}) da utente ${userId}`);
    return { tier, apiKeyMasked: maskKey(key) };
  }

  async removeOpencodeKey(): Promise<void> {
    await this.llmConfig.removeOpencodeKey();
    this.availability.invalidate();
  }

  /**
   * Elenco dei modelli della tier (Zen o Go, default: quella della chiave
   * salvata), arricchito con costo e qualità dal catalogo metadati. Viene
   * letto dall'endpoint pubblico `GET /models`: la lista è quindi quella reale
   * della tipologia di chiave.
   */
  async getOpencodeModels(tier?: OpencodeTier): Promise<OpencodeModelList> {
    const status = await this.llmConfig.getStatus();
    const effective = tier ?? status.opencode.tier;
    if (!effective) {
      throw new BadRequestException(
        'Nessuna tier OpenCode configurata: salva la API key per rilevarla automaticamente.',
      );
    }

    const key = await this.llmConfig.getOpencodeKey();
    if (!key) {
      // Senza chiave non si può provare nulla: si elenca quello che il gateway
      // dice e lo si dichiara non verificato, invece di mostrare una lista
      // vuota che sembrerebbe un guasto.
      const ids = await this.opencode.listModels(effective);
      return {
        models: [...ids].sort((a, b) => a.localeCompare(b)).map((id) => this.describeModel(id)),
        checkedAt: null,
        excludedCount: 0,
        refreshing: false,
      };
    }

    const { snapshot, refreshing } = await this.availability.get(effective, key);
    // Se è caduto il modello ATTIVO l'app si ripara da sé: un modello morto in
    // configurazione significa chat rotta a ogni messaggio.
    await this.healActiveModel(snapshot, status);

    const working = snapshot.models.filter((m) => m.ok);
    return {
      models: working.map((m) => this.describeModel(m.modelId)),
      checkedAt: snapshot.checkedAt.toISOString(),
      excludedCount: snapshot.models.length - working.length,
      refreshing,
    };
  }

  /** Una voce di elenco: metadati dal catalogo se ci sono, altrimenti il solo id. */
  private describeModel(modelId: string): OpencodeModelEntry {
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
  }

  /**
   * Il modello attivo non è più servito (o non è più elencato)? Se ne imposta
   * uno verificato e si avvisano gli admin.
   *
   * Guardie, tutte necessarie: solo se il provider attivo è OpenCode; solo se
   * la foto riguarda la tier configurata (le impostazioni possono chiedere
   * `?tier=` per curiosità e quella lista non deve riscrivere la
   * configurazione); e mai se non funziona **niente** — in quel caso resta il
   * modello di prima, con la riserva Ollama che risponde.
   */
  private async healActiveModel(
    snapshot: AvailabilitySnapshot,
    status: LlmConfigStatus,
  ): Promise<void> {
    if (status.provider !== 'opencode') return;
    if (snapshot.tier !== status.opencode.tier) return;

    const active = (status.opencode.model ?? '').trim();
    if (!active) return;

    const entry = snapshot.models.find((m) => m.modelId === active);
    if (entry?.ok) return;

    const replacement = pickReplacementModel(
      snapshot.models.filter((m) => m.ok).map((m) => m.modelId),
    );
    if (!replacement || replacement === active) return;

    // Una riparazione alla volta: il frontend ripolla ogni 3s durante un
    // rinfresco e non deve poter innescare due cambi e due notifiche.
    if (this.healing) return this.healing;
    this.healing = this.switchActiveModel(active, replacement, entry).finally(() => {
      this.healing = null;
    });
    return this.healing;
  }

  private async switchActiveModel(
    from: string,
    to: string,
    entry: ModelAvailability | undefined,
  ): Promise<void> {
    const reason = entry
      ? `HTTP ${entry.status}: ${entry.detail}`
      : 'non è più elencato dal gateway';
    this.logger.warn(
      `Modello OpenCode attivo "${from}" non più utilizzabile (${reason}): passo a "${to}".`,
    );
    // updatedBy null: non l'ha chiesto nessun admin, è stato il sistema.
    await this.llmConfig.setOpencodeModel(null, to);

    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.admin },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.notifications.create({
        userId: admin.id,
        type: NotificationType.system,
        title: 'Modello AI cambiato automaticamente',
        body: `Il gateway OpenCode non serve più "${from}" (${reason}). Ho impostato "${to}", verificato funzionante. Puoi scegliere un altro modello in Impostazioni → Modello AI.`,
        data: { kind: 'system', level: 'warning', href: '/settings' },
        dedupKey: `opencode-model-switch:${from}:${to}`,
      });
    }
  }

  /**
   * Salva il modello OpenCode attivo, **provandolo prima sul gateway**.
   *
   * Due controlli, in quest'ordine: (1) il modello è nell'elenco vivo della
   * tier (`GET /models`) — mai nella mappa dei metadati, che serve solo a
   * prezzo/qualità e resta indietro sui modelli nuovi; (2) il gateway lo serve
   * davvero, perché `GET /models` elenca anche modelli che poi rispondono 500
   * "Internal server error", 503 "Endpoint is unavailable", 400 "Unsupported
   * model" o 403 (opt-in richiesto). Sceglierne uno lasciava la chat muta: il
   * fallimento arrivava solo al primo messaggio, per ogni messaggio. Meglio
   * rifiutare qui, quando l'admin sta scegliendo e può leggere il perché.
   */
  async selectOpencodeModel(
    userId: string,
    model: string,
  ): Promise<{ activeModel: string }> {
    const key = await this.llmConfig.getOpencodeKey();
    if (key) {
      const status = await this.llmConfig.getStatus();
      const tier =
        status.opencode.tier ?? (await this.opencode.probeTier(key)) ?? undefined;
      if (tier) {
        // L'allowlist è l'elenco VIVO della tier, non la mappa dei metadati:
        // quella serve solo per prezzo e qualità e resta indietro ogni volta
        // che il gateway aggiunge un modello (era il motivo per cui modelli
        // realmente serviti venivano rifiutati come "fuori catalogo").
        const available = await this.opencode.listModels(tier);
        if (!available.includes(model)) {
          throw new BadRequestException(
            `Il gateway OpenCode (tier ${tier}) non elenca il modello "${model}".`,
          );
        }
        const probe = await this.opencode.probeModel(tier, key, model);
        if (!probe.ok) {
          this.logger.warn(
            `Modello OpenCode ${model} rifiutato dal gateway (HTTP ${probe.status}): ${probe.detail}`,
          );
          throw new BadRequestException(
            probe.status === 403
              ? `Il modello "${model}" richiede un'adesione esplicita (opt-in) sul tuo account OpenCode: il gateway lo elenca ma risponde 403 (${probe.detail}). Abilitalo su opencode.ai oppure scegli un altro modello.`
              : `Il gateway OpenCode elenca "${model}" ma non lo serve (HTTP ${probe.status}: ${probe.detail}). Scegli un altro modello.`,
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

/**
 * Messaggio per una chiave rifiutata da tutte le tier. Distingue i casi che
 * prima finivano tutti in un generico "non valida": la chiave arriva qui solo
 * quando nessun endpoint ha superato l'autenticazione, ma il **perché** può
 * essere un 401 (chiave davvero errata) o l'assenza di risposta (gateway
 * irraggiungibile, timeout, DNS) — che non dice nulla sulla chiave.
 */
function keyRejectedMessage(checks: readonly TierKeyCheck[]): string {
  const unreachable = checks.filter((c) => c.status === 0);
  if (unreachable.length === checks.length) {
    return `Nessuna risposta dagli endpoint OpenCode (${unreachable
      .map((c) => c.tier)
      .join(', ')}): gateway irraggiungibile o timeout, la chiave non è stata verificata. Riprova.`;
  }
  const detail = checks.map((c) => `${c.tier}: HTTP ${c.status} ${c.detail}`).join(' · ');
  return `La API key non è stata accettata da nessun endpoint OpenCode (${detail}). Verificala e riprova.`;
}

/** Primi 4 + … + ultimi 4 della API key. Chiavi corte mascherate per intero. */
function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
