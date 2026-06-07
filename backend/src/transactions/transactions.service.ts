import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, AuditAction, AuditEntity, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { AuditService } from '../common/services/audit.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { CategorySharingService } from '../categories/category-sharing.service';
import {
  CreateTransactionDto,
  ListTransactionsQuery,
  UpdateTransactionDto,
} from './dto/transaction.dto';

const TRANSACTION_INCLUDE = {
  category: { select: { id: true, name: true, color: true, icon: true, isIncome: true } },
  account: { select: { id: true, name: true, type: true } },
  attachments: {
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  },
} satisfies Prisma.TransactionInclude;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
    private readonly audit: AuditService,
    private readonly creditCards: CreditCardsService,
    private readonly categorySharing: CategorySharingService,
  ) {}

  /**
   * Importo "signed" da salvare in DB: positivo = entrata sul conto, negativo = uscita.
   * Per i giroconti la responsabilità è del TransfersService (questo metodo non li gestisce).
   */
  static toSignedAmount(type: TransactionType, amountCents: number): bigint {
    if (type === TransactionType.transfer) {
      throw new BadRequestException('Use /transfers endpoint for transfer transactions');
    }
    return type === TransactionType.income ? BigInt(amountCents) : BigInt(-amountCents);
  }

  async create(userId: string, dto: CreateTransactionDto) {
    if (dto.type === TransactionType.transfer) {
      throw new BadRequestException('Use /transfers endpoint for transfer transactions');
    }
    await this.policy.assertWrite(userId, dto.accountId);
    if (dto.categoryId) await this.assertCategoryOwned(userId, dto.categoryId);

    const account = await this.prisma.account.findUnique({ where: { id: dto.accountId } });
    if (!account) throw new NotFoundException('Account not found');

    const signed = TransactionsService.toSignedAmount(dto.type, dto.amountCents);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          accountId: dto.accountId,
          userId,
          amountCents: signed,
          type: dto.type,
          categoryId: dto.categoryId ?? null,
          description: dto.description,
          notes: dto.notes,
          transactionDate: new Date(dto.transactionDate),
        },
      });
      await tx.account.update({
        where: { id: dto.accountId },
        data: { balanceCents: { increment: signed } },
      });

      // Se è una uscita su carta di credito, genera l'addebito futuro
      if (account.type === AccountType.credit_card && dto.type === TransactionType.expense) {
        await this.creditCards.generateChargeForCcTx(tx, created, {
          paymentAccountId: account.paymentAccountId,
          billingDay: account.billingDay,
        });
      }

      const result = await tx.transaction.findUnique({
        where: { id: created.id },
        include: TRANSACTION_INCLUDE,
      });
      void this.audit.log(userId, AuditAction.create, AuditEntity.transaction, created.id, {
        accountId: dto.accountId,
        amountCents: signed.toString(),
        type: dto.type,
      });
      // Se la transazione è categorizzata e il conto è condiviso, replica
      // (clonando) la categoria a tutti gli altri membri così la vedono nel
      // loro picker. Fire-and-forget: errori loggati ma non bloccano.
      if (dto.categoryId) {
        void this.categorySharing.replicateCategoryToAccountMembers(
          dto.accountId,
          dto.categoryId,
          userId,
        );
      }
      return result;
    });
  }

  async list(userId: string, query: ListTransactionsQuery) {
    const accessible = this.policy.accessibleAccountsWhere(userId);

    const where: Prisma.TransactionWhereInput = { account: accessible };
    if (query.accountId) {
      await this.policy.assertRead(userId, query.accountId);
      where.accountId = query.accountId;
    } else if (query.accountIds && query.accountIds.length > 0) {
      // Restringe ai conti selezionati; quelli non accessibili non rientrano
      // comunque nel filtro `accessible` → nessun dato trapelato.
      where.accountId = { in: query.accountIds };
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    else if (query.categoryIds && query.categoryIds.length > 0) {
      where.categoryId = { in: query.categoryIds };
    }
    if (query.type) where.type = query.type;
    if (query.from || query.to) {
      where.transactionDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: TRANSACTION_INCLUDE,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(userId: string, id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: TRANSACTION_INCLUDE,
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    await this.policy.assertRead(userId, tx.accountId);
    return tx;
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    const existing = await this.prisma.transaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Transaction not found');
    await this.policy.assertWrite(userId, existing.accountId);

    if (existing.type === TransactionType.transfer || existing.transferPairId) {
      throw new BadRequestException('Use /transfers endpoint to update transfers');
    }
    if (existing.isPending && existing.ccChargeId === null) {
      // Questo è il lato "addebito" di una CdC (charge), non modificabile direttamente
      throw new BadRequestException('Settle the charge from the related credit card movement');
    }

    if (dto.categoryId) await this.assertCategoryOwned(userId, dto.categoryId);

    const newType = dto.type ?? existing.type;
    if (newType === TransactionType.transfer) {
      throw new BadRequestException('Cannot change type to transfer');
    }
    const newAmountAbs =
      dto.amountCents ??
      (existing.amountCents < 0n ? Number(-existing.amountCents) : Number(existing.amountCents));
    const newSigned = TransactionsService.toSignedAmount(newType, newAmountAbs);
    const delta = newSigned - existing.amountCents;

    const account = await this.prisma.account.findUnique({ where: { id: existing.accountId } });
    if (!account) throw new NotFoundException('Account not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id },
        data: {
          amountCents: newSigned,
          type: newType,
          categoryId: dto.categoryId === null ? null : dto.categoryId,
          description: dto.description,
          notes: dto.notes,
          transactionDate: dto.transactionDate ? new Date(dto.transactionDate) : undefined,
        },
      });
      if (delta !== 0n) {
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balanceCents: { increment: delta } },
        });
      }
      // Propaga sull'addebito CdC linkato se è una transazione su carta
      if (account.type === AccountType.credit_card && existing.ccChargeId) {
        await this.creditCards.updateLinkedCharge(tx, existing, updated, {
          paymentAccountId: account.paymentAccountId,
          billingDay: account.billingDay,
        });
      }
      const result = await tx.transaction.findUnique({
        where: { id },
        include: TRANSACTION_INCLUDE,
      });
      void this.audit.log(userId, AuditAction.update, AuditEntity.transaction, id, {
        delta: delta.toString(),
      });
      // Replica la nuova categoria agli altri membri se è cambiata
      const newCategoryId = dto.categoryId;
      if (newCategoryId && newCategoryId !== existing.categoryId) {
        void this.categorySharing.replicateCategoryToAccountMembers(
          existing.accountId,
          newCategoryId,
          userId,
        );
      }
      return result;
    });
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.transaction.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Transaction not found');
    await this.policy.assertWrite(userId, existing.accountId);

    if (existing.type === TransactionType.transfer || existing.transferPairId) {
      throw new BadRequestException('Use /transfers endpoint to delete transfers');
    }

    const account = await this.prisma.account.findUnique({ where: { id: existing.accountId } });

    await this.prisma.$transaction(async (tx) => {
      // Se è il lato CdC di una coppia, sgancia e cancella anche il charge
      if (account?.type === AccountType.credit_card && existing.ccChargeId) {
        await this.creditCards.deleteLinkedCharge(tx, existing);
      }
      await tx.transaction.delete({ where: { id } });
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balanceCents: { decrement: existing.amountCents } },
      });
    });
    void this.audit.log(userId, AuditAction.delete, AuditEntity.transaction, id, {
      accountId: existing.accountId,
      amountCents: existing.amountCents.toString(),
    });
  }

  private async assertCategoryOwned(userId: string, categoryId: string) {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c || c.userId !== userId) throw new NotFoundException('Category not found');
  }
}
