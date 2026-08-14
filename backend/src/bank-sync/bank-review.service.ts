import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditEntity,
  Prisma,
  StagedTxStatus,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { AuditService } from '../common/services/audit.service';
import { CategorySharingService } from '../categories/category-sharing.service';
import { TransfersService } from '../transfers/transfers.service';
import { buildCategoryMatchKey } from './category-match-key';
import {
  CONFIRM_MAX_IDS,
  type ReviewableStatus,
  type UpdateReviewItemDto,
} from './dto/bank-review.dto';
import { toIsoDateOnly } from './transaction-parse';

/**
 * Tetto delle righe restituite in una pagina di revisione. `total` riporta
 * comunque il conteggio completo, così la UI può dire "ne restano altre".
 */
const MAX_REVIEW_ITEMS = 500;

/** Vista di una riga della coda di revisione (contratto API Fase 4). */
export interface ReviewItem {
  id: string;
  linkId: string;
  accountId: string;
  accountName: string;
  accountColor: string | null;
  /** `YYYY-MM-DD`. */
  effectiveDate: string;
  /** Firmato, sempre stringa (convenzione BigInt → string). */
  amountCents: string;
  currency: string;
  description: string | null;
  counterparty: string | null;
  status: StagedTxStatus;
  suggestedType: TransactionType | null;
  suggestedConfidence: number | null;
  suggestedCategoryId: string | null;
  finalCategory: { id: string; name: string; color: string | null } | null;
  /** Altra gamba del giroconto, se la riga è accoppiata. */
  pair: {
    stagedId: string;
    accountId: string;
    accountName: string;
    effectiveDate: string;
    amountCents: string;
  } | null;
  /** Movimento già esistente di cui questa riga è il duplicato. */
  duplicateOf: {
    transactionId: string;
    description: string | null;
    transactionDate: string;
  } | null;
}

export interface ReviewListResult {
  items: ReviewItem[];
  total: number;
}

export interface ConfirmError {
  id: string;
  message: string;
}

export interface ConfirmResult {
  /** Righe staged diventate movimenti (le due gambe di un giroconto contano 2). */
  confirmed: number;
  /** Giroconti creati (una `TransfersService.create` per coppia). */
  transfers: number;
  /** Righe saltate perché non più in `pending_review`. */
  skipped: number;
  errors: ConfirmError[];
}

const REVIEW_INCLUDE = {
  link: {
    select: {
      id: true,
      accountId: true,
      account: { select: { name: true, color: true } },
    },
  },
  finalCategory: { select: { id: true, name: true, color: true } },
  duplicateOf: { select: { id: true, description: true, transactionDate: true } },
} satisfies Prisma.BankStagedTransactionInclude;

type StagedForReview = Prisma.BankStagedTransactionGetPayload<{ include: typeof REVIEW_INCLUDE }>;

type PairView = NonNullable<ReviewItem['pair']>;

/**
 * Coda di revisione dei movimenti bancari: elenco, modifiche riga per riga e
 * conferma (che è il punto in cui una riga staged diventa un movimento vero).
 *
 * ACL: una riga è visibile e modificabile da chi ha **write sul conto
 * collegato** (`AccountPolicyService`), non solo dal proprietario della
 * connessione — su un conto condiviso la revisione è di entrambi. Le categorie
 * invece sono per-utente: quella scelta deve appartenere a chi conferma.
 */
@Injectable()
export class BankReviewService {
  private readonly logger = new Logger(BankReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
    private readonly audit: AuditService,
    private readonly transfers: TransfersService,
    private readonly categorySharing: CategorySharingService,
  ) {}

  // ------------------------------------------------------------------ lista

  async list(userId: string, status: ReviewableStatus): Promise<ReviewListResult> {
    const where: Prisma.BankStagedTransactionWhereInput = {
      status,
      link: { account: this.policy.writableAccountsWhere(userId) },
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.bankStagedTransaction.findMany({
        where,
        include: REVIEW_INCLUDE,
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        take: MAX_REVIEW_ITEMS,
      }),
      this.prisma.bankStagedTransaction.count({ where }),
    ]);

    const pairs = await this.loadPairs(rows);
    return {
      items: rows.map((r) => toReviewItem(r, r.matchedStagedId ? pairs.get(r.matchedStagedId) : undefined)),
      total,
    };
  }

  // ----------------------------------------------------------- modifica riga

  async update(
    userId: string,
    id: string,
    dto: UpdateReviewItemDto,
  ): Promise<{ item: ReviewItem }> {
    const row = await this.findWritable(userId, id);

    const wantsIgnore = dto.ignore === true;
    const wantsRestore = dto.restore === true;
    const wantsPairing = dto.pairWithStagedId !== undefined;
    const wantsType = dto.type !== undefined;
    const wantsCategory = dto.categoryId !== undefined;

    if (!wantsIgnore && !wantsRestore && !wantsPairing && !wantsType && !wantsCategory) {
      throw new BadRequestException('Nessuna modifica richiesta.');
    }
    if (wantsIgnore && wantsRestore) {
      throw new BadRequestException('Non puoi ignorare e ripristinare lo stesso movimento.');
    }
    if ((wantsIgnore || wantsRestore) && (wantsPairing || wantsType)) {
      throw new BadRequestException(
        'Ignora e ripristina non si combinano con l’accoppiamento o il cambio di tipo.',
      );
    }
    if (wantsType && dto.pairWithStagedId) {
      throw new BadRequestException(
        'Un movimento accoppiato è un giroconto: non puoi anche forzarne il tipo.',
      );
    }
    if (row.status === StagedTxStatus.confirmed) {
      throw new BadRequestException('Il movimento è già stato confermato: non è più modificabile.');
    }
    if (row.status === StagedTxStatus.error) {
      throw new BadRequestException('Il movimento è in errore: non è modificabile.');
    }

    if (wantsCategory) await this.setFinalCategory(userId, row, dto.categoryId ?? null);
    if (wantsPairing) {
      const target = dto.pairWithStagedId ?? null;
      if (target === null) await this.unpair(row);
      else await this.pairManually(userId, row, target);
    }
    if (wantsType) {
      // Il tipo si applica dopo l'eventuale separazione della coppia, quindi
      // sullo stato aggiornato (`forceType` rifiuta le righe accoppiate).
      await this.forceType(wantsPairing ? await this.findWritable(userId, id) : row, dto.type!);
    }
    if (wantsIgnore) await this.ignore(row);
    if (wantsRestore) await this.restore(row);

    return { item: await this.reload(id) };
  }

  /** Categoria finale. `null` la svuota; altrimenti dev'essere una categoria dell'utente. */
  private async setFinalCategory(
    userId: string,
    row: StagedForReview,
    categoryId: string | null,
  ): Promise<void> {
    if (categoryId) await this.assertCategoryOwned(userId, categoryId);
    await this.prisma.bankStagedTransaction.update({
      where: { id: row.id },
      data: { finalCategoryId: categoryId },
    });
    // Scelta esplicita dell'utente: la si impara subito, così il prossimo sync
    // categorizza da solo i movimenti dello stesso tipo. Lo svuotamento
    // (`null`) non insegna niente: non dice quale categoria sarebbe giusta.
    if (categoryId) await this.rememberCategory(userId, row, categoryId);
  }

  private async forceType(row: StagedForReview, type: 'income' | 'expense'): Promise<void> {
    if (row.status !== StagedTxStatus.pending_review) {
      throw new BadRequestException('Puoi cambiare il tipo solo ai movimenti ancora da rivedere.');
    }
    if (row.matchedStagedId) {
      throw new BadRequestException(
        'Il movimento è accoppiato come giroconto: separa prima la coppia.',
      );
    }
    await this.prisma.bankStagedTransaction.update({
      where: { id: row.id },
      data: {
        suggestedType: type === 'income' ? TransactionType.income : TransactionType.expense,
      },
    });
  }

  /**
   * Accoppiamento manuale. Le due righe devono stare su conti diversi (su cui
   * l'utente può scrivere), avere importi esattamente opposti e la stessa
   * valuta: sono le due gambe dello stesso movimento.
   */
  private async pairManually(
    userId: string,
    row: StagedForReview,
    otherId: string,
  ): Promise<void> {
    if (otherId === row.id) {
      throw new BadRequestException('Non puoi accoppiare un movimento con se stesso.');
    }
    if (row.status !== StagedTxStatus.pending_review) {
      throw new BadRequestException('Puoi accoppiare solo i movimenti ancora da rivedere.');
    }

    const other = await this.findWritable(userId, otherId);
    if (other.status !== StagedTxStatus.pending_review) {
      throw new BadRequestException('Il movimento da accoppiare non è più in revisione.');
    }
    if (other.link.accountId === row.link.accountId) {
      throw new BadRequestException('Un giroconto collega due conti diversi.');
    }
    if (other.currency.toUpperCase() !== row.currency.toUpperCase()) {
      throw new BadRequestException('I due movimenti sono in valute diverse.');
    }
    if (row.amountCents === 0n || other.amountCents !== -row.amountCents) {
      throw new BadRequestException(
        'Le due gambe di un giroconto devono avere importi esattamente opposti.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Eventuali accoppiamenti precedenti (di entrambe e dei loro partner)
      // vanno sciolti prima, altrimenti resterebbero puntatori pendenti.
      await clearPairs(tx, [row.id, other.id, row.matchedStagedId, other.matchedStagedId]);
      // Scritture condizionali (come nel matcher automatico): se una delle due
      // righe è stata confermata o ignorata tra la lettura e qui, la
      // transazione salta invece di agganciare una coppia a una riga morta.
      for (const [id, partnerId] of [
        [row.id, other.id],
        [other.id, row.id],
      ] as const) {
        const paired = await tx.bankStagedTransaction.updateMany({
          where: { id, status: StagedTxStatus.pending_review },
          data: { matchedStagedId: partnerId, suggestedType: TransactionType.transfer },
        });
        if (paired.count !== 1) {
          throw new BadRequestException(
            'Uno dei due movimenti non è più in revisione: aggiorna la pagina e riprova.',
          );
        }
      }
    });
  }

  /** Separa la coppia: entrambe tornano al tipo derivato dal segno (`suggestedType` a null). */
  private async unpair(row: StagedForReview): Promise<void> {
    if (!row.matchedStagedId) {
      // Niente da sciogliere: si ripulisce solo un eventuale puntatore
      // pendente di un'altra riga (mezza coppia), senza toccare questa —
      // altrimenti si perderebbe un tipo forzato a mano.
      await this.prisma.bankStagedTransaction.updateMany({
        where: { matchedStagedId: row.id },
        data: { matchedStagedId: null, suggestedType: null },
      });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await clearPairs(tx, [row.id, row.matchedStagedId]);
    });
  }

  private async ignore(row: StagedForReview): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Spaiare PRIMA: una riga ignorata non deve restare agganciata a una
      // riga ancora in coda (la controparte tornerebbe confermabile da sola).
      await clearPairs(tx, [row.id, row.matchedStagedId]);
      await tx.bankStagedTransaction.update({
        where: { id: row.id },
        data: { status: StagedTxStatus.ignored },
      });
    });
  }

  private async restore(row: StagedForReview): Promise<void> {
    if (row.status !== StagedTxStatus.ignored && row.status !== StagedTxStatus.duplicate) {
      throw new BadRequestException(
        'Puoi ripristinare solo i movimenti ignorati o segnati come duplicati.',
      );
    }
    await this.prisma.bankStagedTransaction.update({
      where: { id: row.id },
      data: {
        status: StagedTxStatus.pending_review,
        // Ripristinare un duplicato significa "non lo è": il riferimento al
        // movimento gemello va tolto, altrimenti la riga resta marchiata.
        duplicateOfTransactionId: null,
      },
    });
  }

  // --------------------------------------------------------------- conferma

  /**
   * Conferma multipla. Ogni riga è indipendente: un errore su una non ferma le
   * altre, finisce in `errors[]`.
   *
   * Le coppie di giroconto si confermano insieme — se `ids` contiene una sola
   * gamba, l'altra viene inclusa d'ufficio: registrare mezzo giroconto
   * lascerebbe i saldi sbilanciati.
   */
  async confirm(userId: string, ids: string[]): Promise<ConfirmResult> {
    const unique = [...new Set(ids)];
    if (unique.length > CONFIRM_MAX_IDS) {
      throw new BadRequestException(
        `Puoi confermare al massimo ${CONFIRM_MAX_IDS} movimenti per volta.`,
      );
    }

    const out: ConfirmResult = { confirmed: 0, transfers: 0, skipped: 0, errors: [] };
    const rows = await this.prisma.bankStagedTransaction.findMany({
      where: { id: { in: unique } },
      include: REVIEW_INCLUDE,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      if (!byId.has(id)) out.errors.push({ id, message: 'Movimento non trovato.' });
    }

    // Controparti mancanti: caricate a parte e trattate come parte della coppia.
    const missing = rows
      .map((r) => r.matchedStagedId)
      .filter((v): v is string => !!v && !byId.has(v));
    if (missing.length > 0) {
      const partners = await this.prisma.bankStagedTransaction.findMany({
        where: { id: { in: missing } },
        include: REVIEW_INCLUDE,
      });
      for (const p of partners) byId.set(p.id, p);
    }

    // Ordine deterministico: dal movimento più vecchio al più recente.
    const ordered = rows
      .slice()
      .sort(
        (a, b) =>
          a.effectiveDate.getTime() - b.effectiveDate.getTime() || (a.id < b.id ? -1 : 1),
      );

    const processed = new Set<string>();
    for (const row of ordered) {
      if (processed.has(row.id)) continue;
      processed.add(row.id);

      try {
        await this.policy.assertWrite(userId, row.link.accountId);
      } catch {
        out.errors.push({
          id: row.id,
          message: 'Non hai i permessi di scrittura sul conto di questo movimento.',
        });
        continue;
      }
      if (row.status !== StagedTxStatus.pending_review) {
        out.skipped++;
        continue;
      }

      try {
        if (row.matchedStagedId) {
          const partner = byId.get(row.matchedStagedId);
          processed.add(row.matchedStagedId);
          await this.confirmPair(userId, row, partner);
          out.confirmed += 2;
          out.transfers++;
        } else {
          await this.confirmSingle(userId, row);
          out.confirmed++;
        }
      } catch (e) {
        out.errors.push({ id: row.id, message: describeError(e) });
      }
    }

    this.logger.log(
      `Conferma revisione bancaria (utente ${userId}): ${out.confirmed} movimenti, ${out.transfers} giroconti, ${out.skipped} saltati, ${out.errors.length} errori`,
    );
    return out;
  }

  /**
   * Coppia → un giroconto vero, con la semantica di `TransfersService.create`
   * (due gambe collegate da `transferPairId`, saldi di entrambi i conti,
   * audit). Il `bankTxId` si scrive dopo: il DTO del giroconto non lo prevede,
   * ma senza di esso la deduplica dei sync successivi non reggerebbe.
   */
  private async confirmPair(
    userId: string,
    row: StagedForReview,
    partner: StagedForReview | undefined,
  ): Promise<void> {
    if (!partner) {
      throw new BadRequestException(
        'L’altra gamba del giroconto non esiste più: separa la coppia e riprova.',
      );
    }
    if (partner.matchedStagedId !== row.id || partner.status !== StagedTxStatus.pending_review) {
      throw new BadRequestException(
        'La coppia di giroconto non è coerente: separala e riprova dalla revisione.',
      );
    }
    // `assertWrite` parla inglese ("Account not found"): qui il messaggio
    // finisce in `errors[]` sotto gli occhi dell'utente, quindi lo riscriviamo.
    try {
      await this.policy.assertWrite(userId, partner.link.accountId);
    } catch {
      throw new BadRequestException(
        'Non hai i permessi di scrittura sul conto dell’altra gamba del giroconto.',
      );
    }

    const outLeg = row.amountCents < 0n ? row : partner;
    const inLeg = row.amountCents < 0n ? partner : row;
    if (outLeg.amountCents >= 0n || inLeg.amountCents <= 0n) {
      throw new BadRequestException(
        'Le due gambe del giroconto devono avere importi di segno opposto.',
      );
    }
    const amount = -outLeg.amountCents;
    if (amount !== inLeg.amountCents) {
      throw new BadRequestException('Le due gambe del giroconto hanno importi diversi.');
    }
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BadRequestException('Importo troppo grande per essere registrato come giroconto.');
    }
    // Verifica qui (e non solo dentro TransfersService) per dare un messaggio
    // in italiano coerente con quello delle righe singole.
    if (outLeg.finalCategoryId) await this.assertCategoryOwned(userId, outLeg.finalCategoryId);

    // Claim atomico delle due gambe PRIMA di creare il giroconto. È lo stesso
    // guard di `confirmSingle`, ma qui non può vivere dentro la transazione
    // della scrittura: `TransfersService.create` apre la propria. Senza claim,
    // due conferme concorrenti della stessa coppia creerebbero due giroconti e
    // i saldi conterebbero il doppio.
    await this.claimPair(outLeg, inLeg);

    let created: { from: { id: string }; to: { id: string } };
    try {
      created = await this.transfers.create(userId, {
        fromAccountId: outLeg.link.accountId,
        toAccountId: inLeg.link.accountId,
        // Il DTO del giroconto vuole l'importo POSITIVO: il segno lo mette il service.
        amountCents: Number(amount),
        date: toIsoDateOnly(outLeg.effectiveDate),
        arrivalDate: toIsoDateOnly(inLeg.effectiveDate),
        description: outLeg.description ?? undefined,
        // La categoria del giroconto è quella della gamba in uscita (se scelta);
        // `TransfersService` verifica che appartenga a chi conferma.
        categoryId: outLeg.finalCategoryId ?? undefined,
      });
    } catch (e) {
      // Nessun giroconto creato: il claim va sciolto, altrimenti le due righe
      // resterebbero `confirmed` senza movimento dietro.
      await this.releaseClaim(outLeg.id, inLeg.id);
      throw e;
    }

    // La categoria del giroconto è quella della gamba in uscita: si impara su
    // quella riga, che è anche l'unica su cui l'utente l'ha scelta.
    if (outLeg.finalCategoryId) {
      await this.rememberCategory(userId, outLeg, outLeg.finalCategoryId);
    }

    await this.prisma.$transaction([
      this.prisma.transaction.update({
        where: { id: created.from.id },
        data: { bankTxId: outLeg.dedupHash },
      }),
      this.prisma.transaction.update({
        where: { id: created.to.id },
        data: { bankTxId: inLeg.dedupHash },
      }),
      this.prisma.bankStagedTransaction.update({
        where: { id: outLeg.id },
        data: { transactionId: created.from.id },
      }),
      this.prisma.bankStagedTransaction.update({
        where: { id: inLeg.id },
        data: { transactionId: created.to.id },
      }),
    ]);
  }

  /**
   * Porta entrambe le gambe a `confirmed` in una sola transazione, e solo se
   * sono ancora `pending_review` **e** ancora accoppiate tra loro. Chi perde la
   * gara non crea nessun giroconto: meglio una riga da riconfermare che un
   * movimento contato due volte.
   */
  private async claimPair(outLeg: StagedForReview, inLeg: StagedForReview): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const [leg, partnerId] of [
        [outLeg, inLeg.id],
        [inLeg, outLeg.id],
      ] as const) {
        const claimed = await tx.bankStagedTransaction.updateMany({
          where: {
            id: leg.id,
            status: StagedTxStatus.pending_review,
            matchedStagedId: partnerId,
          },
          data: { status: StagedTxStatus.confirmed },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(
            'Il giroconto è già stato confermato da un’altra sessione.',
          );
        }
      }
    });
  }

  /**
   * Scioglie un claim rimasto senza giroconto. Tocca solo le righe ancora
   * prive di `transactionId`: una conferma andata a buon fine non viene mai
   * riaperta.
   */
  private async releaseClaim(...ids: string[]): Promise<void> {
    await this.prisma.bankStagedTransaction
      .updateMany({
        where: { id: { in: ids }, status: StagedTxStatus.confirmed, transactionId: null },
        data: { status: StagedTxStatus.pending_review },
      })
      .catch((e) =>
        this.logger.error(
          `Rilascio della coppia ${ids.join('/')} non riuscito: ${(e as Error).message}`,
        ),
      );
  }

  /**
   * Riga singola → movimento, con la stessa semantica di
   * `TransactionsService.create`: importo firmato, saldo del conto aggiornato,
   * audit e replica della categoria sui membri del conto condiviso.
   *
   * NB: i conti collegabili sono solo `checking` (vincolo di Fase 2), quindi
   * qui non serve il percorso carta di credito
   * (`CreditCardsService.generateChargeForCcTx`). Se in futuro si potranno
   * collegare le carte, questo è il punto da estendere.
   */
  private async confirmSingle(userId: string, row: StagedForReview): Promise<void> {
    // `suggestedType` vale solo se l'utente/AI ha forzato entrata o uscita;
    // `transfer` senza controparte è uno stato incoerente → si torna al segno.
    const type =
      row.suggestedType === TransactionType.income || row.suggestedType === TransactionType.expense
        ? row.suggestedType
        : row.amountCents < 0n
          ? TransactionType.expense
          : TransactionType.income;

    const categoryId = row.finalCategoryId;
    if (categoryId) await this.assertCategoryOwned(userId, categoryId);

    const created = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          accountId: row.link.accountId,
          // Autore del movimento = chi conferma, non il proprietario della
          // connessione: è la stessa regola delle transazioni inserite a mano.
          userId,
          amountCents: row.amountCents,
          type,
          categoryId,
          // Già sanificata all'ingestione (sanitizeExternalText).
          description: row.description,
          transactionDate: row.effectiveDate,
          bankTxId: row.dedupHash,
          isPending: false,
        },
      });
      await tx.account.update({
        where: { id: row.link.accountId },
        data: { balanceCents: { increment: row.amountCents } },
      });
      // Guard sullo stato: se qualcun altro ha confermato la riga nel
      // frattempo, la transazione viene annullata invece di creare un doppione.
      const marked = await tx.bankStagedTransaction.updateMany({
        where: { id: row.id, status: StagedTxStatus.pending_review },
        data: { status: StagedTxStatus.confirmed, transactionId: transaction.id },
      });
      if (marked.count !== 1) {
        throw new BadRequestException('Il movimento è già stato confermato da un’altra sessione.');
      }
      return transaction;
    });

    void this.audit.log(userId, AuditAction.create, AuditEntity.transaction, created.id, {
      accountId: row.link.accountId,
      amountCents: row.amountCents.toString(),
      type,
      source: 'bank_sync',
      stagedId: row.id,
    });
    // Conto condiviso: la categoria usata viene clonata agli altri membri così
    // la ritrovano nel loro picker. Fire-and-forget, come in TransactionsService.
    if (categoryId) {
      void this.categorySharing.replicateCategoryToAccountMembers(
        row.link.accountId,
        categoryId,
        userId,
      );
      // Categoria portata fino alla conferma: vale come scelta dell'utente
      // anche se arrivava da un suggerimento (l'ha comunque accettata).
      await this.rememberCategory(userId, row, categoryId);
    }
  }

  // ---------------------------------------------------------------- privati

  /** Riga staged + controllo di scrittura sul conto collegato. */
  private async findWritable(userId: string, id: string): Promise<StagedForReview> {
    const row = await this.prisma.bankStagedTransaction.findUnique({
      where: { id },
      include: REVIEW_INCLUDE,
    });
    if (!row) throw new NotFoundException('Movimento da rivedere non trovato.');
    await this.policy.assertWrite(userId, row.link.accountId);
    return row;
  }

  /**
   * Memoria delle categorie: registra "movimenti fatti così → questa
   * categoria" per chi sta agendo, così il prossimo sync li categorizza da solo
   * senza passare dall'LLM (vedi `SyncEngineService.applyRememberedCategories`).
   *
   * L'ultima scelta vince (`categoryId` sovrascritto): se l'utente cambia idea
   * su un fornitore, la memoria si aggiorna invece di restare indietro.
   * `timesUsed` conta le riconferme.
   *
   * Non lancia mai: imparare è un di più, non deve far fallire la modifica o la
   * conferma che l'utente ha appena chiesto (la categoria potrebbe anche essere
   * stata cancellata nel frattempo, e la FK protesterebbe).
   */
  private async rememberCategory(
    userId: string,
    row: { counterparty: string | null; description: string | null },
    categoryId: string,
  ): Promise<void> {
    const matchKey = buildCategoryMatchKey(row.counterparty, row.description);
    // Senza una chiave significativa non si impara niente: memorizzare il
    // rumore vorrebbe dire categorizzare a caso movimenti scollegati.
    if (!matchKey) return;

    try {
      await this.prisma.categoryMemory.upsert({
        where: { userId_matchKey: { userId, matchKey } },
        create: { userId, matchKey, categoryId },
        update: { categoryId, timesUsed: { increment: 1 }, lastUsedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(
        `Memoria categorie non aggiornata per "${matchKey}" (utente ${userId}): ${(e as Error).message}`,
      );
    }
  }

  private async assertCategoryOwned(userId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { userId: true },
    });
    if (!category || category.userId !== userId) {
      throw new NotFoundException('Categoria non trovata tra le tue.');
    }
  }

  private async reload(id: string): Promise<ReviewItem> {
    const row = await this.prisma.bankStagedTransaction.findUnique({
      where: { id },
      include: REVIEW_INCLUDE,
    });
    if (!row) throw new NotFoundException('Movimento da rivedere non trovato.');
    const pairs = await this.loadPairs([row]);
    return toReviewItem(row, row.matchedStagedId ? pairs.get(row.matchedStagedId) : undefined);
  }

  /**
   * Controparti dei giroconti. `matchedStagedId` è una colonna semplice (nessuna
   * self-relation nello schema), quindi si caricano con una query dedicata.
   */
  private async loadPairs(rows: { matchedStagedId: string | null }[]): Promise<Map<string, PairView>> {
    const ids = [...new Set(rows.map((r) => r.matchedStagedId).filter((v): v is string => !!v))];
    const out = new Map<string, PairView>();
    if (ids.length === 0) return out;

    const partners = await this.prisma.bankStagedTransaction.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        effectiveDate: true,
        amountCents: true,
        link: { select: { accountId: true, account: { select: { name: true } } } },
      },
    });
    for (const p of partners) {
      out.set(p.id, {
        stagedId: p.id,
        accountId: p.link.accountId,
        accountName: p.link.account.name,
        effectiveDate: toIsoDateOnly(p.effectiveDate),
        amountCents: p.amountCents.toString(),
      });
    }
    return out;
  }
}

/**
 * Azzera il pairing di tutte le righe indicate **e** di chiunque le stia
 * puntando: è il pattern usato per `transferPairId` prima delle delete, qui
 * serve a non lasciare mezze coppie.
 */
async function clearPairs(
  tx: Prisma.TransactionClient,
  ids: (string | null)[],
): Promise<void> {
  const targets = [...new Set(ids.filter((v): v is string => !!v))];
  if (targets.length === 0) return;
  await tx.bankStagedTransaction.updateMany({
    where: { OR: [{ id: { in: targets } }, { matchedStagedId: { in: targets } }] },
    data: { matchedStagedId: null, suggestedType: null },
  });
}

function toReviewItem(row: StagedForReview, pair: PairView | undefined): ReviewItem {
  return {
    id: row.id,
    linkId: row.linkId,
    accountId: row.link.accountId,
    accountName: row.link.account.name,
    accountColor: row.link.account.color,
    effectiveDate: toIsoDateOnly(row.effectiveDate),
    amountCents: row.amountCents.toString(),
    currency: row.currency,
    description: row.description,
    counterparty: row.counterparty,
    status: row.status,
    suggestedType: row.suggestedType,
    suggestedConfidence: row.suggestedConfidence,
    suggestedCategoryId: row.suggestedCategoryId,
    finalCategory: row.finalCategory
      ? { id: row.finalCategory.id, name: row.finalCategory.name, color: row.finalCategory.color }
      : null,
    pair: pair ?? null,
    duplicateOf: row.duplicateOf
      ? {
          transactionId: row.duplicateOf.id,
          description: row.duplicateOf.description,
          transactionDate: toIsoDateOnly(row.duplicateOf.transactionDate),
        }
      : null,
  };
}

/**
 * Messaggio da mostrare nella riga di errore: solo messaggi nostri (o già
 * sanificati). Un errore imprevisto potrebbe contenere dettagli interni.
 */
function describeError(e: unknown): string {
  if (e instanceof ForbiddenException) return 'Non hai i permessi per questo conto.';
  if (e instanceof HttpException) {
    const res = e.getResponse();
    if (typeof res === 'string') return res;
    const message = (res as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
    return e.message;
  }
  return 'Errore imprevisto durante la conferma: riprova.';
}
