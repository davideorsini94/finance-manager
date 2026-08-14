import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BankConnectionStatus,
  BankSyncTrigger,
  NotificationType,
  Prisma,
  StagedTxStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { sanitizeExternalText } from '../common/utils/sanitize-text';
import { NotificationsService } from '../notifications/notifications.service';
import { CATEGORY_BATCH_SIZE, CategoryAiService } from '../imports/category-ai.service';
import { BANK_PROVIDER, type BankProviderPort } from './bank-provider.port';
import { BankSyncConfigService } from './bank-sync-config.service';
import { buildCategoryMatchKey } from './category-match-key';
import { BankProviderError } from './enable-banking.client';
import { TransferMatcherService } from './transfer-matcher.service';
import {
  BOOKED_STATUS,
  computeDedupHash,
  descriptionsLooselyMatch,
  normalizeForCompare,
  parseIsoDateOnly,
  signedAmountCents,
  toIsoDateOnly,
} from './transaction-parse';

/**
 * Quota di sincronizzazioni **manuali** per utente al giorno. Vive in DB
 * (`BankSyncRun`) e non nel throttler: dietro il Funnel `req.ip` è spoofabile
 * via X-Forwarded-For. I run `cron` e `auto` non la consumano.
 */
export const MANUAL_SYNC_DAILY_LIMIT = 4;

/** Sovrapposizione sul cursore incrementale: le banche ricontabilizzano. */
const OVERLAP_DAYS = 7;

/** Finestra del match fuzzy contro le transazioni inserite a mano. */
const FUZZY_WINDOW_DAYS = 3;

/** Preavviso sulla scadenza del consenso PSD2. */
const CONSENT_WARNING_DAYS = 7;

const DESCRIPTION_MAX_LEN = 200;
const COUNTERPARTY_MAX_LEN = 140;

/** Le liste `IN (...)` non vanno lasciate crescere senza limite. */
const HASH_LOOKUP_CHUNK = 500;

/**
 * Tetto di righe categorizzate per proprietario a ogni sync. Le righe rimaste
 * senza suggerimento vengono ritentate al sync successivo (retry naturale),
 * quindi il tetto rallenta al massimo il recupero di un arretrato.
 */
const CATEGORIZE_MAX_ROWS = 300;

/**
 * Confidenza dei suggerimenti presi dalla memoria (`CategoryMemory`): non è una
 * stima del modello ma una scelta già fatta dall'utente su un movimento dello
 * stesso tipo, quindi vale più di qualunque risposta dell'LLM.
 */
const MEMORY_CONFIDENCE = 0.99;

/** Righe aggiornate per transazione quando si applica la memoria. */
const MEMORY_UPDATE_CHUNK = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Esito della sincronizzazione di un singolo conto collegato. */
export interface SyncResult {
  linkId: string;
  accountId: string;
  accountName: string;
  /** Righe contabilizzate scaricate dalla banca. */
  fetched: number;
  /** Righe nuove messe in coda di revisione (`pending_review`). */
  staged: number;
  /** Righe riconosciute come già viste (staging, transazioni confermate, match fuzzy). */
  duplicates: number;
  /** Righe scartate perché in una valuta diversa da quella del conto. */
  skippedCurrency: number;
  error: string | null;
}

export interface SyncRunResult {
  results: SyncResult[];
  /** Sincronizzazioni manuali ancora disponibili oggi, dopo questa chiamata. */
  quotaRemaining: number;
}

export interface SyncLinkResult {
  result: SyncResult;
  quotaRemaining: number;
}

const LINK_INCLUDE = {
  account: { select: { id: true, name: true } },
  connection: {
    select: {
      id: true,
      userId: true,
      status: true,
      providerConsentId: true,
      consentExpiresAt: true,
      institutionName: true,
    },
  },
} satisfies Prisma.BankAccountLinkInclude;

type LinkForSync = Prisma.BankAccountLinkGetPayload<{ include: typeof LINK_INCLUDE }>;

/** Riga normalizzata, pronta per lo staging (prima dei controlli di dedup). */
interface StagedCandidate {
  dedupHash: string;
  providerTxId: string | null;
  bookingDate: Date | null;
  valueDate: Date | null;
  effectiveDate: Date;
  amountCents: bigint;
  currency: string;
  description: string | null;
  counterparty: string | null;
  raw: unknown;
}

interface LinkOutcome {
  result: SyncResult;
  /** Proprietario della connessione: è chi riceve la notifica di revisione. */
  ownerId: string;
  /** Righe scartate perché prive sia di booking_date sia di value_date. */
  invalid: number;
}

/**
 * Motore di sincronizzazione: scarica i movimenti contabilizzati dalla banca e
 * li mette in **staging** (`BankStagedTransaction`), senza mai creare
 * transazioni reali — la conferma resta un gesto esplicito dell'utente
 * (Fase 4).
 *
 * Tre modi di partire:
 *  - `cron` alle 06:00, su tutti i collegamenti attivi;
 *  - `manual`, dagli endpoint `POST bank-sync/sync[/links/:id]`, con quota
 *    giornaliera per-utente persistita in DB;
 *  - `auto`, una volta sola subito dopo la creazione di un collegamento.
 *
 * Ogni esecuzione lascia una riga `BankSyncRun` (chi, quando, come è andata).
 */
@Injectable()
export class SyncEngineService {
  private readonly logger = new Logger(SyncEngineService.name);

  /**
   * Proprietari con una categorizzazione già in volo. La categorizzazione gira
   * staccata dalla richiesta HTTP e può durare minuti: senza questo guard due
   * sync ravvicinati (o il cron sopra un sync manuale) metterebbero in coda due
   * giri sulle stesse righe, raddoppiando il lavoro dell'LLM. Chi trova il
   * posto occupato salta: le righe scoperte le prende il sync successivo.
   */
  private readonly categorizeInFlight = new Set<string>();

  /**
   * Coda globale delle categorizzazioni: una alla volta in tutto il processo.
   * Il modello è uno solo e gira su CPU — farne partire due in parallelo (il
   * cron notturno tocca tutti gli utenti) le rallenta entrambe invece di
   * anticipare qualcosa. La coda non cresce: chi è già dentro
   * `categorizeInFlight` non viene riaccodato.
   */
  private categorizeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
    private readonly notifications: NotificationsService,
    private readonly config: BankSyncConfigService,
    private readonly categoryAi: CategoryAiService,
    private readonly transferMatcher: TransferMatcherService,
    @Inject(BANK_PROVIDER) private readonly provider: BankProviderPort,
  ) {}

  // ------------------------------------------------------------------- entry

  /**
   * Sincronizzazione notturna di tutti i collegamenti attivi. Un
   * `BankSyncRun` per utente; dentro, i link sono raggruppati per connessione
   * così le chiamate verso la stessa banca restano in fila.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async syncAll(): Promise<void> {
    const { hasCredentials } = await this.config.getStatus();
    if (!hasCredentials) {
      this.logger.log('Sync bancario saltato: credenziali Enable Banking non configurate.');
      return;
    }

    const links = await this.findLinks({
      syncEnabled: true,
      connection: {
        status: BankConnectionStatus.linked,
        providerConsentId: { not: null },
      },
    });
    if (links.length === 0) return;

    for (const [userId, userLinks] of groupBy(links, (l) => l.connection.userId)) {
      try {
        await this.runSync(userId, BankSyncTrigger.cron, userLinks);
      } catch (e) {
        // Un utente in errore non deve fermare gli altri.
        this.logger.error(`Sync notturno fallito per l'utente ${userId}: ${(e as Error).message}`);
      }
    }
  }

  /** Tutti i conti collegati dell'utente (connessioni di sua proprietà). */
  async syncUser(userId: string, trigger: BankSyncTrigger): Promise<SyncRunResult> {
    const links = await this.findLinks({ syncEnabled: true, connection: { userId } });
    return this.runSync(userId, trigger, links);
  }

  /** Un singolo conto collegato: serve il permesso di scrittura sul conto app. */
  async syncLink(
    linkId: string,
    userId: string,
    trigger: BankSyncTrigger,
  ): Promise<SyncLinkResult> {
    const link = await this.prisma.bankAccountLink.findUnique({
      where: { id: linkId },
      include: LINK_INCLUDE,
    });
    if (!link) throw new NotFoundException('Conto collegato non trovato.');
    // Stessa regola delle transazioni: chi può scrivere sul conto può sincronizzarlo.
    await this.policy.assertWrite(userId, link.accountId);
    if (!link.syncEnabled) {
      throw new BadRequestException(
        'La sincronizzazione è disattivata per questo conto: riattivala dal collegamento bancario.',
      );
    }

    const { results, quotaRemaining } = await this.runSync(userId, trigger, [link]);
    return { result: results[0], quotaRemaining };
  }

  /** Conteggio della coda di revisione sui conti su cui l'utente può scrivere. */
  async reviewCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.bankStagedTransaction.count({
      where: {
        status: StagedTxStatus.pending_review,
        link: { account: this.policy.writableAccountsWhere(userId) },
      },
    });
    return { count };
  }

  // ------------------------------------------------------------- esecuzione

  /**
   * Esegue il sync dei link indicati dentro un `BankSyncRun`.
   *
   * Se non c'è niente da sincronizzare non si crea nessun run (e la quota
   * manuale resta intatta: non ha senso "spendere" un giro a vuoto).
   */
  private async runSync(
    userId: string,
    trigger: BankSyncTrigger,
    links: LinkForSync[],
  ): Promise<SyncRunResult> {
    const manualUsed =
      trigger === BankSyncTrigger.manual ? await this.assertManualQuota(userId) : 0;

    if (links.length === 0) {
      return {
        results: [],
        quotaRemaining: Math.max(MANUAL_SYNC_DAILY_LIMIT - manualUsed, 0),
      };
    }

    const run = await this.prisma.bankSyncRun.create({ data: { userId, trigger } });
    const quotaRemaining =
      trigger === BankSyncTrigger.manual
        ? Math.max(MANUAL_SYNC_DAILY_LIMIT - manualUsed - 1, 0)
        : Math.max(MANUAL_SYNC_DAILY_LIMIT - manualUsed, 0);

    const results: SyncResult[] = [];
    /** Nuove righe da rivedere, per proprietario della connessione. */
    const newByOwner = new Map<string, number>();
    let invalid = 0;

    try {
      // Un gruppo per connessione: le chiamate verso la stessa banca (stesso
      // consenso, stesso rate limit) restano sequenziali.
      for (const [, connectionLinks] of groupBy(links, (l) => l.connectionId)) {
        for (const link of connectionLinks) {
          const outcome = await this.syncOneLink(link);
          results.push(outcome.result);
          invalid += outcome.invalid;
          if (outcome.result.staged > 0) {
            newByOwner.set(
              outcome.ownerId,
              (newByOwner.get(outcome.ownerId) ?? 0) + outcome.result.staged,
            );
          }
        }
      }

      // Arricchimento della coda: giroconti accoppiati (qui) + categoria
      // proposta (staccata, prosegue dopo la risposta HTTP). Si fa **per
      // proprietario della connessione** (le categorie sono per-utente) e su
      // tutti i suoi link, non solo su quelli appena sincronizzati: così le
      // righe rimaste indietro vengono recuperate.
      for (const ownerId of new Set(links.map((l) => l.connection.userId))) {
        await this.enrichOwnerQueue(ownerId);
      }

      for (const [ownerId, count] of newByOwner) {
        // Una notifica che fallisce (SMTP giù, ecc.) non deve trasformare un
        // sync riuscito in un errore per il chiamante.
        await this.notifyReview(ownerId, count).catch((e) =>
          this.logger.warn(`Notifica di revisione non inviata: ${(e as Error).message}`),
        );
      }
    } finally {
      // Il run va chiuso anche se qualcosa esplode fuori dal try per-link,
      // altrimenti resta "in corso" per sempre.
      await this.prisma.bankSyncRun
        .update({
          where: { id: run.id },
          data: {
            finishedAt: new Date(),
            stats: buildRunStats(results, invalid) as Prisma.InputJsonValue,
          },
        })
        .catch((e) =>
          this.logger.warn(`Chiusura del run ${run.id} fallita: ${(e as Error).message}`),
        );
    }

    return { results, quotaRemaining };
  }

  /**
   * Sincronizza un conto collegato. Non lancia mai: gli errori finiscono in
   * `result.error` così gli altri link del run proseguono.
   */
  private async syncOneLink(link: LinkForSync): Promise<LinkOutcome> {
    const result: SyncResult = {
      linkId: link.id,
      accountId: link.accountId,
      accountName: link.account.name,
      fetched: 0,
      staged: 0,
      duplicates: 0,
      skippedCurrency: 0,
      error: null,
    };
    const outcome: LinkOutcome = { result, ownerId: link.connection.userId, invalid: 0 };
    const now = new Date();

    // Consenso scaduto: la connessione va marcata, altrimenti il cron continua
    // a bussare alla banca ogni notte prendendo 401.
    if (link.connection.consentExpiresAt && link.connection.consentExpiresAt <= now) {
      await this.expireConnection(link.connection.id);
      result.error = `Il consenso per ${link.connection.institutionName} è scaduto: rinnova il collegamento bancario.`;
      return outcome;
    }
    if (link.connection.status !== BankConnectionStatus.linked || !link.connection.providerConsentId) {
      result.error =
        'Collegamento bancario non autorizzato: completa o rinnova l’autorizzazione presso la banca.';
      return outcome;
    }

    try {
      // Cursore incrementale con sovrapposizione; al primo sync nessun
      // `date_from`, si prende quello che la banca concede.
      const dateFrom = link.lastBookedDate
        ? toIsoDateOnly(addDays(link.lastBookedDate, -OVERLAP_DAYS))
        : undefined;
      const rows = await this.provider.fetchTransactions(link.providerAccountId, dateFrom);
      result.fetched = rows.length;

      const linkCurrency = link.currency.toUpperCase();
      const candidates: StagedCandidate[] = [];
      /** Progressivo delle righe identiche nello stesso fetch (bonifici gemelli). */
      const occurrences = new Map<string, number>();
      let maxBookingDate: Date | null = null;

      for (const row of rows) {
        // Il provider filtra già i non contabilizzati: difesa in profondità.
        if (row.status && row.status !== BOOKED_STATUS) continue;

        const currency = (row.currency || linkCurrency).toUpperCase();
        if (currency !== linkCurrency) {
          result.skippedCurrency++;
          continue;
        }

        const amountCents = signedAmountCents(row.amount, row.creditDebitIndicator);
        if (amountCents === null) {
          outcome.invalid++;
          continue;
        }

        const bookingDate = parseIsoDateOnly(row.bookingDate);
        const valueDate = parseIsoDateOnly(row.valueDate);
        const effectiveDate = bookingDate ?? valueDate;
        if (!effectiveDate) {
          // Senza nessuna data la riga non è collocabile: si scarta e si conta.
          outcome.invalid++;
          continue;
        }
        if (bookingDate && (!maxBookingDate || bookingDate > maxBookingDate)) {
          maxBookingDate = bookingDate;
        }

        // Controparte: chi incassa se stiamo pagando, chi paga se stiamo incassando.
        const counterpartyRaw = amountCents < 0n ? row.creditorName : row.debtorName;
        // Causale + controparte, sanificati subito: sono testo scritto da
        // terzi e finiscono nei prompt dell'LLM e nella chat (§5 del piano).
        const descriptionRaw = [row.remittanceInformation, counterpartyRaw]
          .filter((v) => !!v)
          .join(' ');
        const description = descriptionRaw
          ? sanitizeExternalText(descriptionRaw, DESCRIPTION_MAX_LEN) || null
          : null;
        const counterparty = sanitizeExternalText(counterpartyRaw, COUNTERPARTY_MAX_LEN) || null;

        const effectiveIso = toIsoDateOnly(effectiveDate);
        const occurrenceKey = `${effectiveIso}|${amountCents.toString()}|${normalizeForCompare(description)}`;
        const occurrence = occurrences.get(occurrenceKey) ?? 0;
        occurrences.set(occurrenceKey, occurrence + 1);

        candidates.push({
          dedupHash: computeDedupHash({
            entryReference: row.entryReference,
            effectiveDate: effectiveIso,
            amountCents,
            description,
            occurrence,
          }),
          providerTxId: row.entryReference,
          bookingDate,
          valueDate,
          effectiveDate,
          amountCents,
          currency,
          description,
          counterparty,
          raw: row.raw,
        });
      }

      await this.stageCandidates(link, candidates, result);
      // Saldo dichiarato dalla banca: serve alla riconciliazione in UI, non è
      // parte del sync vero e proprio (una banca che non lo espone non deve
      // far risultare fallito lo scaricamento dei movimenti).
      const balanceCents = await this.fetchLinkBalance(link);
      await this.touchLink(link, now, maxBookingDate, balanceCents);
    } catch (e) {
      result.error = this.describeError(e);
      this.logger.warn(
        `Sync del collegamento ${link.id} (conto ${link.accountId}) fallito: ${(e as Error).message}`,
      );
    }

    return outcome;
  }

  /**
   * Deduplica su tre livelli e inserisce lo staging.
   *
   *  (a) `@@unique([linkId, dedupHash])` + `createMany({ skipDuplicates })`: le
   *      righe già in staging non si duplicano, qualunque sia il loro stato;
   *  (b) `Transaction.bankTxId`: righe già confermate in passato, anche se lo
   *      staged è stato nel frattempo cancellato;
   *  (c) fuzzy contro le transazioni inserite **a mano** (stesso conto, stesso
   *      importo, data entro ±3 giorni): finiscono in staging con stato
   *      `duplicate`, visibili ma non confermabili.
   */
  private async stageCandidates(
    link: LinkForSync,
    candidates: StagedCandidate[],
    result: SyncResult,
  ): Promise<void> {
    if (candidates.length === 0) return;

    const confirmed = await this.findConfirmedHashes(
      link.accountId,
      candidates.map((c) => c.dedupHash),
    );
    const fresh = candidates.filter((c) => !confirmed.has(c.dedupHash));
    result.duplicates += candidates.length - fresh.length;
    if (fresh.length === 0) return;

    const fuzzy = await this.matchManualDuplicates(link.accountId, fresh);

    const pendingRows: Prisma.BankStagedTransactionCreateManyInput[] = [];
    const duplicateRows: Prisma.BankStagedTransactionCreateManyInput[] = [];
    for (const c of fresh) {
      const duplicateOfTransactionId = fuzzy.get(c.dedupHash) ?? null;
      const row: Prisma.BankStagedTransactionCreateManyInput = {
        linkId: link.id,
        providerTxId: c.providerTxId,
        dedupHash: c.dedupHash,
        bookingDate: c.bookingDate,
        valueDate: c.valueDate,
        effectiveDate: c.effectiveDate,
        amountCents: c.amountCents,
        currency: c.currency,
        description: c.description,
        counterparty: c.counterparty,
        rawJson: (c.raw ?? {}) as Prisma.InputJsonValue,
        status: duplicateOfTransactionId ? StagedTxStatus.duplicate : StagedTxStatus.pending_review,
        duplicateOfTransactionId,
      };
      (duplicateOfTransactionId ? duplicateRows : pendingRows).push(row);
    }

    let insertedPending = 0;
    if (pendingRows.length > 0) {
      const res = await this.prisma.bankStagedTransaction.createMany({
        data: pendingRows,
        skipDuplicates: true,
      });
      insertedPending = res.count;
    }
    if (duplicateRows.length > 0) {
      await this.prisma.bankStagedTransaction.createMany({
        data: duplicateRows,
        skipDuplicates: true,
      });
    }

    result.staged = insertedPending;
    // Le righe non inserite erano già in staging (livello a); i match fuzzy
    // sono duplicati per definizione, inseriti o meno.
    result.duplicates += duplicateRows.length + (pendingRows.length - insertedPending);
  }

  /** Hash già presenti su una Transaction confermata dello stesso conto. */
  private async findConfirmedHashes(accountId: string, hashes: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < hashes.length; i += HASH_LOOKUP_CHUNK) {
      const chunk = hashes.slice(i, i + HASH_LOOKUP_CHUNK);
      const rows = await this.prisma.transaction.findMany({
        where: { accountId, bankTxId: { in: chunk } },
        select: { bankTxId: true },
      });
      for (const r of rows) if (r.bankTxId) found.add(r.bankTxId);
    }
    return found;
  }

  /**
   * Match fuzzy contro le transazioni **manuali** (senza `bankTxId`): la data
   * contabile della banca non coincide con quella digitata a mano, quindi il
   * confronto esatto di `ImportsService` non basta. Una transazione può essere
   * il duplicato di una sola riga.
   */
  private async matchManualDuplicates(
    accountId: string,
    candidates: StagedCandidate[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (candidates.length === 0) return out;

    let min = candidates[0].effectiveDate;
    let max = candidates[0].effectiveDate;
    for (const c of candidates) {
      if (c.effectiveDate < min) min = c.effectiveDate;
      if (c.effectiveDate > max) max = c.effectiveDate;
    }

    const manual = await this.prisma.transaction.findMany({
      where: {
        accountId,
        bankTxId: null,
        transactionDate: {
          gte: addDays(min, -FUZZY_WINDOW_DAYS),
          lte: addDays(max, FUZZY_WINDOW_DAYS),
        },
      },
      select: { id: true, amountCents: true, transactionDate: true, description: true },
    });
    if (manual.length === 0) return out;

    const used = new Set<string>();
    for (const c of candidates) {
      const match = manual.find(
        (t) =>
          !used.has(t.id) &&
          t.amountCents === c.amountCents &&
          withinDays(t.transactionDate, c.effectiveDate, FUZZY_WINDOW_DAYS) &&
          descriptionsLooselyMatch(c.description, t.description),
      );
      if (match) {
        used.add(match.id);
        out.set(c.dedupHash, match.id);
      }
    }
    return out;
  }

  // ---------------------------------------------------- coda di revisione

  /**
   * Prepara la coda di revisione di un proprietario: accoppiamento dei
   * giroconti e categoria proposta.
   *
   * Le due cose hanno tempi diversissimi, quindi vivono in due posti diversi:
   *  - il **matcher** è solo query e aggiornamenti, resta dentro la richiesta;
   *  - la **categorizzazione** passa dall'LLM locale, che su CPU impiega minuti
   *    su una coda arretrata: girerebbe ben oltre il timeout del client (e
   *    della richiesta HTTP), quindi viene staccata.
   *
   * Nessuna delle due è indispensabile al sync: se qualcosa inciampa le righe
   * restano in coda senza suggerimento e il sync risulta comunque riuscito (il
   * ritentativo avviene al giro successivo).
   */
  private async enrichOwnerQueue(ownerId: string): Promise<void> {
    try {
      await this.transferMatcher.matchForOwner(ownerId);
    } catch (e) {
      this.logger.warn(
        `Rilevamento giroconti non riuscito per l'utente ${ownerId}: ${(e as Error).message}`,
      );
    }
    this.startCategorization(ownerId);
  }

  /**
   * Avvia la categorizzazione **staccata** dalla richiesta: nessun `await`, un
   * solo giro per proprietario alla volta (vedi `categorizeInFlight`). Stesso
   * schema del download dei modelli in `LlmModelsService.startPull`: `void` +
   * try/catch dentro, così un errore non diventa una unhandled rejection (che
   * in Node 18+ termina il processo).
   */
  private startCategorization(ownerId: string): void {
    if (this.categorizeInFlight.has(ownerId)) {
      this.logger.log(
        `Categorizzazione già in corso per l'utente ${ownerId}: saltata, riparte al prossimo sync.`,
      );
      return;
    }
    this.categorizeInFlight.add(ownerId);
    // `runCategorization` non lancia mai, quindi la catena non si rompe.
    this.categorizeChain = this.categorizeChain.then(() => this.runCategorization(ownerId));
  }

  private async runCategorization(ownerId: string): Promise<void> {
    const startedAt = Date.now();
    try {
      const done = await this.categorizeOwnerQueue(ownerId);
      if (done > 0) {
        this.logger.log(
          `Categorizzazione utente ${ownerId}: ${done} righe in ${Math.round((Date.now() - startedAt) / 1000)}s`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `Categorizzazione automatica non riuscita per l'utente ${ownerId}: ${(e as Error).message}`,
      );
    } finally {
      this.categorizeInFlight.delete(ownerId);
    }
  }

  /**
   * Categoria proposta per le righe da rivedere che non ne hanno una. Ritorna
   * quante righe hanno ricevuto un suggerimento.
   *
   * Due passaggi, nell'ordine:
   *  1. **memoria** (`CategoryMemory`): le scelte già fatte a mano dall'utente
   *     su movimenti dello stesso tipo. Costa una query e non sbaglia;
   *  2. **LLM**, solo sulle righe rimaste scoperte.
   *
   * Le `Category` sono per-utente: il lotto passato a `CategoryAiService` deve
   * quindi contenere una sola lista di categorie, quella del **proprietario
   * della connessione** (l'AI ragiona su `inputs[0].categories`).
   *
   * Il suggerimento prefilla anche `finalCategoryId`, ma solo se l'utente non
   * ha già scelto a mano: la revisione vince sempre sull'automatismo.
   */
  private async categorizeOwnerQueue(ownerId: string): Promise<number> {
    const rows = await this.prisma.bankStagedTransaction.findMany({
      where: {
        status: StagedTxStatus.pending_review,
        suggestedCategoryId: null,
        link: { connection: { userId: ownerId } },
      },
      select: {
        id: true,
        amountCents: true,
        description: true,
        counterparty: true,
        finalCategoryId: true,
      },
      orderBy: [{ effectiveDate: 'desc' }, { id: 'asc' }],
      take: CATEGORIZE_MAX_ROWS,
    });
    if (rows.length === 0) return 0;

    const remembered = await this.applyRememberedCategories(ownerId, rows);
    const pending = rows.filter((r) => !remembered.has(r.id));
    if (pending.length === 0) return remembered.size;

    // NB: `isIncome` è legacy (sempre false) → non si passa all'AI. Il tipo
    // entrata/uscita lo deduce dal segno dell'importo, come nell'import CSV.
    const owned = await this.prisma.category.findMany({
      where: { userId: ownerId },
      select: { id: true, name: true, parent: { select: { name: true } } },
    });
    if (owned.length === 0) return remembered.size;
    const categories = owned.map((c) => ({
      id: c.id,
      name: c.name,
      parentName: c.parent?.name ?? null,
    }));

    let suggested = remembered.size;
    for (let i = 0; i < pending.length; i += CATEGORY_BATCH_SIZE) {
      const slice = pending.slice(i, i + CATEGORY_BATCH_SIZE);
      // `suggestBatch` non lancia: un batch andato male ripiega sull'euristica,
      // quindi i batch successivi partono comunque.
      const suggestions = await this.categoryAi.suggestBatch(
        slice.map((r) => ({
          description: r.description ?? '',
          amountCents: r.amountCents,
          type: (r.amountCents < 0n ? 'expense' : 'income') as 'income' | 'expense',
          categories,
        })),
      );
      await this.prisma.$transaction(
        slice.map((r, j) =>
          this.prisma.bankStagedTransaction.update({
            where: { id: r.id },
            data: {
              suggestedCategoryId: suggestions[j].categoryId,
              suggestedConfidence: suggestions[j].confidence,
              ...(r.finalCategoryId === null
                ? { finalCategoryId: suggestions[j].categoryId }
                : {}),
            },
          }),
        ),
      );
      suggested += suggestions.filter((s) => s.categoryId !== null).length;
    }
    return suggested;
  }

  /**
   * Applica la memoria delle categorie: per ogni riga si calcola la chiave
   * (`buildCategoryMatchKey`) e, se l'utente ha già categorizzato a mano un
   * movimento con la stessa chiave, si riusa quella scelta senza scomodare
   * l'LLM.
   *
   * Ritorna gli id delle righe servite. Le categorie in memoria sono per
   * costruzione dell'utente (FK verso `Category`, scritta solo dopo il
   * controllo di proprietà in `BankReviewService`), quindi non serve
   * riverificarne l'ownership qui.
   */
  private async applyRememberedCategories(
    ownerId: string,
    rows: {
      id: string;
      description: string | null;
      counterparty: string | null;
      finalCategoryId: string | null;
    }[],
  ): Promise<Set<string>> {
    const applied = new Set<string>();

    const keyByRow = new Map<string, string>();
    for (const r of rows) {
      const key = buildCategoryMatchKey(r.counterparty, r.description);
      if (key) keyByRow.set(r.id, key);
    }
    if (keyByRow.size === 0) return applied;

    const memories = await this.prisma.categoryMemory.findMany({
      where: { userId: ownerId, matchKey: { in: [...new Set(keyByRow.values())] } },
      select: { matchKey: true, categoryId: true },
    });
    if (memories.length === 0) return applied;
    const categoryByKey = new Map(memories.map((m) => [m.matchKey, m.categoryId]));

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const r of rows) {
      const key = keyByRow.get(r.id);
      const categoryId = key ? categoryByKey.get(key) : undefined;
      if (!categoryId) continue;
      applied.add(r.id);
      updates.push(
        this.prisma.bankStagedTransaction.update({
          where: { id: r.id },
          data: {
            suggestedCategoryId: categoryId,
            suggestedConfidence: MEMORY_CONFIDENCE,
            ...(r.finalCategoryId === null ? { finalCategoryId: categoryId } : {}),
          },
        }),
      );
    }
    for (let i = 0; i < updates.length; i += MEMORY_UPDATE_CHUNK) {
      await this.prisma.$transaction(updates.slice(i, i + MEMORY_UPDATE_CHUNK));
    }

    if (applied.size > 0) {
      this.logger.log(
        `Memoria categorie: ${applied.size} righe assegnate senza LLM (utente ${ownerId})`,
      );
    }
    return applied;
  }

  /**
   * Saldo del conto secondo la banca, per la riconciliazione col saldo dell'app.
   *
   * Non lancia mai (il sync dei movimenti è già andato a buon fine) e scarta il
   * saldo se la valuta non è quella del link: confrontare euro con altra valuta
   * darebbe una differenza inventata.
   */
  private async fetchLinkBalance(link: LinkForSync): Promise<bigint | null> {
    try {
      const balance = await this.provider.getAccountBalance(link.providerAccountId);
      if (!balance) return null;
      if (balance.currency.toUpperCase() !== link.currency.toUpperCase()) {
        this.logger.warn(
          `Saldo ignorato per il collegamento ${link.id}: la banca lo espone in ${balance.currency}, il conto è in ${link.currency}`,
        );
        return null;
      }
      return balance.cents;
    } catch (e) {
      this.logger.warn(
        `Saldo non disponibile per il collegamento ${link.id}: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /** Aggiorna il cursore: `lastBookedDate` non torna mai indietro. */
  private async touchLink(
    link: LinkForSync,
    now: Date,
    maxBookingDate: Date | null,
    balanceCents: bigint | null,
  ): Promise<void> {
    const advance =
      maxBookingDate && (!link.lastBookedDate || maxBookingDate > link.lastBookedDate)
        ? maxBookingDate
        : undefined;
    await this.prisma.bankAccountLink.update({
      where: { id: link.id },
      data: {
        lastSyncAt: now,
        ...(advance ? { lastBookedDate: advance } : {}),
        // Il saldo si aggiorna solo se la banca ne ha dato uno usabile: quello
        // precedente resta valido finché non arriva un dato migliore.
        ...(balanceCents !== null ? { lastBalanceCents: balanceCents, lastBalanceAt: now } : {}),
      },
    });
  }

  // -------------------------------------------------------------- consenso

  /**
   * Ciclo di vita del consenso: avviso a 7 giorni dalla scadenza e notifica
   * (con passaggio a `expired`) quando è scaduto. Il rinnovo richiede una nuova
   * autorizzazione in banca, quindi l'utente va avvisato per tempo.
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async checkConsentExpiry(): Promise<void> {
    const now = new Date();
    const horizon = new Date(now.getTime() + CONSENT_WARNING_DAYS * DAY_MS);

    const expired = await this.prisma.bankConnection.findMany({
      where: {
        status: BankConnectionStatus.linked,
        consentExpiresAt: { not: null, lt: now },
      },
      select: { id: true, userId: true, institutionName: true, consentExpiresAt: true },
    });
    for (const c of expired) {
      await this.expireConnection(c.id);
      await this.notifyConsent(c, true).catch((e) =>
        this.logger.warn(`Notifica consenso scaduto non inviata: ${(e as Error).message}`),
      );
    }

    const expiring = await this.prisma.bankConnection.findMany({
      where: {
        status: BankConnectionStatus.linked,
        consentExpiresAt: { gte: now, lte: horizon },
      },
      select: { id: true, userId: true, institutionName: true, consentExpiresAt: true },
    });
    for (const c of expiring) {
      await this.notifyConsent(c, false).catch((e) =>
        this.logger.warn(`Notifica consenso in scadenza non inviata: ${(e as Error).message}`),
      );
    }

    if (expired.length > 0 || expiring.length > 0) {
      this.logger.log(
        `Consensi bancari: ${expired.length} scaduti, ${expiring.length} in scadenza entro ${CONSENT_WARNING_DAYS} giorni`,
      );
    }
  }

  /**
   * Marca il consenso come scaduto. Mai su una connessione `pending`: sarebbe
   * un rinnovo in corso, e cambiarne lo stato (e quindi `updatedAt`) farebbe
   * fallire il callback ancora atteso dalla banca.
   */
  private async expireConnection(connectionId: string): Promise<void> {
    await this.prisma.bankConnection
      .updateMany({
        where: { id: connectionId, status: { not: BankConnectionStatus.pending } },
        data: { status: BankConnectionStatus.expired },
      })
      .catch((e) =>
        this.logger.warn(
          `Impossibile marcare come scaduta la connessione ${connectionId}: ${(e as Error).message}`,
        ),
      );
  }

  private async notifyConsent(
    connection: {
      id: string;
      userId: string;
      institutionName: string;
      consentExpiresAt: Date | null;
    },
    expired: boolean,
  ): Promise<void> {
    const expiresAt = (connection.consentExpiresAt ?? new Date()).toISOString();
    // Scaduto: una sola volta per connessione. In scadenza: al massimo una
    // volta a settimana, finché l'utente non rinnova.
    const dedupKey = expired
      ? `bank-sync-consent-expired-${connection.id}`
      : `bank-sync-consent-${connection.id}-${isoWeekKey(new Date())}`;

    await this.notifications.create({
      userId: connection.userId,
      type: NotificationType.bank_sync_consent,
      title: expired
        ? `Collegamento a ${connection.institutionName} scaduto`
        : `Collegamento a ${connection.institutionName} in scadenza`,
      body: expired
        ? 'Il consenso alla banca è scaduto: rinnovalo per riprendere la sincronizzazione dei movimenti.'
        : `Il consenso alla banca scade il ${formatDateIt(expiresAt)}: rinnovalo per non interrompere la sincronizzazione.`,
      data: {
        kind: 'bank_sync_consent',
        connectionId: connection.id,
        institutionName: connection.institutionName,
        expiresAt,
        expired,
      },
      dedupKey,
    });
  }

  private async notifyReview(userId: string, count: number): Promise<void> {
    if (count <= 0) return;
    const date = toIsoDateOnly(new Date());
    await this.notifications.create({
      userId,
      type: NotificationType.bank_sync_review,
      title:
        count === 1 ? '1 nuovo movimento da rivedere' : `${count} nuovi movimenti da rivedere`,
      body: 'Controlla la coda di revisione per confermarli o ignorarli.',
      data: { kind: 'bank_sync_review', count, date },
      dedupKey: `bank-sync-review-${userId}-${date}`,
    });
  }

  // ---------------------------------------------------------------- privati

  private findLinks(where: Prisma.BankAccountLinkWhereInput): Promise<LinkForSync[]> {
    return this.prisma.bankAccountLink.findMany({
      where,
      include: LINK_INCLUDE,
      orderBy: [{ connectionId: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Quota manuale del giorno. Ritorna quante sincronizzazioni manuali sono già
   * state usate; se sono già `MANUAL_SYNC_DAILY_LIMIT` lancia un 429.
   */
  private async assertManualQuota(userId: string): Promise<number> {
    const used = await this.prisma.bankSyncRun.count({
      where: {
        userId,
        trigger: BankSyncTrigger.manual,
        startedAt: { gte: startOfToday() },
      },
    });
    if (used >= MANUAL_SYNC_DAILY_LIMIT) {
      throw new HttpException(
        `Hai esaurito le ${MANUAL_SYNC_DAILY_LIMIT} sincronizzazioni manuali di oggi: riprova domani. La sincronizzazione automatica gira comunque ogni notte.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return used;
  }

  /**
   * Messaggio d'errore da mostrare nella riga di esito. Solo messaggi nostri o
   * già sanificati: un errore imprevisto potrebbe contenere dettagli interni.
   */
  private describeError(e: unknown): string {
    if (e instanceof BankProviderError) return e.message;
    if (e instanceof HttpException) {
      const res = e.getResponse();
      if (typeof res === 'string') return res;
      const message = (res as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
      return e.message;
    }
    return 'Errore imprevisto durante la sincronizzazione: riprova più tardi.';
  }
}

function buildRunStats(results: SyncResult[], invalid: number): Record<string, unknown> {
  const sum = (pick: (r: SyncResult) => number) => results.reduce((acc, r) => acc + pick(r), 0);
  return {
    links: results.length,
    fetched: sum((r) => r.fetched),
    staged: sum((r) => r.staged),
    duplicates: sum((r) => r.duplicates),
    skippedCurrency: sum((r) => r.skippedCurrency),
    invalid,
    errors: results.filter((r) => r.error).map((r) => ({ linkId: r.linkId, error: r.error })),
  };
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function withinDays(a: Date, b: Date, days: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= days * DAY_MS;
}

/**
 * Mezzanotte UTC: la quota è "per giornata", stessa convenzione usata altrove
 * nel backend (`AdvancedReportsService`, `CcPaymentDueCron`, `LlmChatService`)
 * per non far dipendere il confine del giorno dal timezone del container.
 */
function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** `2026-W33`: chiave settimanale ISO-8601 per il dedup delle notifiche. */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function formatDateIt(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
