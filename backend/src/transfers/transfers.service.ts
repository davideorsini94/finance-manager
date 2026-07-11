import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { CreateTransferDto, UpdateTransferDto } from './dto/transfer.dto';

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
  ) {}

  async create(userId: string, dto: CreateTransferDto) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Source and destination accounts must differ');
    }
    await this.policy.assertWrite(userId, dto.fromAccountId);
    await this.policy.assertWrite(userId, dto.toAccountId);
    if (dto.categoryId) await this.assertCategoryOwned(userId, dto.categoryId);

    const out = BigInt(-dto.amountCents);
    const inc = BigInt(dto.amountCents);
    const dateOut = new Date(dto.date);
    const dateIn = dto.arrivalDate ? new Date(dto.arrivalDate) : dateOut;

    return this.prisma.$transaction(async (tx) => {
      const txOut = await tx.transaction.create({
        data: {
          accountId: dto.fromAccountId,
          userId,
          amountCents: out,
          type: TransactionType.transfer,
          categoryId: dto.categoryId ?? null,
          description: dto.description,
          transactionDate: dateOut,
        },
      });
      const txIn = await tx.transaction.create({
        data: {
          accountId: dto.toAccountId,
          userId,
          amountCents: inc,
          type: TransactionType.transfer,
          categoryId: dto.categoryId ?? null,
          description: dto.description,
          transactionDate: dateIn,
          transferPairId: txOut.id,
        },
      });
      const linkedOut = await tx.transaction.update({
        where: { id: txOut.id },
        data: { transferPairId: txIn.id },
      });

      await tx.account.update({
        where: { id: dto.fromAccountId },
        data: { balanceCents: { increment: out } },
      });
      await tx.account.update({
        where: { id: dto.toAccountId },
        data: { balanceCents: { increment: inc } },
      });

      return { from: linkedOut, to: txIn };
    });
  }

  async update(userId: string, transferId: string, dto: UpdateTransferDto) {
    const { src, dst } = await this.loadPair(userId, transferId);
    if (dto.categoryId) await this.assertCategoryOwned(userId, dto.categoryId);

    // Conti di destinazione finali: se non passati, restano quelli attuali.
    const newFromAccountId = dto.fromAccountId ?? src.accountId;
    const newToAccountId = dto.toAccountId ?? dst.accountId;
    if (newFromAccountId === newToAccountId) {
      throw new BadRequestException('Source and destination accounts must differ');
    }
    // Se i conti cambiano, l'utente deve avere write sui nuovi conti.
    if (newFromAccountId !== src.accountId) {
      await this.policy.assertWrite(userId, newFromAccountId);
    }
    if (newToAccountId !== dst.accountId) {
      await this.policy.assertWrite(userId, newToAccountId);
    }

    const newAmountAbs = dto.amountCents ?? Number(-src.amountCents);
    const newDateOut = dto.date ? new Date(dto.date) : src.transactionDate;
    const newDateIn = dto.arrivalDate
      ? new Date(dto.arrivalDate)
      : dto.date
        ? new Date(dto.date)
        : dst.transactionDate;

    const newOut = BigInt(-newAmountAbs);
    const newIn = BigInt(newAmountAbs);

    // Categoria: undefined = non toccare, null = sgancia, uuid = imposta
    const nextCategoryId =
      dto.categoryId === undefined ? undefined : dto.categoryId === null ? null : dto.categoryId;

    // Bookkeeping dei saldi: stornare i vecchi importi dai conti originali e
    // riapplicare i nuovi sui conti finali (che possono essere cambiati).
    // Accumuliamo per conto perché i conti possono coincidere/sovrapporsi
    // (es. sorgente invariata) — così ogni conto riceve un solo update netto.
    const deltas = new Map<string, bigint>();
    const addDelta = (accountId: string, amount: bigint) => {
      deltas.set(accountId, (deltas.get(accountId) ?? 0n) + amount);
    };
    addDelta(src.accountId, -src.amountCents); // storno vecchia gamba sorgente
    addDelta(dst.accountId, -dst.amountCents); // storno vecchia gamba destinazione
    addDelta(newFromAccountId, newOut); // nuova gamba sorgente
    addDelta(newToAccountId, newIn); // nuova gamba destinazione

    return this.prisma.$transaction(async (tx) => {
      const updatedSrc = await tx.transaction.update({
        where: { id: src.id },
        data: {
          accountId: newFromAccountId,
          amountCents: newOut,
          transactionDate: newDateOut,
          description: dto.description ?? src.description,
          ...(nextCategoryId !== undefined ? { categoryId: nextCategoryId } : {}),
        },
      });
      const updatedDst = await tx.transaction.update({
        where: { id: dst.id },
        data: {
          accountId: newToAccountId,
          amountCents: newIn,
          transactionDate: newDateIn,
          description: dto.description ?? dst.description,
          ...(nextCategoryId !== undefined ? { categoryId: nextCategoryId } : {}),
        },
      });
      for (const [accountId, delta] of deltas) {
        if (delta !== 0n) {
          await tx.account.update({
            where: { id: accountId },
            data: { balanceCents: { increment: delta } },
          });
        }
      }
      return { from: updatedSrc, to: updatedDst };
    });
  }

  private async assertCategoryOwned(userId: string, categoryId: string) {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c || c.userId !== userId) throw new NotFoundException('Category not found');
  }

  async remove(userId: string, transferId: string) {
    const { src, dst } = await this.loadPair(userId, transferId);

    await this.prisma.$transaction(async (tx) => {
      // Sgancia FK reciproca per evitare problemi di delete order
      await tx.transaction.update({ where: { id: src.id }, data: { transferPairId: null } });
      await tx.transaction.update({ where: { id: dst.id }, data: { transferPairId: null } });
      await tx.transaction.delete({ where: { id: src.id } });
      await tx.transaction.delete({ where: { id: dst.id } });
      await tx.account.update({
        where: { id: src.accountId },
        data: { balanceCents: { decrement: src.amountCents } },
      });
      await tx.account.update({
        where: { id: dst.accountId },
        data: { balanceCents: { decrement: dst.amountCents } },
      });
    });
  }

  /**
   * Carica una coppia di transazioni di tipo transfer a partire da uno qualsiasi dei due id,
   * verificando che l'utente abbia write su entrambi i conti.
   * Restituisce src = lato uscita (negativo), dst = lato entrata (positivo).
   */
  private async loadPair(userId: string, transferId: string): Promise<{ src: Tx; dst: Tx }> {
    const a = await this.prisma.transaction.findUnique({ where: { id: transferId } });
    if (!a || a.type !== TransactionType.transfer || !a.transferPairId) {
      throw new NotFoundException('Transfer not found');
    }
    const b = await this.prisma.transaction.findUnique({ where: { id: a.transferPairId } });
    if (!b) throw new NotFoundException('Transfer pair not found');

    await this.policy.assertWrite(userId, a.accountId);
    await this.policy.assertWrite(userId, b.accountId);

    const src = a.amountCents < 0n ? a : b;
    const dst = a.amountCents < 0n ? b : a;
    return { src, dst };
  }
}

type Tx = Prisma.TransactionGetPayload<true>;
