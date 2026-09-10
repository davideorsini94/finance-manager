import { Injectable, Logger } from '@nestjs/common';
import { OpencodeClient, type OpencodeTier } from './opencode.client';

/** Esito dell'ultima sonda su un modello. */
export interface ModelAvailability {
  modelId: string;
  ok: boolean;
  /** Stato HTTP dell'ultima sonda; `null` se il modello risponde. */
  status: number | null;
  /** Corpo d'errore leggibile; `null` se il modello risponde. */
  detail: string | null;
}

/** Foto di quali modelli della tier sono serviti davvero, a un dato istante. */
export interface AvailabilitySnapshot {
  tier: OpencodeTier;
  checkedAt: Date;
  /** Ordinati per `modelId`: la lista mostrata non deve ballare tra due passate. */
  models: ModelAvailability[];
}

/**
 * Oltre questa età la foto è considerata vecchia: si risponde comunque con
 * quella (l'apertura della pagina non deve aspettare) e si rinfresca dietro.
 */
export const AVAILABILITY_TTL_MS = 15 * 60_000;

/** Sonde in parallelo: 36 modelli in serie sarebbero un minuto di attesa. */
export const PROBE_CONCURRENCY = 8;

/**
 * Quali modelli della tier OpenCode sono **realmente serviti, adesso**.
 *
 * `GET /models` elenca anche modelli che poi rispondono 500 "Internal server
 * error", 400 "Model is unavailable" o 401 per formato non supportato: l'unico
 * modo di sapere se un modello funziona è provarlo (micro-chiamata da 1 token,
 * `OpencodeClient.probeModel`). Provarli tutti a ogni apertura delle
 * impostazioni costerebbe 36 richieste e diversi secondi, quindi il risultato
 * è una foto tenuta in memoria con TTL:
 *
 * - foto assente (primo avvio del processo): si aspetta la passata, non c'è
 *   niente da mostrare;
 * - foto vecchia: si risponde con quella e si rinfresca **in background**, così
 *   la pagina è immediata e il giro dopo mostra i dati nuovi;
 * - richieste concorrenti: una passata sola (`inFlight` per tier), altrimenti
 *   dieci client in polling farebbero dieci passate.
 *
 * La foto sta **in memoria** e non a DB: dopo un riavvio la prima apertura
 * delle impostazioni la ricostruisce. È lo stesso compromesso della cache di
 * `LlmConfigService`, e una tabella in più per un dato che scade in 15 minuti
 * non si giustifica.
 */
@Injectable()
export class OpencodeAvailabilityService {
  private readonly logger = new Logger(OpencodeAvailabilityService.name);
  private readonly snapshots = new Map<OpencodeTier, AvailabilitySnapshot>();
  private readonly inFlight = new Map<OpencodeTier, Promise<AvailabilitySnapshot>>();

  constructor(private readonly opencode: OpencodeClient) {}

  /**
   * Foto della tier, più `refreshing` = una passata è in corso (il client può
   * ripolling per vedere il risultato).
   */
  async get(
    tier: OpencodeTier,
    apiKey: string,
  ): Promise<{ snapshot: AvailabilitySnapshot; refreshing: boolean }> {
    const cached = this.snapshots.get(tier);
    if (!cached) {
      return { snapshot: await this.refresh(tier, apiKey), refreshing: false };
    }
    if (Date.now() - cached.checkedAt.getTime() > AVAILABILITY_TTL_MS) {
      // Rinfresco in background: l'errore non deve affondare la richiesta in
      // corso, che ha già una risposta valida da restituire.
      void this.refresh(tier, apiKey).catch((e) =>
        this.logger.warn(`Rinfresco disponibilità ${tier} fallito: ${(e as Error).message}`),
      );
      return { snapshot: cached, refreshing: true };
    }
    return { snapshot: cached, refreshing: this.inFlight.has(tier) };
  }

  /** Butta le foto: la chiave o la tier sono cambiate, i modelli non sono più gli stessi. */
  invalidate(tier?: OpencodeTier): void {
    if (tier) this.snapshots.delete(tier);
    else this.snapshots.clear();
  }

  /** Attende le passate in corso (usato dai test e da chi vuole dati freschi). */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  private refresh(tier: OpencodeTier, apiKey: string): Promise<AvailabilitySnapshot> {
    const running = this.inFlight.get(tier);
    if (running) return running;
    const started = this.sweep(tier, apiKey).finally(() => this.inFlight.delete(tier));
    this.inFlight.set(tier, started);
    return started;
  }

  private async sweep(tier: OpencodeTier, apiKey: string): Promise<AvailabilitySnapshot> {
    const startedAt = Date.now();
    const ids = [...(await this.opencode.listModels(tier))].sort((a, b) => a.localeCompare(b));
    const models = await this.probeAll(tier, apiKey, ids);
    const snapshot: AvailabilitySnapshot = { tier, checkedAt: new Date(), models };
    this.snapshots.set(tier, snapshot);
    const ko = models.filter((m) => !m.ok);
    this.logger.log(
      `Disponibilità ${tier}: ${models.length - ko.length}/${models.length} modelli serviti in ${Math.round((Date.now() - startedAt) / 1000)}s` +
        (ko.length ? ` — non serviti: ${ko.map((m) => `${m.modelId} (${m.status})`).join(', ')}` : ''),
    );
    return snapshot;
  }

  /** Sonda tutti i modelli con un pool di `PROBE_CONCURRENCY` lavoratori. */
  private async probeAll(
    tier: OpencodeTier,
    apiKey: string,
    ids: string[],
  ): Promise<ModelAvailability[]> {
    const out: ModelAvailability[] = new Array(ids.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        const index = next++;
        const modelId = ids[index];
        const probe = await this.opencode.probeModel(tier, apiKey, modelId);
        out[index] = probe.ok
          ? { modelId, ok: true, status: null, detail: null }
          : { modelId, ok: false, status: probe.status, detail: probe.detail };
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, ids.length) }, () => worker()),
    );
    return out;
  }
}
