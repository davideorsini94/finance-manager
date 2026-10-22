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
import { addressesMatch, cleanAddress, findSupplyAddress, householdName, parseAddress } from './household-address';
import { extractPdfText } from './pdf-text';
import { findEnergyPrices } from './bill-extraction';

export interface HouseholdView {
  id: string;
  name: string;
  address: string | null;
  billCount: number;
  createdAt: string;
}

/**
 * Abitazioni: raggruppano le bollette per indirizzo di fornitura. Si creano
 * da sole quando arriva una bolletta con un indirizzo nuovo; nessuna UI per
 * crearle a mano fuori dal form della bolletta.
 *
 * Riconoscimento, in ordine di affidabilità:
 * 1. un codice POD/PDR/utenza già visto in una bolletta assegnata: il
 *    contatore è quello, l'abitazione pure (anche se l'indirizzo è scritto in
 *    un altro modo o manca);
 * 2. l'indirizzo, confrontato a pezzi (`addressesMatch`) con quello delle
 *    abitazioni esistenti;
 * 3. altrimenti un'abitazione nuova con quell'indirizzo.
 * Senza codice né indirizzo la bolletta resta "senza abitazione".
 */
@Injectable()
export class HouseholdsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HouseholdsService.name);
  /**
   * Una assegnazione alla volta per utente: due letture in parallelo dello
   * stesso indirizzo creerebbero due abitazioni identiche.
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
    await this.findOwned(userId, id);
    await this.findOwned(userId, intoId);
    await this.prisma.$transaction([
      this.prisma.utilityBill.updateMany({ where: { userId, householdId: id }, data: { householdId: intoId } }),
      this.prisma.household.delete({ where: { id } }),
    ]);
    return (await this.list(userId)).find((h) => h.id === intoId)!;
  }

  /** Elimina un'abitazione vuota (con bollette si unisce, non si cancella). */
  async remove(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    const bills = await this.prisma.utilityBill.count({ where: { householdId: id } });
    if (bills > 0) {
      throw new ConflictException('L’abitazione ha ancora delle bollette: spostale o uniscila a un’altra');
    }
    await this.prisma.household.delete({ where: { id } });
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
   * Dopo una lettura del PDF: assegna l'abitazione alla bolletta, se non ne
   * ha già una. Non lancia: un problema qui non deve far fallire la lettura.
   */
  async assignAfterExtraction(billId: string): Promise<void> {
    try {
      const bill = await this.prisma.utilityBill.findUnique({
        where: { id: billId },
        include: { lines: { select: { supplyCode: true } } },
      });
      if (!bill || bill.householdId) return;
      const codes = bill.lines.map((l) => l.supplyCode).filter((c): c is string => !!c);
      await this.withLock(bill.userId, async () => {
        const householdId =
          (await this.matchBySupplyCode(bill.userId, codes, billId)) ??
          (bill.supplyAddress ? await this.matchByAddress(bill.userId, bill.supplyAddress) : null) ??
          (bill.supplyAddress && parseAddress(bill.supplyAddress)?.number
            ? (
                await this.prisma.household.create({
                  data: { userId: bill.userId, name: householdName(bill.supplyAddress), address: bill.supplyAddress },
                })
              ).id
            : null);
        if (!householdId) return;
        // Condizionato: se nel frattempo l'utente l'ha assegnata a mano, vince lui.
        await this.prisma.utilityBill.updateMany({
          where: { id: billId, householdId: null },
          data: { householdId },
        });
      });
    } catch (e) {
      this.logger.warn(`Abitazione della bolletta ${billId} non assegnata: ${(e as Error).message}`);
    }
  }

  /**
   * All'avvio: le bollette caricate prima delle abitazioni (o rimaste senza)
   * vengono assegnate rileggendo il loro PDF, senza LLM. Una bolletta già
   * cercata senza esito ha `supplyAddress = ''` e non si rilegge più.
   */
  onApplicationBootstrap(): void {
    // Dopo l'avvio, per non rallentarlo; una bolletta alla volta.
    setTimeout(() => void this.backfill(), 15_000).unref();
  }

  /**
   * Bollette caricate prima delle abitazioni o della materia prima: si
   * rilegge il loro PDF (senza LLM, una volta sola) per ricavare l'indirizzo
   * di fornitura e la riga della materia prima. Non sovrascrive niente: la
   * materia prima si scrive solo nelle righe che non l'hanno, l'abitazione
   * solo se manca.
   */
  async backfill(): Promise<number> {
    const bills = await this.prisma.utilityBill.findMany({
      where: {
        status: { not: 'extracting' },
        OR: [{ householdId: null }, { energyParsedAt: null, fileKey: { not: null } }],
      },
      select: {
        id: true,
        fileKey: true,
        supplyAddress: true,
        householdId: true,
        energyParsedAt: true,
        lines: { select: { id: true, utility: true, energyCostCents: true, energyUnitPrice: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    let assigned = 0;
    for (const b of bills) {
      const needsAddress = !b.householdId && b.supplyAddress === null && !!b.fileKey;
      const needsEnergy = !b.energyParsedAt && !!b.fileKey;
      if (needsAddress || needsEnergy) {
        let text: string;
        try {
          text = await extractPdfText(await streamToBuffer(await this.minio.getObjectStream(b.fileKey!)));
        } catch (e) {
          this.logger.warn(`PDF della bolletta ${b.id} non riletto: ${(e as Error).message}`);
          continue; // si riproverà al prossimo avvio
        }
        if (needsAddress) {
          await this.prisma.utilityBill.update({ where: { id: b.id }, data: { supplyAddress: findSupplyAddress(text) ?? '' } });
        }
        if (needsEnergy) {
          const found = findEnergyPrices(text);
          for (const l of b.lines) {
            const f = l.utility === 'water' ? undefined : found[l.utility];
            if (!f || l.energyCostCents !== null || l.energyUnitPrice !== null) continue;
            await this.prisma.utilityBillLine.update({
              where: { id: l.id },
              data: { energyCostCents: f.energyCostCents, energyUnitPrice: f.energyUnitPrice },
            });
          }
          await this.prisma.utilityBill.update({ where: { id: b.id }, data: { energyParsedAt: new Date() } });
        }
      }
      if (!b.householdId) {
        await this.assignAfterExtraction(b.id);
        const after = await this.prisma.utilityBill.findUnique({ where: { id: b.id }, select: { householdId: true } });
        if (after?.householdId) assigned += 1;
      }
    }
    if (bills.length) this.logger.log(`Bollette ripassate: ${bills.length}, abitazioni assegnate: ${assigned}`);
    return assigned;
  }

  // ------------------------------------------------------------------

  private async matchBySupplyCode(userId: string, codes: string[], excludeBillId: string): Promise<string | null> {
    if (codes.length === 0) return null;
    const line = await this.prisma.utilityBillLine.findFirst({
      where: {
        supplyCode: { in: codes },
        bill: { userId, householdId: { not: null }, id: { not: excludeBillId } },
      },
      select: { bill: { select: { householdId: true } } },
      orderBy: { bill: { createdAt: 'desc' } },
    });
    return line?.bill.householdId ?? null;
  }

  private async matchByAddress(userId: string, address: string): Promise<string | null> {
    const parsed = parseAddress(address);
    if (!parsed) return null;
    const households = await this.prisma.household.findMany({ where: { userId }, select: { id: true, address: true } });
    // Si confronta con l'indirizzo dell'abitazione e con quelli già letti
    // dalle sue bollette: così una variante riconosciuta una volta aiuta le
    // successive.
    for (const h of households) {
      if (addressesMatch(parsed, parseAddress(h.address))) return h.id;
    }
    const known = await this.prisma.utilityBill.findMany({
      where: { userId, householdId: { not: null }, supplyAddress: { not: null } },
      select: { householdId: true, supplyAddress: true },
      distinct: ['supplyAddress'],
    });
    for (const k of known) {
      if (k.supplyAddress && addressesMatch(parsed, parseAddress(k.supplyAddress))) return k.householdId;
    }
    return null;
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
