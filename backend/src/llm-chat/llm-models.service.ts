import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama } from 'ollama';
import { LlmConfigService } from './llm-config.service';
import { isCatalogModel, LLM_CATALOG, type LlmCatalogEntry } from './llm-catalog';

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  parameterSize?: string;
  quantization?: string;
  /** ISO 8601. */
  modifiedAt?: string;
}

export interface LlmOverview {
  activeModel: string;
  source: 'db' | 'env';
  /** false se il server Ollama non risponde (container spento, ancora in avvio…). */
  serverOk: boolean;
  installed: InstalledModel[];
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
  ) {
    const host = config.get<string>('OLLAMA_BASE_URL');
    this.ollama = host ? new Ollama({ host }) : null;
  }

  async getOverview(): Promise<LlmOverview> {
    const active = await this.llmConfig.getActiveModel();
    let serverOk = false;
    let installed: InstalledModel[] = [];

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

    return { activeModel: active.model, source: active.source, serverOk, installed };
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
    const active = await this.llmConfig.getActiveModel();
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
