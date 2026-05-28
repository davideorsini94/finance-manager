import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccountType, Prisma, Transaction, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class CreditCardsService {
  private readonly logger = new Logger(CreditCardsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcola la prima data utile ≥ billingDay del MESE SUCCESSIVO a txDate.
   * Se billingDay > giorni del mese target, usa l'ultimo giorno disponibile.
   */
  static nextBillingDate(txDate: Date, billingDay: number): Date {
    const d = new Date(Date.UTC(txDate.getUTCFullYear(), txDate.getUTCMonth() + 1, 1));
    const lastDayOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(billingDay, lastDayOfMonth));
    return d;
  }

  /**
   * Dopo aver creato un movimento su un conto CdC, genera l'addebito futuro
   * sul conto di pagamento. L'addebito è marcato is_pending=true e NON
   * impatta il saldo del conto di pagamento finché lo scheduler non lo salda
   * alla data prevista.
   */
  async generateChargeForCcTx(
    tx: PrismaTx,
    ccTransaction: Transaction,
    creditAccount: { paymentAccountId: string | null; billingDay: number | null },
  ): Promise<Transaction> {
    if (!creditAccount.paymentAccountId || !creditAccount.billingDay) {
      throw new BadRequestException('Credit card account is misconfigured');
    }
    const billingDate = CreditCardsService.nextBillingDate(
      ccTransaction.transactionDate,
      creditAccount.billingDay,
    );

    const charge = await tx.transaction.create({
      data: {
        accountId: creditAccount.paymentAccountId,
        userId: ccTransaction.userId,
        amountCents: ccTransaction.amountCents,
        type: TransactionType.expense,
        description: `Addebito CdC: ${ccTransaction.description ?? 'spesa carta'}`,
        transactionDate: billingDate,
        ccChargeId: ccTransaction.id,
        isPending: true,
      },
    });
    await tx.transaction.update({
      where: { id: ccTransaction.id },
      data: { ccChargeId: charge.id },
    });
    return charge;
  }

  /**
   * Propaga modifiche di importo/data dal movimento CdC all'addebito linkato.
   * Aggiusta il saldo SOLO se l'addebito è già stato saldato (raro, ma
   * possibile se l'utente modifica un movimento dopo la data di addebito).
   */
  async updateLinkedCharge(
    tx: PrismaTx,
    oldCcTx: Transaction,
    newCcTx: Transaction,
    creditAccount: { paymentAccountId: string | null; billingDay: number | null },
  ): Promise<void> {
    if (!oldCcTx.ccChargeId || !creditAccount.billingDay) return;
    const charge = await tx.transaction.findUnique({ where: { id: oldCcTx.ccChargeId } });
    if (!charge) return;

    const newBilling = CreditCardsService.nextBillingDate(
      newCcTx.transactionDate,
      creditAccount.billingDay,
    );
    const delta = newCcTx.amountCents - charge.amountCents;

    await tx.transaction.update({
      where: { id: charge.id },
      data: {
        amountCents: newCcTx.amountCents,
        transactionDate: newBilling,
        description: `Addebito CdC: ${newCcTx.description ?? 'spesa carta'}`,
      },
    });

    // Se l'addebito è già stato saldato, riallinea il saldo del conto pagamento
    if (!charge.isPending && delta !== 0n) {
      await tx.account.update({
        where: { id: charge.accountId },
        data: { balanceCents: { increment: delta } },
      });
    }
  }

  /**
   * Cancella l'addebito linkato. Se è ancora pending lo elimina senza toccare
   * il saldo. Se è già stato saldato annulla l'effetto sul saldo del conto pagamento.
   */
  async deleteLinkedCharge(tx: PrismaTx, ccTransaction: Transaction): Promise<void> {
    if (!ccTransaction.ccChargeId) return;
    const charge = await tx.transaction.findUnique({ where: { id: ccTransaction.ccChargeId } });
    if (!charge) return;

    await tx.transaction.delete({ where: { id: charge.id } });
    if (!charge.isPending) {
      await tx.account.update({
        where: { id: charge.accountId },
        data: { balanceCents: { decrement: charge.amountCents } },
      });
    }
  }

  async listCharges(userId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, archivedAt: null },
      select: { id: true, type: true, ownerId: true, members: { where: { userId } } },
    });
    if (!account) throw new NotFoundException('Account not found');
    if (account.type !== AccountType.credit_card) {
      throw new BadRequestException('Not a credit card account');
    }
    const isMember = account.ownerId === userId || account.members.length > 0;
    if (!isMember) throw new NotFoundException('Account not found');

    return this.prisma.transaction.findMany({
      where: { ccChargeId: { not: null }, accountId },
      orderBy: { transactionDate: 'asc' },
    });
  }

  /**
   * Ogni notte alle 02:00: salda gli addebiti pending con date <= oggi.
   * "Saldare" significa: marcare is_pending=false e applicare l'effetto
   * sul saldo del conto di pagamento.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async settleDueCharges(): Promise<void> {
    const today = new Date();
    const due = await this.prisma.transaction.findMany({
      where: {
        isPending: true,
        ccChargeId: { not: null },
        transactionDate: { lte: today },
      },
    });
    if (due.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const charge of due) {
        await tx.transaction.update({
          where: { id: charge.id },
          data: { isPending: false },
        });
        await tx.account.update({
          where: { id: charge.accountId },
          data: { balanceCents: { increment: charge.amountCents } },
        });
      }
    });
    this.logger.log(`Settled ${due.length} credit card charges`);
  }
}
