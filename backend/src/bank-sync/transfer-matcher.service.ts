import { Injectable, Logger } from '@nestjs/common';
import { StagedTxStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeForCompare } from './transaction-parse';

/** Distanza massima tra le due gambe di un giroconto (la banca le contabilizza in giorni diversi). */
const PAIR_WINDOW_DAYS = 3;

/**
 * Quanto indietro guardare nella coda: oltre questo orizzonte le righe sono
 * vecchie e già passate sotto gli occhi dell'utente — riaccoppiarle
 * automaticamente sarebbe più sorprendente che utile.
 */
const LOOKBACK_DAYS = 120;

/** Tetto di sicurezza sulle righe esaminate per proprietario (il match è O(n²) nel gruppo). */
const MAX_CANDIDATES = 2000;

/** Parole che, in causale, rendono molto più probabile un giroconto. */
const TRANSFER_KEYWORDS = ['giroconto', 'bonifico', 'transfer'];

/** Un IBAN/intestatario troppo corto genererebbe match casuali. */
const MIN_IDENTITY_LEN = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Punteggio base: stesso giorno vale più della differenza minima. */
const SCORE_SAME_DAY = 40;
const SCORE_DAY_PENALTY = 10;
const SCORE_KEYWORD_BONUS = 15;
const SCORE_IDENTITY_BONUS = 25;

export interface TransferMatchResult {
  /** Coppie di giroconto accoppiate automaticamente. */
  matched: number;
  /** Righe marcate come giroconto già registrato a mano. */
  duplicates: number;
}

/** Riga staged in gara per un accoppiamento. */
interface Candidate {
  id: string;
  accountId: string;
  currency: string;
  amountCents: bigint;
  effectiveDate: Date;
  /** Testo (causale + controparte) usato per keyword e identità. */
  text: string;
  /** IBAN del conto bancario di questa riga, compattato (niente spazi). */
  ibanCompact: string | null;
  /** Intestatario del conto bancario di questa riga, normalizzato. */
  ownerNorm: string | null;
}

/**
 * Rilevamento giroconti sulla coda di revisione.
 *
 * Due mestieri distinti, entrambi per **proprietario della connessione** (le
 * righe di utenti diversi non si accoppiano mai tra loro):
 *
 *  1. **Accoppiamento** di due righe staged che sono le due gambe dello stesso
 *     movimento (conti diversi, importi esattamente opposti, stessa valuta,
 *     date entro ±3 giorni). In caso di ambiguità (più candidati a pari
 *     punteggio) NON si accoppia niente: decide l'utente in revisione.
 *  2. **Duplicati**: una riga che corrisponde a una gamba di un giroconto già
 *     registrato a mano (Transaction `type=transfer` senza `bankTxId`) viene
 *     marcata `duplicate`, così non si registra due volte.
 */
@Injectable()
export class TransferMatcherService {
  private readonly logger = new Logger(TransferMatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Passata completa per un proprietario di connessioni. Non lancia mai per
   * conto proprio sui singoli aggiornamenti: un accoppiamento fallito (riga
   * cambiata nel frattempo) viene semplicemente saltato.
   */
  async matchForOwner(ownerId: string): Promise<TransferMatchResult> {
    const candidates = await this.loadCandidates(ownerId);
    const out: TransferMatchResult = { matched: 0, duplicates: 0 };
    if (candidates.length === 0) return out;

    const pairs = findPairs(candidates);
    const paired = new Set<string>();
    for (const [a, b] of pairs) {
      if (await this.applyPair(a.id, b.id)) {
        out.matched++;
        paired.add(a.id);
        paired.add(b.id);
      }
    }

    const leftovers = candidates.filter((c) => !paired.has(c.id));
    out.duplicates = await this.flagManualTransfers(leftovers);

    if (out.matched > 0 || out.duplicates > 0) {
      this.logger.log(
        `Giroconti per l'utente ${ownerId}: ${out.matched} coppie accoppiate, ${out.duplicates} già registrate a mano`,
      );
    }
    return out;
  }

  // ---------------------------------------------------------------- privati

  /** Righe ancora da rivedere e non accoppiate, su TUTTI i link del proprietario. */
  private async loadCandidates(ownerId: string): Promise<Candidate[]> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);
    const rows = await this.prisma.bankStagedTransaction.findMany({
      where: {
        status: StagedTxStatus.pending_review,
        matchedStagedId: null,
        effectiveDate: { gte: since },
        link: { connection: { userId: ownerId } },
      },
      select: {
        id: true,
        currency: true,
        amountCents: true,
        effectiveDate: true,
        description: true,
        counterparty: true,
        link: { select: { accountId: true, iban: true, ownerName: true } },
      },
      orderBy: [{ effectiveDate: 'desc' }, { id: 'asc' }],
      take: MAX_CANDIDATES,
    });

    return rows.map((r) => ({
      id: r.id,
      accountId: r.link.accountId,
      currency: r.currency.toUpperCase(),
      amountCents: r.amountCents,
      effectiveDate: r.effectiveDate,
      text: `${r.description ?? ''} ${r.counterparty ?? ''}`,
      ibanCompact: compactIdentity(r.link.iban),
      ownerNorm: normalizedIdentity(r.link.ownerName),
    }));
  }

  /**
   * Scrive il pairing reciproco. Guard condizionale (`updateMany` con lo stato
   * atteso nel `where`): se una delle due righe è stata confermata/ignorata nel
   * frattempo la transazione viene annullata e la coppia saltata — mai mezza
   * coppia in DB.
   */
  private async applyPair(aId: string, bId: string): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const [id, partnerId] of [
          [aId, bId],
          [bId, aId],
        ] as const) {
          const res = await tx.bankStagedTransaction.updateMany({
            where: { id, status: StagedTxStatus.pending_review, matchedStagedId: null },
            data: { matchedStagedId: partnerId, suggestedType: TransactionType.transfer },
          });
          if (res.count !== 1) throw new PairChanged();
        }
      });
      return true;
    } catch (e) {
      if (!(e instanceof PairChanged)) {
        this.logger.warn(`Accoppiamento ${aId}/${bId} non riuscito: ${(e as Error).message}`);
      }
      return false;
    }
  }

  /**
   * Giroconti già registrati a mano: una gamba di `Transaction type=transfer`
   * senza `bankTxId` (quindi non nata da un sync) sullo stesso conto, stesso
   * importo firmato, entro ±3 giorni. La riga staged diventa `duplicate`.
   */
  private async flagManualTransfers(candidates: Candidate[]): Promise<number> {
    if (candidates.length === 0) return 0;

    let flagged = 0;
    const byAccount = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const bucket = byAccount.get(c.accountId);
      if (bucket) bucket.push(c);
      else byAccount.set(c.accountId, [c]);
    }

    for (const [accountId, rows] of byAccount) {
      let min = rows[0].effectiveDate;
      let max = rows[0].effectiveDate;
      for (const r of rows) {
        if (r.effectiveDate < min) min = r.effectiveDate;
        if (r.effectiveDate > max) max = r.effectiveDate;
      }

      const legs = await this.prisma.transaction.findMany({
        where: {
          accountId,
          type: TransactionType.transfer,
          bankTxId: null,
          transactionDate: {
            gte: addDays(min, -PAIR_WINDOW_DAYS),
            lte: addDays(max, PAIR_WINDOW_DAYS),
          },
        },
        select: { id: true, amountCents: true, transactionDate: true },
      });
      if (legs.length === 0) continue;

      // Una Transaction può essere il duplicato di una sola riga staged.
      const used = new Set<string>();
      for (const r of rows) {
        const leg = legs.find(
          (t) =>
            !used.has(t.id) &&
            t.amountCents === r.amountCents &&
            dayDiff(t.transactionDate, r.effectiveDate) <= PAIR_WINDOW_DAYS,
        );
        if (!leg) continue;
        const res = await this.prisma.bankStagedTransaction.updateMany({
          where: { id: r.id, status: StagedTxStatus.pending_review, matchedStagedId: null },
          data: { status: StagedTxStatus.duplicate, duplicateOfTransactionId: leg.id },
        });
        if (res.count === 1) {
          used.add(leg.id);
          flagged++;
        }
      }
    }
    return flagged;
  }
}

/** Marker interno per annullare la transazione di pairing senza rumore nei log. */
class PairChanged extends Error {}

/**
 * Coppie da accoppiare. Due righe si accoppiano solo se **si scelgono a
 * vicenda** come miglior candidato e se nessuna delle due ha un pari merito:
 * così l'ambiguità (due bonifici gemelli lo stesso giorno) resta all'utente.
 */
function findPairs(candidates: Candidate[]): Array<[Candidate, Candidate]> {
  // Le sole coppie possibili hanno stessa valuta e stesso importo assoluto:
  // raggrupparle evita il confronto di tutti con tutti.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (c.amountCents === 0n) continue;
    const abs = c.amountCents < 0n ? -c.amountCents : c.amountCents;
    const key = `${c.currency}|${abs.toString()}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c);
    else groups.set(key, [c]);
  }

  const pairs: Array<[Candidate, Candidate]> = [];
  for (const group of groups.values()) {
    const negatives = group.filter((c) => c.amountCents < 0n);
    const positives = group.filter((c) => c.amountCents > 0n);
    if (negatives.length === 0 || positives.length === 0) continue;

    const bestOf = new Map<string, string | null>();
    for (const n of negatives) bestOf.set(n.id, bestPartner(n, positives));
    for (const p of positives) bestOf.set(p.id, bestPartner(p, negatives));

    for (const n of negatives) {
      const chosen = bestOf.get(n.id);
      if (!chosen) continue;
      // Scelta reciproca: se il candidato preferisce un'altra riga, nessun match.
      if (bestOf.get(chosen) !== n.id) continue;
      const partner = positives.find((p) => p.id === chosen);
      if (partner) pairs.push([n, partner]);
    }
  }
  return pairs;
}

/** Miglior controparte, oppure `null` se non ce n'è o se c'è un pari merito. */
function bestPartner(row: Candidate, opposites: Candidate[]): string | null {
  let bestId: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let tied = false;

  for (const other of opposites) {
    // Stesso conto: sarebbe un movimento interno, non un giroconto.
    if (other.accountId === row.accountId) continue;
    if (dayDiff(row.effectiveDate, other.effectiveDate) > PAIR_WINDOW_DAYS) continue;

    const score = pairScore(row, other);
    if (score > bestScore) {
      bestScore = score;
      bestId = other.id;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }

  return tied ? null : bestId;
}

/**
 * Punteggio di una coppia: la vicinanza temporale è la base (stesso giorno
 * vince sulla differenza minima), poi i bonus da causale — parole tipiche del
 * giroconto e presenza dell'IBAN/intestatario dell'altro conto collegato.
 */
function pairScore(a: Candidate, b: Candidate): number {
  let score = SCORE_SAME_DAY - dayDiff(a.effectiveDate, b.effectiveDate) * SCORE_DAY_PENALTY;
  if (hasTransferKeyword(a.text) || hasTransferKeyword(b.text)) score += SCORE_KEYWORD_BONUS;
  if (mentionsIdentity(a.text, b) || mentionsIdentity(b.text, a)) score += SCORE_IDENTITY_BONUS;
  return score;
}

function hasTransferKeyword(text: string): boolean {
  const normalized = normalizeForCompare(text);
  return TRANSFER_KEYWORDS.some((k) => normalized.includes(k));
}

/**
 * La causale nomina l'altro conto collegato? Si accetta l'IBAN sia intero sia
 * "spezzato" (con spazi o punteggiatura: il confronto avviene sulla forma
 * compattata) e l'intestatario del conto.
 */
function mentionsIdentity(text: string, other: Candidate): boolean {
  if (other.ibanCompact) {
    const compact = compactIdentity(text);
    if (compact && compact.includes(other.ibanCompact)) return true;
  }
  if (other.ownerNorm) {
    const normalized = normalizeForCompare(text);
    if (normalized && normalized.includes(other.ownerNorm)) return true;
  }
  return false;
}

/** Solo lettere e cifre, maiuscolo: forma di confronto degli IBAN. */
function compactIdentity(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length >= MIN_IDENTITY_LEN ? compact : null;
}

function normalizedIdentity(value: string | null | undefined): string | null {
  const normalized = normalizeForCompare(value);
  return normalized.length >= MIN_IDENTITY_LEN ? normalized : null;
}

/** Distanza in giorni interi tra due date (le colonne sono `@db.Date`). */
function dayDiff(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / DAY_MS);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
