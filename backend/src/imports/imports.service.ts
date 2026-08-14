import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportBatchStatus,
  ImportRowStatus,
  NotificationType,
  Prisma,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { sanitizeExternalText } from '../common/utils/sanitize-text';
import { NotificationsService } from '../notifications/notifications.service';
import { CATEGORY_BATCH_SIZE, CategoryAiService } from './category-ai.service';
import { parseCsv, parseDate, parseAmountCents } from './csv-parser';
import {
  ConfirmBatchDto,
  CreateBatchDto,
  CreateTemplateDto,
} from './dto/import.dto';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
    private readonly ai: CategoryAiService,
    private readonly notifications: NotificationsService,
  ) {}

  async createBatch(userId: string, dto: CreateBatchDto) {
    await this.policy.assertWrite(userId, dto.accountId);

    let template: Awaited<ReturnType<PrismaService['importTemplate']['findUnique']>> = null;
    if (dto.templateId) {
      template = await this.prisma.importTemplate.findUnique({ where: { id: dto.templateId } });
      if (!template || template.userId !== userId) throw new NotFoundException('Template not found');
    }

    const delimiter = dto.delimiter ?? template?.delimiter ?? ',';
    const hasHeader = dto.hasHeader ?? template?.hasHeader ?? true;
    const decimalSep = dto.decimalSep ?? template?.decimalSep ?? ',';
    const dateFormat = dto.dateFormat ?? template?.dateFormat ?? undefined;
    const columnMap = (dto.columnMap ?? (template?.columnMap as never)) as {
      date: number;
      amount: number;
      amountOut?: number;
      description?: number;
    };
    if (!columnMap || columnMap.date === undefined || columnMap.amount === undefined) {
      throw new BadRequestException('columnMap with at least date+amount is required');
    }

    const parsed = parseCsv(dto.rawCsv, { delimiter, hasHeader });

    const batch = await this.prisma.importBatch.create({
      data: {
        userId,
        accountId: dto.accountId,
        filename: dto.filename,
        delimiter,
        encoding: dto.encoding ?? 'utf-8',
        rowCount: parsed.rows.length,
        columnMap: columnMap as unknown as Prisma.InputJsonValue,
        templateId: dto.templateId ?? null,
        status: ImportBatchStatus.analyzing,
      },
    });

    const rowsData = parsed.rows.map((cells, idx) => {
      const date = parseDate(cells[columnMap.date] ?? '', dateFormat);
      let amount = parseAmountCents(cells[columnMap.amount] ?? '', decimalSep);
      if (columnMap.amountOut !== undefined && (!amount || amount === 0n)) {
        const out = parseAmountCents(cells[columnMap.amountOut] ?? '', decimalSep);
        if (out && out !== 0n) amount = -out;
      }
      const rawDesc = columnMap.description !== undefined ? cells[columnMap.description] ?? '' : '';
      // La descrizione arriva da un file di terzi: sanificazione all'ingestione
      // (control chars, sintassi Markdown attiva) — vedi sanitize-text.ts.
      // Cap a 500 = lunghezza storica della colonna, per non troncare dati esistenti.
      const desc = sanitizeExternalText(rawDesc, 500) ?? '';
      const ok = !!date && !!amount;
      return {
        batchId: batch.id,
        rowIndex: idx,
        raw: cells as unknown as Prisma.InputJsonValue,
        parsedDate: date,
        parsedAmount: amount,
        parsedDescription: desc,
        status: ok ? ImportRowStatus.pending : ImportRowStatus.error,
        errorMessage: ok ? null : 'Data o importo non parsabile',
      } satisfies Prisma.ImportRowCreateManyInput;
    });
    await this.prisma.importRow.createMany({ data: rowsData });

    void this.analyzeBatch(userId, batch.id).catch((e) =>
      this.logger.error(`analyzeBatch failed: ${(e as Error).message}`),
    );

    return { batchId: batch.id, rowCount: parsed.rows.length };
  }

  private async analyzeBatch(userId: string, batchId: string): Promise<void> {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { rows: true },
    });
    if (!batch) return;

    let duplicateCount = 0;
    for (const r of batch.rows) {
      if (!r.parsedDate || !r.parsedAmount) continue;
      const existing = await this.prisma.transaction.findFirst({
        where: {
          accountId: batch.accountId,
          transactionDate: r.parsedDate,
          amountCents: r.parsedAmount,
        },
        select: { id: true, description: true },
      });
      if (!existing) continue;
      const descMatch =
        !r.parsedDescription ||
        !existing.description ||
        normalize(r.parsedDescription).includes(normalize(existing.description.slice(0, 20))) ||
        normalize(existing.description).includes(normalize(r.parsedDescription.slice(0, 20)));
      if (descMatch) {
        await this.prisma.importRow.update({
          where: { id: r.id },
          data: { status: ImportRowStatus.duplicate, duplicateOfTransactionId: existing.id },
        });
        duplicateCount++;
      }
    }

    const pending = await this.prisma.importRow.findMany({
      where: { batchId, status: ImportRowStatus.pending },
    });
    if (pending.length > 0) {
      // NB: `isIncome` è legacy (sempre false) → non viene passato all'AI.
      // Al modello serve il nome (+ quello del padre) per capire la semantica;
      // il tipo entrata/uscita lo deduce dal segno dell'importo della riga.
      const categories = await this.prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true, parent: { select: { name: true } } },
      });
      // Stesso lotto del sync bancario: su CPU un prompt più lungo non arriva
      // in fondo prima del timeout del fetch (vedi CATEGORY_BATCH_SIZE).
      for (let i = 0; i < pending.length; i += CATEGORY_BATCH_SIZE) {
        const slice = pending.slice(i, i + CATEGORY_BATCH_SIZE);
        const suggestions = await this.ai.suggestBatch(
          slice.map((r) => ({
            description: r.parsedDescription ?? '',
            amountCents: r.parsedAmount ?? 0n,
            type: ((r.parsedAmount ?? 0n) < 0n ? 'expense' : 'income') as 'income' | 'expense',
            categories: categories.map((c) => ({
              id: c.id,
              name: c.name,
              parentName: c.parent?.name ?? null,
            })),
          })),
        );
        await this.prisma.$transaction(
          slice.map((r, j) =>
            this.prisma.importRow.update({
              where: { id: r.id },
              data: {
                suggestedCategoryId: suggestions[j].categoryId,
                suggestedConfidence: suggestions[j].confidence,
                finalCategoryId: suggestions[j].categoryId,
                status: ImportRowStatus.ready,
              },
            }),
          ),
        );
      }
    }

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: ImportBatchStatus.ready, duplicateCount },
    });

    void this.notifications.create({
      userId,
      type: NotificationType.import_ready,
      title: 'Import CSV pronto per la conferma',
      body: `${batch.rowCount} righe analizzate · ${duplicateCount} possibili duplicati.`,
      data: {
        kind: 'import_ready',
        batchId: batch.id,
        rowCount: batch.rowCount,
      },
    });
  }

  async getBatch(userId: string, batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: {
          orderBy: { rowIndex: 'asc' },
          include: {
            suggestedCategory: { select: { id: true, name: true } },
            finalCategory: { select: { id: true, name: true } },
            duplicateOf: { select: { id: true, description: true, transactionDate: true } },
          },
        },
        account: { select: { id: true, name: true } },
      },
    });
    if (!batch || batch.userId !== userId) throw new NotFoundException();
    return batch;
  }

  async listBatches(userId: string) {
    return this.prisma.importBatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { account: { select: { name: true } } },
    });
  }

  async confirm(userId: string, batchId: string, dto: ConfirmBatchDto) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { rows: true },
    });
    if (!batch || batch.userId !== userId) throw new NotFoundException();
    if (batch.status !== ImportBatchStatus.ready)
      throw new BadRequestException('Batch non pronto');

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: ImportBatchStatus.importing },
    });

    const decisions = new Map(dto.rows.map((d) => [d.rowId, d]));
    let imported = 0;
    // Somma firmata di tutte le transazioni create: va applicata al saldo del
    // conto, come fa TransactionsService.create (prima non veniva fatto → saldo
    // fermo dopo un import). Accumulata e applicata con UN solo update in coda
    // al ciclo: le righe vengono create una per una fuori da $transaction e
    // avvolgere l'intero ciclo in una transazione interattiva rischierebbe il
    // timeout (5s di default) sui batch grandi.
    let balanceDelta = 0n;

    for (const row of batch.rows) {
      const dec = decisions.get(row.id);
      if (!dec) continue;
      if (
        dec.skip ||
        row.status === ImportRowStatus.duplicate ||
        row.status === ImportRowStatus.error
      ) {
        await this.prisma.importRow.update({
          where: { id: row.id },
          data: { status: ImportRowStatus.skipped },
        });
        continue;
      }
      if (!row.parsedDate || !row.parsedAmount) continue;

      const txType: TransactionType =
        row.parsedAmount < 0n ? TransactionType.expense : TransactionType.income;

      const created = await this.prisma.transaction.create({
        data: {
          userId,
          accountId: batch.accountId,
          categoryId: dec.finalCategoryId ?? row.finalCategoryId ?? null,
          type: txType,
          amountCents: row.parsedAmount,
          transactionDate: row.parsedDate,
          description: row.parsedDescription ?? null,
          importBatchId: batch.id,
        },
      });
      await this.prisma.importRow.update({
        where: { id: row.id },
        data: {
          status: ImportRowStatus.imported,
          transactionId: created.id,
          finalCategoryId: dec.finalCategoryId ?? row.finalCategoryId ?? null,
        },
      });
      // `parsedAmount` è già firmato (negativo = uscita), come amountCents.
      balanceDelta += row.parsedAmount;
      imported++;
    }

    // LIMITE NOTO: se il conto è una carta di credito, l'import NON genera gli
    // addebiti futuri (`CreditCardsService.generateChargeForCcTx`) come fa
    // TransactionsService.create. Fuori scope qui: va affrontato quando l'import
    // supporterà i conti carta.
    if (balanceDelta !== 0n) {
      await this.prisma.account.update({
        where: { id: batch.accountId },
        data: { balanceCents: { increment: balanceDelta } },
      });
    }

    if (dto.saveAsTemplate && dto.templateName) {
      await this.prisma.importTemplate.upsert({
        where: { userId_name: { userId, name: dto.templateName } },
        create: {
          userId,
          name: dto.templateName,
          delimiter: batch.delimiter,
          encoding: batch.encoding,
          hasHeader: true,
          columnMap: batch.columnMap as Prisma.InputJsonValue,
          decimalSep: ',',
          amountMode: 'single',
        },
        update: {
          delimiter: batch.delimiter,
          encoding: batch.encoding,
          columnMap: batch.columnMap as Prisma.InputJsonValue,
        },
      });
    }

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: ImportBatchStatus.completed,
        importedCount: imported,
        completedAt: new Date(),
      },
    });
    return { imported, total: batch.rowCount };
  }

  async cancel(userId: string, batchId: string) {
    const b = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!b || b.userId !== userId) throw new NotFoundException();
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: ImportBatchStatus.cancelled },
    });
  }

  async listTemplates(userId: string) {
    return this.prisma.importTemplate.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createTemplate(userId: string, dto: CreateTemplateDto) {
    return this.prisma.importTemplate.create({
      data: {
        userId,
        name: dto.name,
        bankName: dto.bankName ?? null,
        delimiter: dto.delimiter,
        encoding: dto.encoding,
        hasHeader: dto.hasHeader,
        columnMap: dto.columnMap as unknown as Prisma.InputJsonValue,
        dateFormat: dto.dateFormat ?? null,
        decimalSep: dto.decimalSep,
        amountMode: dto.amountMode,
      },
    });
  }

  async deleteTemplate(userId: string, id: string) {
    const t = await this.prisma.importTemplate.findUnique({ where: { id } });
    if (!t || t.userId !== userId) throw new NotFoundException();
    await this.prisma.importTemplate.delete({ where: { id } });
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
