import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Probe giornaliero: trova gli addebiti di carta di credito (cc charges:
 * transazione di tipo expense con `ccChargeId` valorizzato sul lato CdC,
 * o transazione "di pagamento" sul conto corrente con `transferPairId`
 * che riferisce un charge) la cui data è nei prossimi 3 giorni e crea
 * una notifica `cc_payment_due` per l'utente proprietario.
 *
 * Implementazione: cerchiamo le transazioni `pending` future ≤3gg sul
 * conto di pagamento collegato. Idempotente via dedupKey.
 */
@Injectable()
export class CcPaymentDueProbe {
  private readonly logger = new Logger(CcPaymentDueProbe.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async run(): Promise<void> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + 3);

    // Tutte le carte di credito attive con paymentAccountId
    const cards = await this.prisma.account.findMany({
      where: { type: 'credit_card', archivedAt: null, paymentAccountId: { not: null } },
      select: { id: true, name: true, ownerId: true },
    });

    let count = 0;
    for (const card of cards) {
      // Aggrega i charge in scadenza (lato carta, isPending=false significa
      // già conteggiato; isPending=true = saldo del periodo non ancora chiuso)
      const dues = await this.prisma.transaction.findMany({
        where: {
          accountId: card.id,
          type: TransactionType.expense,
          isPending: true,
          transactionDate: { gte: today, lte: horizon },
        },
        select: { id: true, amountCents: true, transactionDate: true },
      });
      if (dues.length === 0) continue;

      const total = dues.reduce(
        (acc, d) => acc + (d.amountCents < 0n ? -d.amountCents : d.amountCents),
        0n,
      );
      const dueDate = dues
        .map((d) => d.transactionDate)
        .sort((a, b) => a.getTime() - b.getTime())[0]
        .toISOString()
        .slice(0, 10);

      const created = await this.notifications.create({
        userId: card.ownerId,
        type: NotificationType.cc_payment_due,
        title: `Addebito ${card.name} in arrivo`,
        body: `Importo: ${formatEuro(total)} — saldo previsto il ${formatDateIt(dueDate)}.`,
        data: {
          kind: 'cc_payment_due',
          chargeTransactionId: dues[0].id,
          cardAccountId: card.id,
          cardName: card.name,
          amountCents: total.toString(),
          dueDate,
        },
        dedupKey: `cc_due:${card.id}:${dueDate}`,
      });
      if (created) count++;
    }

    if (count > 0) this.logger.log(`Created ${count} CC payment-due notifications`);
  }
}

function formatEuro(cents: bigint): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(
    Number(cents) / 100,
  );
}
function formatDateIt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
