import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma, UtilityBillStatus, type UtilityBill, type UtilityBillLine } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { BillExtractorService } from './bill-extractor.service';
import { UTILITY_KINDS, correctedPeriod, findBilledPeriod, findEnergyPrices, parseBillDate, type ExtractedBill, type UtilityKind } from './bill-extraction';
import type { SaveUtilityBillDto } from './dto/utility-bill.dto';
import { extractPdfText } from './pdf-text';
import { HouseholdsService } from './households.service';
import { findSupplyAddress } from './household-address';

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
/**
 * Una lettura `extracting` più vecchia di così è morta (backend riavviato a
 * metà): si mostra come fallita e si può rileggere. Abbondante rispetto ai
 * ~5 minuti del caso peggiore (OpenCode in timeout + Ollama su CPU).
 */
const STALE_EXTRACTION_MS = 30 * 60_000;
/**
 * Letture contemporanee nell'intero backend. Ognuna tiene in memoria il PDF
 * (fino a 10 MB) e occupa il modello: Ollama su CPU le servirebbe comunque una
 * alla volta, e senza tetto un caricamento in blocco finirebbe in timeout.
 */
const MAX_CONCURRENT_EXTRACTIONS = 2;
/** Bollette in lettura per utente: oltre si risponde 429 invece di accodare all'infinito. */
const MAX_PENDING_PER_USER = 10;

/** Coda in-process minimale: esegue al più `limit` lavori alla volta. */
class JobQueue {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  run(job: () => Promise<void>): void {
    const start = () => {
      this.running += 1;
      void job().finally(() => {
        this.running -= 1;
        this.waiting.shift()?.();
      });
    };
    if (this.running < this.limit) start();
    else this.waiting.push(start);
  }
}

type BillWithLines = UtilityBill & { lines: UtilityBillLine[] };

export interface UtilityBillLineView {
  utility: UtilityKind;
  consumption: number | null;
  costCents: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  supplyCode: string | null;
  estimated: boolean;
  energyCostCents: number | null;
  energyUnitPrice: number | null;
}

export interface UtilityBillView {
  id: string;
  householdId: string | null;
  /** Indirizzo di fornitura letto dal PDF, `null` se non trovato. */
  supplyAddress: string | null;
  provider: string | null;
  billNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalCents: number | null;
  notes: string | null;
  status: UtilityBillStatus;
  hasFile: boolean;
  fileName: string | null;
  extractionError: string | null;
  extractionModel: string | null;
  createdAt: string;
  updatedAt: string;
  lines: UtilityBillLineView[];
}

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined): Date | null => (s ? new Date(`${s}T00:00:00Z`) : null);

/**
 * Bollette di luce, gas e acqua. Sezione indipendente dai movimenti: nessuna
 * lettura né scrittura di Transaction/Account. Ogni bolletta appartiene a un
 * solo utente e ogni accesso passa dal filtro `userId`.
 */
@Injectable()
export class UtilityBillsService {
  private readonly logger = new Logger(UtilityBillsService.name);
  private readonly queue = new JobQueue(MAX_CONCURRENT_EXTRACTIONS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly extractor: BillExtractorService,
    private readonly households: HouseholdsService,
  ) {}

  async list(userId: string): Promise<UtilityBillView[]> {
    const bills = await this.prisma.utilityBill.findMany({
      where: { userId },
      include: { lines: true },
      orderBy: [{ periodEnd: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
    return bills.map((b) => this.toView(b));
  }

  async get(userId: string, id: string): Promise<UtilityBillView> {
    return this.toView(await this.findOwned(userId, id));
  }

  /** Bolletta inserita a mano: nasce già confermata. */
  async create(userId: string, dto: SaveUtilityBillDto): Promise<UtilityBillView> {
    const data = this.validated(dto);
    const householdId = await this.resolveHousehold(userId, dto);
    const bill = await this.prisma.utilityBill.create({
      data: {
        userId,
        householdId: householdId ?? null,
        // Inserita a mano: l'abitazione (anche "nessuna") l'ha scelta l'utente.
        householdLocked: true,
        ...data.header,
        status: UtilityBillStatus.confirmed,
        lines: { create: data.lines },
      },
      include: { lines: true },
    });
    return this.toView(bill);
  }

  /** Salvataggio dell'utente (verifica dei dati letti o modifica): conferma. */
  async save(userId: string, id: string, dto: SaveUtilityBillDto): Promise<UtilityBillView> {
    const existing = await this.findOwned(userId, id);
    if (this.effectiveStatus(existing) === UtilityBillStatus.extracting) {
      throw new ConflictException('Sto ancora leggendo la bolletta: aspetta che finisca prima di salvarla');
    }
    const data = this.validated(dto);
    const householdId = await this.resolveHousehold(userId, dto);
    const bill = await this.prisma.$transaction(async (tx) => {
      await tx.utilityBillLine.deleteMany({ where: { billId: id } });
      return tx.utilityBill.update({
        where: { id },
        data: {
          // `undefined` = abitazione invariata; altrimenti è una scelta
          // dell'utente, che l'assegnazione automatica non toccherà più.
          ...(householdId !== undefined ? { householdId, householdLocked: true } : {}),
          ...data.header,
          status: UtilityBillStatus.confirmed,
          extractionError: null,
          lines: { create: data.lines },
        },
        include: { lines: true },
      });
    });
    await this.households.pruneEmpty(userId);
    return this.toView(bill);
  }

  async remove(userId: string, id: string): Promise<void> {
    const bill = await this.findOwned(userId, id);
    await this.prisma.utilityBill.delete({ where: { id } });
    await this.households.pruneEmpty(userId);
    if (bill.fileKey) {
      // Il file è solo il PDF originale: se MinIO non risponde la bolletta è
      // già cancellata e resta al massimo un oggetto orfano, non un errore.
      await this.minio.removeObject(bill.fileKey).catch((e: Error) =>
        this.logger.warn(`PDF ${bill.fileKey} non rimosso: ${e.message}`),
      );
    }
  }

  /**
   * Carica il PDF e avvia la lettura in background. Risponde subito con la
   * bolletta in `extracting`: il frontend ripolla finché non cambia stato.
   */
  async upload(
    userId: string,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ): Promise<UtilityBillView> {
    if (!file?.buffer?.length) throw new BadRequestException('Nessun file ricevuto');
    if (file.size > MAX_SIZE_BYTES) {
      throw new PayloadTooLargeException('Il PDF supera i 10 MB');
    }
    // Firma reale del file, non l'header del browser né l'estensione.
    const detected = await loadFileType().then((m) => m.fileTypeFromBuffer(file.buffer));
    if (detected?.mime !== 'application/pdf' || file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('Il file non è un PDF');
    }

    await this.assertQueueRoom(userId);

    const fileKey = `utility-bills/${userId}/${randomUUID()}.pdf`;
    await this.minio.putObject(fileKey, file.buffer, 'application/pdf');
    const fileName = file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-200) || 'bolletta.pdf';

    const startedAt = new Date();
    let bill: BillWithLines;
    try {
      bill = await this.prisma.utilityBill.create({
        data: {
          userId,
          status: UtilityBillStatus.extracting,
          fileKey,
          fileName,
          fileSizeBytes: file.size,
          extractionStartedAt: startedAt,
        },
        include: { lines: true },
      });
    } catch (e) {
      // Senza riga a DB nessuno troverebbe più il PDF: si toglie subito.
      await this.minio.removeObject(fileKey).catch(() => undefined);
      throw e;
    }
    this.enqueueExtraction(bill.id, fileKey, startedAt);
    return this.toView(bill);
  }

  /** Rilegge il PDF (dopo un errore o una lettura poco convincente). */
  async reextract(userId: string, id: string): Promise<UtilityBillView> {
    const bill = await this.findOwned(userId, id);
    if (!bill.fileKey) throw new BadRequestException('Questa bolletta non ha un PDF da leggere');
    const status = this.effectiveStatus(bill);
    if (status === UtilityBillStatus.extracting) {
      throw new ConflictException('Sto già leggendo questa bolletta');
    }
    if (status === UtilityBillStatus.confirmed) {
      // I dati confermati sono dell'utente: una rilettura li sovrascriverebbe.
      throw new ConflictException('La bolletta è già confermata: modifica i dati a mano');
    }
    await this.assertQueueRoom(userId);
    const startedAt = new Date();
    // Passaggio a `extracting` condizionato allo stato appena letto: se nel
    // frattempo l'utente ha confermato (altra scheda) o è partita un'altra
    // rilettura, non si sovrascrive niente e non si paga una seconda lettura.
    const claimed = await this.prisma.utilityBill.updateMany({
      where: {
        id,
        userId,
        OR: [
          { status: { in: [UtilityBillStatus.review, UtilityBillStatus.failed] } },
          {
            status: UtilityBillStatus.extracting,
            OR: [
              { extractionStartedAt: null },
              { extractionStartedAt: { lt: new Date(Date.now() - STALE_EXTRACTION_MS) } },
            ],
          },
        ],
      },
      data: { status: UtilityBillStatus.extracting, extractionStartedAt: startedAt, extractionError: null },
    });
    if (claimed.count === 0) {
      throw new ConflictException('La bolletta è cambiata nel frattempo: ricarica la pagina');
    }
    this.enqueueExtraction(id, bill.fileKey, startedAt);
    return this.toView(await this.findOwned(userId, id));
  }

  async openFile(
    userId: string,
    id: string,
  ): Promise<{ stream: Readable; fileName: string; sizeBytes: number }> {
    const bill = await this.findOwned(userId, id);
    if (!bill.fileKey) throw new NotFoundException('Questa bolletta non ha un PDF');
    const stream = await this.minio.getObjectStream(bill.fileKey);
    return { stream, fileName: bill.fileName ?? 'bolletta.pdf', sizeBytes: bill.fileSizeBytes ?? 0 };
  }

  // ------------------------------------------------------------------

  private enqueueExtraction(billId: string, fileKey: string, startedAt: Date): void {
    this.queue.run(() => this.runExtraction(billId, fileKey, startedAt));
  }

  private async assertQueueRoom(userId: string): Promise<void> {
    const pending = await this.prisma.utilityBill.count({
      where: {
        userId,
        status: UtilityBillStatus.extracting,
        extractionStartedAt: { gte: new Date(Date.now() - STALE_EXTRACTION_MS) },
      },
    });
    if (pending >= MAX_PENDING_PER_USER) {
      throw new HttpException(
        `Sto già leggendo ${pending} bollette: aspetta che finiscano prima di caricarne altre`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Lettura in background. Scrive il risultato solo se la bolletta è ancora
   * nella STESSA lettura (`extractionStartedAt` uguale): se nel frattempo è
   * stata cancellata o è partita una rilettura, questo risultato si butta.
   */
  private async runExtraction(billId: string, fileKey: string, startedAt: Date): Promise<void> {
    let data: ExtractedBill | null = null;
    let model: string | null = null;
    let error: string | null = null;
    let text = '';
    try {
      const buffer = await streamToBuffer(await this.minio.getObjectStream(fileKey));
      text = await extractPdfText(buffer);
      if (text.replace(/\s/g, '').length < 80) {
        error = 'Il PDF non contiene testo leggibile (forse è una scansione): inserisci i dati a mano';
      } else {
        const outcome = await this.extractor.extract(text, billId);
        data = outcome.data;
        model = outcome.model;
      }
    } catch (e) {
      error = `Non sono riuscito a leggere la bolletta: ${(e as Error).message}`.slice(0, 500);
    }

    // Indirizzo di fornitura: quello del modello, altrimenti cercato nel testo
    // senza LLM (serve anche quando la lettura dei dati è fallita).
    // Stringa vuota = cercato e non trovato.
    const supplyAddress = data?.supplyAddress ?? (text ? (findSupplyAddress(text) ?? '') : null);
    // Materia prima: dove il modello non l'ha data, la riga di riepilogo letta
    // direttamente dal testo.
    if (data && text) {
      const found = findEnergyPrices(text);
      for (const l of data.lines) {
        const f = l.utility === 'water' ? undefined : found[l.utility];
        if (!f) continue;
        l.energyUnitPrice ??= f.energyUnitPrice;
        l.energyCostCents ??= f.energyCostCents;
      }
    }
    // Periodo: le quote fisse mensili correggono quello letto dal modello
    // (rettifiche di mesi passati che lo allargavano, mesi sfasati).
    if (data && text) {
      const fixed = correctedPeriod(data.periodStart, data.periodEnd, findBilledPeriod(text));
      if (fixed) {
        data.periodStart = fixed.start;
        data.periodEnd = fixed.end;
        // Con un solo servizio il periodo della riga è quello della bolletta.
        if (data.lines.length === 1) {
          data.lines[0].periodStart = null;
          data.lines[0].periodEnd = null;
        }
      }
    }
    // Abitazione calcolata PRIMA della transazione (serve il lock per utente)
    // e scritta DENTRO, insieme al passaggio a "da verificare": così la
    // bolletta non è mai visibile come da verificare senza abitazione (aprendo
    // la verifica in quel momento, il form l'avrebbe confermata "senza").
    let householdId: string | null = null;
    try {
      const owner = await this.prisma.utilityBill.findUnique({
        where: { id: billId },
        select: { userId: true, householdId: true, householdLocked: true },
      });
      if (owner && !owner.householdId && !owner.householdLocked) {
        const codes = (data?.lines ?? []).map((l) => l.supplyCode).filter((c): c is string => !!c);
        householdId = await this.households.resolveForBill(owner.userId, supplyAddress || null, codes, billId);
      }
    } catch (e) {
      this.logger.warn(`Abitazione della bolletta ${billId} non riconosciuta: ${(e as Error).message}`);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.utilityBill.updateMany({
          where: { id: billId, status: UtilityBillStatus.extracting, extractionStartedAt: startedAt },
          data: data
            ? {
                status: UtilityBillStatus.review,
                provider: data.provider,
                billNumber: data.billNumber,
                issueDate: toDate(data.issueDate),
                dueDate: toDate(data.dueDate),
                periodStart: toDate(data.periodStart),
                periodEnd: toDate(data.periodEnd),
                totalCents: data.totalCents,
                extractionModel: model,
                extractionError: null,
                supplyAddress,
                energyParsedAt: new Date(),
                periodCheckedAt: new Date(),
              }
            : {
                status: UtilityBillStatus.failed,
                extractionError: error,
                extractionModel: null,
                supplyAddress,
                // I dati li inserirà l'utente: il periodo non va più ricontrollato.
                periodCheckedAt: new Date(),
              },
        });
        if (claimed.count === 0) return;
        if (householdId) {
          await tx.utilityBill.updateMany({
            where: { id: billId, householdId: null, householdLocked: false },
            data: { householdId },
          });
        }
        if (!data) return;
        await tx.utilityBillLine.deleteMany({ where: { billId } });
        if (data.lines.length) {
          await tx.utilityBillLine.createMany({
            data: data.lines.map((l) => ({
              billId,
              utility: l.utility,
              consumption: l.consumption,
              costCents: l.costCents,
              periodStart: toDate(l.periodStart),
              periodEnd: toDate(l.periodEnd),
              supplyCode: l.supplyCode,
              estimated: l.estimated,
              energyCostCents: l.energyCostCents,
              energyUnitPrice: l.energyUnitPrice,
            })),
          });
        }
      });
    } catch (e) {
      this.logger.error(`Salvataggio della lettura della bolletta ${billId} fallito: ${(e as Error).message}`);
    }
  }

  /**
   * Abitazione scelta nel form: `undefined` = non toccarla, `null` = nessuna,
   * un id (dell'utente) oppure un indirizzo nuovo (riconosciuto o creato).
   */
  private async resolveHousehold(userId: string, dto: SaveUtilityBillDto): Promise<string | null | undefined> {
    if (dto.newHouseholdAddress?.trim() && dto.householdId) {
      throw new BadRequestException('Scegli un’abitazione esistente oppure un indirizzo nuovo, non entrambi');
    }
    if (dto.newHouseholdAddress?.trim()) {
      return this.households.findOrCreateByAddress(userId, dto.newHouseholdAddress);
    }
    if (dto.householdId === undefined) return undefined;
    if (dto.householdId === null) return null;
    await this.households.findOwned(userId, dto.householdId);
    return dto.householdId;
  }

  private async findOwned(userId: string, id: string): Promise<BillWithLines> {
    const bill = await this.prisma.utilityBill.findFirst({ where: { id, userId }, include: { lines: true } });
    // 404 anche per le bollette di altri utenti: non si rivela che esistono.
    if (!bill) throw new NotFoundException('Bolletta non trovata');
    return bill;
  }

  private effectiveStatus(bill: UtilityBill): UtilityBillStatus {
    if (
      bill.status === UtilityBillStatus.extracting &&
      (!bill.extractionStartedAt || Date.now() - bill.extractionStartedAt.getTime() > STALE_EXTRACTION_MS)
    ) {
      return UtilityBillStatus.failed;
    }
    return bill.status;
  }

  /** Controlli di coerenza che il DTO da solo non esprime. */
  private validated(dto: SaveUtilityBillDto): {
    header: Omit<Prisma.UtilityBillUncheckedCreateInput, 'userId' | 'status' | 'lines'>;
    lines: Omit<Prisma.UtilityBillLineCreateManyInput, 'billId'>[];
  } {
    // Il DTO controlla solo la forma AAAA-MM-GG: qui si rifiutano le date che
    // non esistono ("2026-02-30" diventerebbe in silenzio il 2 marzo).
    const dates = [
      dto.issueDate,
      dto.dueDate,
      dto.periodStart,
      dto.periodEnd,
      ...dto.lines.flatMap((l) => [l.periodStart, l.periodEnd]),
    ];
    for (const d of dates) {
      if (d && parseBillDate(d) !== d) throw new BadRequestException(`Data non valida: ${d}`);
    }
    if (dto.periodStart > dto.periodEnd) {
      throw new BadRequestException("L'inizio del periodo è dopo la fine");
    }
    const seen = new Set<UtilityKind>();
    for (const l of dto.lines) {
      if (seen.has(l.utility)) throw new BadRequestException('Ogni servizio può comparire una sola volta');
      seen.add(l.utility);
      if (l.consumption == null && l.costCents == null) {
        throw new BadRequestException('Per ogni servizio indica almeno il consumo o il costo');
      }
      if ((l.periodStart && !l.periodEnd) || (!l.periodStart && l.periodEnd)) {
        throw new BadRequestException('Il periodo di un servizio va indicato con inizio e fine');
      }
      if (l.periodStart && l.periodEnd && l.periodStart > l.periodEnd) {
        throw new BadRequestException("L'inizio del periodo di un servizio è dopo la fine");
      }
    }
    const text = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);
    return {
      header: {
        provider: text(dto.provider),
        billNumber: text(dto.billNumber),
        issueDate: toDate(dto.issueDate),
        dueDate: toDate(dto.dueDate),
        periodStart: toDate(dto.periodStart),
        periodEnd: toDate(dto.periodEnd),
        totalCents: dto.totalCents ?? null,
        notes: text(dto.notes),
      },
      lines: [...dto.lines]
        .sort((a, b) => UTILITY_KINDS.indexOf(a.utility) - UTILITY_KINDS.indexOf(b.utility))
        .map((l) => ({
          utility: l.utility,
          consumption: l.consumption ?? null,
          costCents: l.costCents ?? null,
          periodStart: toDate(l.periodStart),
          periodEnd: toDate(l.periodEnd),
          supplyCode: text(l.supplyCode)?.toUpperCase().replace(/\s+/g, '') ?? null,
          estimated: l.estimated === true,
          // La materia prima esiste solo per luce e gas.
          energyCostCents: l.utility === 'water' ? null : (l.energyCostCents ?? null),
          energyUnitPrice: l.utility === 'water' ? null : (l.energyUnitPrice ?? null),
        })),
    };
  }

  private toView(b: BillWithLines): UtilityBillView {
    const status = this.effectiveStatus(b);
    return {
      id: b.id,
      householdId: b.householdId,
      supplyAddress: b.supplyAddress || null,
      provider: b.provider,
      billNumber: b.billNumber,
      issueDate: day(b.issueDate),
      dueDate: day(b.dueDate),
      periodStart: day(b.periodStart),
      periodEnd: day(b.periodEnd),
      totalCents: b.totalCents,
      notes: b.notes,
      status,
      hasFile: !!b.fileKey,
      fileName: b.fileName,
      extractionError:
        status === UtilityBillStatus.failed && b.status === UtilityBillStatus.extracting
          ? 'La lettura si è interrotta: rileggi il PDF o inserisci i dati a mano'
          : b.extractionError,
      extractionModel: b.extractionModel,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      lines: [...b.lines]
        .sort((x, y) => UTILITY_KINDS.indexOf(x.utility) - UTILITY_KINDS.indexOf(y.utility))
        .map((l) => ({
          utility: l.utility,
          consumption: l.consumption,
          costCents: l.costCents,
          periodStart: day(l.periodStart),
          periodEnd: day(l.periodEnd),
          supplyCode: l.supplyCode,
          estimated: l.estimated,
          energyCostCents: l.energyCostCents,
          energyUnitPrice: l.energyUnitPrice,
        })),
    };
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// file-type è ESM-only: import dinamico non trasformato in require() da TS
// (stesso trucco di attachments.service.ts).
type FileTypeModule = { fileTypeFromBuffer: (buf: Buffer) => Promise<{ mime: string } | undefined> };
const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
const loadFileType = (): Promise<FileTypeModule> => dynamicImport('file-type') as Promise<FileTypeModule>;
