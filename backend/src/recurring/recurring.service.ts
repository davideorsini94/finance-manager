import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccountType, RecurrenceFreq, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { CreateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
    private readonly creditCards: CreditCardsService,
  ) {}

  static computeNext(date: Date, freq: RecurrenceFreq): Date {
    const d = new Date(date);
    switch (freq) {
      case RecurrenceFreq.daily:
        d.setUTCDate(d.getUTCDate() + 1);
        break;
      case RecurrenceFreq.weekly:
        d.setUTCDate(d.getUTCDate() + 7);
        break;
      case RecurrenceFreq.biweekly:
        d.setUTCDate(d.getUTCDate() + 14);
        break;
      case RecurrenceFreq.monthly:
        d.setUTCMonth(d.getUTCMonth() + 1);
        break;
      case RecurrenceFreq.quarterly:
        d.setUTCMonth(d.getUTCMonth() + 3);
        break;
      case RecurrenceFreq.yearly:
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        break;
    }
    return d;
  }

  async create(userId: string, dto: CreateRecurringDto) {
    await this.policy.assertWrite(userId, dto.accountId);

    if (dto.type === TransactionType.transfer) {
      if (!dto.toAccountId) {
        throw new BadRequestException('toAccountId richiesto per i giroconti ricorrenti');
      }
      if (dto.toAccountId === dto.accountId) {
        throw new BadRequestException('Conto sorgente e destinazione devono essere diversi');
      }
      await this.policy.assertWrite(userId, dto.toAccountId);
    }
    if (dto.categoryId) await this.assertCategoryOwned(userId, dto.categoryId);

    return this.prisma.recurringRule.create({
      data: {
        userId,
        accountId: dto.accountId,
        toAccountId: dto.type === TransactionType.transfer ? dto.toAccountId! : null,
        categoryId: dto.categoryId ?? null,
        amountCents: BigInt(dto.amountCents),
        type: dto.type,
        description: dto.description,
        frequency: dto.frequency,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        nextRunDate: new Date(dto.startDate),
      },
      include: {
        account: { select: { id: true, name: true, type: true } },
        toAccount: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    });
  }

  list(userId: string) {
    return this.prisma.recurringRule.findMany({
      where: { userId },
      orderBy: [{ isActive: 'desc' }, { nextRunDate: 'asc' }],
      include: {
        account: { select: { id: true, name: true, type: true } },
        toAccount: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateRecurringDto) {
    const rule = await this.prisma.recurringRule.findUnique({ where: { id } });
    if (!rule || rule.userId !== userId) throw new NotFoundException('Recurring rule not found');

    if (dto.accountId && dto.accountId !== rule.accountId) {
      await this.policy.assertWrite(userId, dto.accountId);
    }

    const nextType = dto.type ?? rule.type;
    if (nextType === TransactionType.transfer) {
      const nextFromId = dto.accountId ?? rule.accountId;
      const nextToId = dto.toAccountId === undefined ? rule.toAccountId : dto.toAccountId;
      if (!nextToId) {
        throw new BadRequestException('toAccountId richiesto per i giroconti ricorrenti');
      }
      if (nextToId === nextFromId) {
        throw new BadRequestException('Conto sorgente e destinazione devono essere diversi');
      }
      if (dto.toAccountId !== undefined && dto.toAccountId !== rule.toAccountId) {
        await this.policy.assertWrite(userId, nextToId);
      }
    }

    if (dto.categoryId) await this.assertCategoryOwned(userId, dto.categoryId);

    // Se cambia la frequenza o la startDate "all'inizio" (regola mai eseguita
    // ancora), allineo nextRunDate.
    let nextRunDate: Date | undefined;
    if (dto.startDate) {
      const newStart = new Date(dto.startDate);
      if (rule.startDate.getTime() === rule.nextRunDate.getTime()) {
        // mai eseguita: allineo
        nextRunDate = newStart;
      }
    }

    return this.prisma.recurringRule.update({
      where: { id },
      data: {
        accountId: dto.accountId,
        toAccountId:
          nextType === TransactionType.transfer
            ? dto.toAccountId === undefined
              ? undefined
              : dto.toAccountId
            : null,
        type: dto.type,
        amountCents: dto.amountCents !== undefined ? BigInt(dto.amountCents) : undefined,
        categoryId: dto.categoryId === null ? null : dto.categoryId,
        description: dto.description,
        frequency: dto.frequency,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        nextRunDate,
        endDate:
          dto.endDate === null ? null : dto.endDate ? new Date(dto.endDate) : undefined,
        isActive: dto.isActive,
      },
      include: {
        account: { select: { id: true, name: true, type: true } },
        toAccount: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    });
  }

  async remove(userId: string, id: string) {
    const rule = await this.prisma.recurringRule.findUnique({ where: { id } });
    if (!rule || rule.userId !== userId) throw new NotFoundException('Recurring rule not found');
    await this.prisma.recurringRule.delete({ where: { id } });
  }

  /**
   * Esegue una singola regola N volte finché next_run_date <= today.
   */
  private async executeRule(ruleId: string): Promise<number> {
    let generated = 0;
    while (true) {
      const rule = await this.prisma.recurringRule.findUnique({ where: { id: ruleId } });
      if (!rule || !rule.isActive) break;
      if (rule.nextRunDate > new Date()) break;
      if (rule.endDate && rule.nextRunDate > rule.endDate) {
        await this.prisma.recurringRule.update({
          where: { id: rule.id },
          data: { isActive: false },
        });
        break;
      }

      const account = await this.prisma.account.findUnique({ where: { id: rule.accountId } });
      if (!account || account.archivedAt) {
        await this.prisma.recurringRule.update({
          where: { id: rule.id },
          data: { isActive: false },
        });
        break;
      }

      if (rule.type === TransactionType.transfer) {
        if (!rule.toAccountId) {
          // regola transfer mal configurata: disattivo per evitare loop
          await this.prisma.recurringRule.update({
            where: { id: rule.id },
            data: { isActive: false },
          });
          break;
        }
        const dest = await this.prisma.account.findUnique({ where: { id: rule.toAccountId } });
        if (!dest || dest.archivedAt) {
          await this.prisma.recurringRule.update({
            where: { id: rule.id },
            data: { isActive: false },
          });
          break;
        }
        await this.executeTransfer(rule, dest.id);
      } else {
        await this.executeIncomeOrExpense(rule, account);
      }

      generated++;
      if (generated > 365) {
        this.logger.warn(`Rule ${ruleId} produced >365 transactions in one tick; aborting`);
        break;
      }
    }
    return generated;
  }

  private async executeIncomeOrExpense(
    rule: NonNullable<Awaited<ReturnType<PrismaService['recurringRule']['findUnique']>>>,
    account: NonNullable<Awaited<ReturnType<PrismaService['account']['findUnique']>>>,
  ) {
    const signed = rule.type === TransactionType.income ? rule.amountCents : -rule.amountCents;
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          accountId: rule.accountId,
          userId: rule.userId,
          amountCents: signed,
          type: rule.type,
          categoryId: rule.categoryId,
          description: rule.description,
          transactionDate: rule.nextRunDate,
          recurringRuleId: rule.id,
        },
      });
      await tx.account.update({
        where: { id: rule.accountId },
        data: { balanceCents: { increment: signed } },
      });
      if (account.type === AccountType.credit_card && rule.type === TransactionType.expense) {
        await this.creditCards.generateChargeForCcTx(tx, created, {
          paymentAccountId: account.paymentAccountId,
          billingDay: account.billingDay,
        });
      }
      await tx.recurringRule.update({
        where: { id: rule.id },
        data: { nextRunDate: RecurringService.computeNext(rule.nextRunDate, rule.frequency) },
      });
    });
  }

  private async executeTransfer(
    rule: NonNullable<Awaited<ReturnType<PrismaService['recurringRule']['findUnique']>>>,
    toAccountId: string,
  ) {
    const out = -rule.amountCents;
    const inc = rule.amountCents;
    await this.prisma.$transaction(async (tx) => {
      const txOut = await tx.transaction.create({
        data: {
          accountId: rule.accountId,
          userId: rule.userId,
          amountCents: out,
          type: TransactionType.transfer,
          categoryId: rule.categoryId,
          description: rule.description,
          transactionDate: rule.nextRunDate,
          recurringRuleId: rule.id,
        },
      });
      const txIn = await tx.transaction.create({
        data: {
          accountId: toAccountId,
          userId: rule.userId,
          amountCents: inc,
          type: TransactionType.transfer,
          categoryId: rule.categoryId,
          description: rule.description,
          transactionDate: rule.nextRunDate,
          recurringRuleId: rule.id,
          transferPairId: txOut.id,
        },
      });
      await tx.transaction.update({
        where: { id: txOut.id },
        data: { transferPairId: txIn.id },
      });
      await tx.account.update({
        where: { id: rule.accountId },
        data: { balanceCents: { increment: out } },
      });
      await tx.account.update({
        where: { id: toAccountId },
        data: { balanceCents: { increment: inc } },
      });
      await tx.recurringRule.update({
        where: { id: rule.id },
        data: { nextRunDate: RecurringService.computeNext(rule.nextRunDate, rule.frequency) },
      });
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async runDueRules(): Promise<void> {
    const due = await this.prisma.recurringRule.findMany({
      where: { isActive: true, nextRunDate: { lte: new Date() } },
      select: { id: true },
    });
    let total = 0;
    for (const r of due) {
      total += await this.executeRule(r.id);
    }
    if (total > 0) this.logger.log(`Generated ${total} recurring transactions`);
  }

  /** Trigger manuale per testing */
  async runNow(): Promise<{ generated: number }> {
    const due = await this.prisma.recurringRule.findMany({
      where: { isActive: true, nextRunDate: { lte: new Date() } },
      select: { id: true },
    });
    let total = 0;
    for (const r of due) total += await this.executeRule(r.id);
    return { generated: total };
  }

  private async assertCategoryOwned(userId: string, categoryId: string) {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c || c.userId !== userId) throw new NotFoundException('Category not found');
  }
}
