import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import {
  addressesMatch,
  cleanAddress,
  findSupplyAddress,
  householdName,
  isMeterCode,
  parseAddress,
} from './household-address';
import { correctedPeriod, findBilledPeriod, findEnergyPrices } from './bill-extraction';
import { extractPdfText } from './pdf-text';

export interface HouseholdView {
  id: string;
  name: string;
  address: string | null;
  billCount: number;
  createdAt: string;
}

/**
 * Abitazioni appena create e ancora vuote non si eliminano: un salvataggio
 * può averne appena creata una e stare per assegnarle la bolletta.
 */
const EMPTY_HOUSEHOLD_GRACE_MS = 5 * 60_000;

/**
 * Abitazioni: raggruppano le bollette per indirizzo di fornitura. Si creano
 * da sole quando arriva una bolletta con un indirizzo nuovo.
 *
 * Riconoscimento, in ordine di affidabilità:
 * 1. un **POD o PDR** (codice del contatore) già visto in una bolletta
 *    assegnata. Il codice utenza dell'acqua non vale: può essere il codice
 *    cliente, uguale per più case;
 * 2. l'**indirizzo**, confrontato a pezzi con quello delle abitazioni
 *    (`addressesMatch`): se c'è un'unica abitazione equivalente in modo
 *    rigoroso è quella; se l'indirizzo letto non dice né CAP né città, si
 *    accetta un'unica corrispondenza permissiva;
 * 3. altrimenti un'abitazione nuova, se l'indirizzo ha un civico.
 * Le bollette con l'abitazione scelta dall'utente (`householdLocked`, anche
 * "nessuna") non vengono mai riassegnate.
 */
@Injectable()
export class HouseholdsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HouseholdsService.name);
  /**
   * Una operazione sulle abitazioni alla volta per utente: due letture
   * parallele dello stesso indirizzo creerebbero due abitazioni identiche, e
   * un'unione durante un'assegnazione lascerebbe una bolletta orfana.
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async list(userId: string): Promise<HouseholdView[]> {
    const rows = await this.prisma.household.findMany({
      where: { userId },
      include: { _count: { select: { bills: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((h) => ({
      id: h.id,
      name: h.name,
      address: h.address,
      billCount: h._count.bills,
      createdAt: h.createdAt.toISOString(),
    }));
  }

  async rename(userId: string, id: string, name: string): Promise<HouseholdView> {
    await this.findOwned(userId, id);
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) throw new BadRequestException('Il nome non può essere vuoto');
    await this.prisma.household.update({ where: { id }, data: { name: clean.slice(0, 120) } });
    return (await this.list(userId)).find((h) => h.id === id)!;
  }

  /**
   * Unisce `id` dentro `intoId`: le bollette passano all'altra abitazione e
   * questa sparisce. Serve quando lo stesso indirizzo è stato scritto in modi
   * troppo diversi per essere riconosciuto da solo.
   */
  async merge(userId: string, id: string, intoId: string): Promise<HouseholdView> {
    if (id === intoId) throw new BadRequestException('Scegli un’abitazione diversa');
    await this.withLock(userId, async () => {
      await this.findOwned(userId, id);
      await this.findOwned(userId, intoId);
      await this.prisma.$transaction([
        this.prisma.utilityBill.updateMany({ where: { userId, householdId: id }, data: { householdId: intoId } }),
        this.prisma.household.delete({ where: { id } }),
      ]);
    });
    return (await this.list(userId)).find((h) => h.id === intoId)!;
  }

  /** Elimina un'abitazione vuota (con bollette si unisce, non si cancella). */
  async remove(userId: string, id: string): Promise<void> {
    await this.withLock(userId, async () => {
      await this.findOwned(userId, id);
      // Conteggio e cancellazione insieme: nel mezzo non può arrivare una bolletta.
      const deleted = await this.prisma.household.deleteMany({ where: { id, userId, bills: { none: {} } } });
      if (deleted.count === 0) {
        throw new ConflictException('L’abitazione ha ancora delle bollette: spostale o uniscila a un’altra');
      }
    });
  }

  /** Verifica che l'abitazione esista e sia dell'utente (404 altrimenti). */
  async findOwned(userId: string, id: string) {
    const h = await this.prisma.household.findFirst({ where: { id, userId } });
    if (!h) throw new NotFoundException('Abitazione non trovata');
    return h;
  }

  /**
   * Abitazione per un indirizzo scritto dall'utente nel form: quella esistente
   * che corrisponde, oppure una nuova.
   */
  async findOrCreateByAddress(userId: string, address: string): Promise<string> {
    const clean = cleanAddress(address);
    if (!clean) throw new BadRequestException('Indica l’indirizzo dell’abitazione');
    return this.withLock(userId, async () => {
      const match = await this.matchByAddress(userId, clean);
      if (match) return match;
      const created = await this.prisma.household.create({
        data: { userId, name: householdName(clean), address: clean },
      });
      return created.id;
    });
  }

  /**
   * Abitazione per una bolletta appena letta: per POD/PDR, per indirizzo o
   * nuova. Non scrive sulla bolletta (lo fa chi chiama, nella stessa
   * transazione che la porta a "da verificare"). `null` = nessuna.
   */
  async resolveForBill(
    userId: string,
    supplyAddress: string | null,
    codes: string[],
    excludeBillId?: string,
  ): Promise<string | null> {
    return this.withLock(userId, async () => {
      const byCode = await this.matchBySupplyCode(userId, codes, excludeBillId);
      if (byCode) return byCode;
      if (!supplyAddress) return null;
      const byAddress = await this.matchByAddress(userId, supplyAddress);
      if (byAddress) return byAddress;
      if (!parseAddress(supplyAddress)?.number) return null;
      const created = await this.prisma.household.create({
        data: { userId, name: householdName(supplyAddress), address: supplyAddress },
      });
      return created.id;
    });
  }

  /**
   * Elimina le abitazioni rimaste senza bollette (spostate tutte altrove dal
   * form, o create da un salvataggio poi fallito), dopo un periodo di grazia.
   */
  async pruneEmpty(userId: string): Promise<void> {
    await this.withLock(userId, () =>
      this.prisma.household.deleteMany({
        where: { userId, bills: { none: {} }, createdAt: { lt: new Date(Date.now() - EMPTY_HOUSEHOLD_GRACE_MS) } },
      }),
    ).catch((e: Error) => this.logger.warn(`Pulizia abitazioni vuote fallita: ${e.message}`));
  }

  /**
   * All'avvio, dopo 15 s e una bolletta alla volta: le bollette caricate prima
   * delle abitazioni o della materia prima. Non deve poter far cadere il
   * processo: ogni errore resta nel log.
   */
  onApplicationBootstrap(): void {
    setTimeout(() => {
      this.backfill().catch((e: Error) => this.logger.error(`Ripasso delle bollette interrotto: ${e.message}`));
    }, 15_000).unref();
  }

  /**
   * Rilegge il PDF (senza LLM, una volta sola per bolletta) per ricavare
   * indirizzo di fornitura e materia prima, poi assegna l'abitazione. Non
   * sovrascrive niente: tutte le scritture sono condizionate al campo ancora
   * vuoto, così un salvataggio o una rilettura fatti nel frattempo vincono.
   */
  async backfill(): Promise<number> {
    const bills = await this.prisma.utilityBill.findMany({
      where: {
        status: { not: 'extracting' },
        OR: [
          { householdId: null, householdLocked: false },
          { energyParsedAt: null, fileKey: { not: null } },
          { periodCheckedAt: null, fileKey: { not: null } },
        ],
      },
      select: {
        id: true,
        userId: true,
        fileKey: true,
        supplyAddress: true,
        householdId: true,
        householdLocked: true,
        energyParsedAt: true,
        periodCheckedAt: true,
        periodStart: true,
        periodEnd: true,
        lines: { select: { id: true, utility: true, supplyCode: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    let assigned = 0;
    for (const b of bills) {
      try {
        assigned += await this.backfillOne(b);
      } catch (e) {
        this.logger.warn(`Ripasso della bolletta ${b.id} non riuscito: ${(e as Error).message}`);
      }
    }
    if (bills.length) this.logger.log(`Bollette ripassate: ${bills.length}, abitazioni assegnate: ${assigned}`);
    return assigned;
  }

  // ------------------------------------------------------------------

  private async backfillOne(b: {
    id: string;
    userId: string;
    fileKey: string | null;
    supplyAddress: string | null;
    householdId: string | null;
    householdLocked: boolean;
    energyParsedAt: Date | null;
    periodCheckedAt: Date | null;
    periodStart: Date | null;
    periodEnd: Date | null;
    lines: Array<{ id: string; utility: string; supplyCode: string | null }>;
  }): Promise<number> {
    const wantsHousehold = !b.householdId && !b.householdLocked;
    let supplyAddress = b.supplyAddress;
    const needsText = !!b.fileKey && ((wantsHousehold && supplyAddress === null) || !b.energyParsedAt || !b.periodCheckedAt);
    if (needsText) {
      let text = '';
      try {
        text = await extractPdfText(await streamToBuffer(await this.minio.getObjectStream(b.fileKey!)));
      } catch (e) {
        // PDF mancante o illeggibile: lo si segna come già cercato, per non
        // rileggerlo (e loggarlo) a ogni avvio.
        this.logger.warn(`PDF della bolletta ${b.id} non riletto: ${(e as Error).message}`);
      }
      if (wantsHousehold && supplyAddress === null) {
        supplyAddress = text ? (findSupplyAddress(text) ?? '') : '';
        await this.prisma.utilityBill.updateMany({ where: { id: b.id, supplyAddress: null }, data: { supplyAddress } });
      }
      if (!b.energyParsedAt) {
        const found = text ? findEnergyPrices(text) : {};
        for (const kind of ['electricity', 'gas'] as const) {
          const f = found[kind];
          if (!f) continue;
          await this.prisma.utilityBillLine.updateMany({
            where: { billId: b.id, utility: kind, energyCostCents: null, energyUnitPrice: null },
            data: { energyCostCents: f.energyCostCents, energyUnitPrice: f.energyUnitPrice },
          });
        }
        await this.prisma.utilityBill.updateMany({ where: { id: b.id, energyParsedAt: null }, data: { energyParsedAt: new Date() } });
      }
      if (!b.periodCheckedAt) await this.backfillPeriod(b, text);
    }
    if (!wantsHousehold) return 0;
    const codes = b.lines.map((l) => l.supplyCode).filter((c): c is string => !!c);
    const householdId = await this.resolveForBill(b.userId, supplyAddress || null, codes, b.id);
    if (!householdId) return 0;
    const res = await this.prisma.utilityBill.updateMany({
      where: { id: b.id, householdId: null, householdLocked: false },
      data: { householdId },
    });
    return res.count;
  }

  /**
   * Corregge il periodo sulle quote fisse mensili (vedi `correctedPeriod`).
   * Scrittura condizionata al periodo ancora uguale a quello letto: una
   * modifica salvata nel frattempo vince.
   */
  private async backfillPeriod(
    b: { id: string; periodStart: Date | null; periodEnd: Date | null; lines: Array<{ id: string }> },
    text: string,
  ): Promise<void> {
    const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const fixed = text ? correctedPeriod(iso(b.periodStart), iso(b.periodEnd), findBilledPeriod(text)) : null;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.utilityBill.updateMany({
        where: { id: b.id, periodCheckedAt: null, periodStart: b.periodStart, periodEnd: b.periodEnd },
        data: {
          periodCheckedAt: new Date(),
          ...(fixed ? { periodStart: new Date(fixed.start), periodEnd: new Date(fixed.end) } : {}),
        },
      });
      if (!fixed || res.count === 0) return;
      this.logger.log(`Periodo della bolletta ${b.id}: ${iso(b.periodStart)}…${iso(b.periodEnd)} → ${fixed.start}…${fixed.end}`);
      if (b.lines.length === 1) {
        await tx.utilityBillLine.updateMany({ where: { id: b.lines[0].id }, data: { periodStart: null, periodEnd: null } });
      }
    });
  }

  private async matchBySupplyCode(userId: string, codes: string[], excludeBillId?: string): Promise<string | null> {
    const meters = codes.filter(isMeterCode);
    if (meters.length === 0) return null;
    const line = await this.prisma.utilityBillLine.findFirst({
      where: {
        supplyCode: { in: meters },
        bill: { userId, householdId: { not: null }, ...(excludeBillId ? { id: { not: excludeBillId } } : {}) },
      },
      select: { bill: { select: { householdId: true } } },
      orderBy: { bill: { createdAt: 'desc' } },
    });
    return line?.bill.householdId ?? null;
  }

  private async matchByAddress(userId: string, address: string): Promise<string | null> {
    const parsed = parseAddress(address);
    if (!parsed?.number) return null;
    const households = await this.prisma.household.findMany({ where: { userId }, select: { id: true, address: true } });
    const strict = households.filter((h) => addressesMatch(parsed, parseAddress(h.address)));
    if (strict.length === 1) return strict[0].id;
    if (strict.length > 1) return null; // ambiguo: meglio "senza abitazione" che quella sbagliata
    // L'indirizzo non permette di confrontare la località (manca il CAP o la
    // città da una parte): si accetta solo un'unica abitazione compatibile.
    const lenient = households.filter((h) => addressesMatch(parsed, parseAddress(h.address), { lenient: true }));
    return lenient.length === 1 ? lenient[0].id : null;
  }

  private withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.locks.set(userId, tail);
    void tail.then(() => {
      if (this.locks.get(userId) === tail) this.locks.delete(userId);
    });
    return next;
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
