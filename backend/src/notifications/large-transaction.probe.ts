import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Soglia "transazione grande" = 95° percentile delle ultime 90 transazioni
 * dell'utente, con minimo €100. Calcolata on-demand al check.
 *
 * Usato come hook chiamato dopo la creazione di una transazione (vedi
 * INTEGRATION.md per la patch a TransactionsService).
 */
@Injectable()
export class LargeTransactionProbe {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async checkAndNotify(userId: string, transactionId: string): Promise<void> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { account: { select: { name: true } } },
    });
    if (!tx || tx.userId !== userId) return;
    // ignora trasferimenti e pending charges
    if (tx.type === 'transfer' || tx.transferPairId) return;

    const amountAbs = tx.amountCents < 0n ? -tx.amountCents : tx.amountCents;
    const threshold = await this.computeThreshold(userId);
    if (amountAbs < threshold) return;

    await this.notifications.create({
      userId,
      type: NotificationType.large_transaction,
      title: `Movimento rilevante: ${formatEuro(amountAbs)}`,
      body: tx.description ?? `Su ${tx.account.name}`,
      data: {
        kind: 'large_transaction',
        transactionId: tx.id,
        amountCents: amountAbs.toString(),
        thresholdCents: threshold.toString(),
      },
      dedupKey: `large:${tx.id}`,
    });
  }

  private async computeThreshold(userId: string): Promise<bigint> {
    const samples = await this.prisma.transaction.findMany({
      where: { userId, type: { not: 'transfer' } },
      orderBy: { createdAt: 'desc' },
      take: 90,
      select: { amountCents: true },
    });
    if (samples.length < 10) return 10000n; // fallback €100
    const abs = samples
      .map((s) => (s.amountCents < 0n ? -s.amountCents : s.amountCents))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const idx = Math.floor(abs.length * 0.95);
    const p95 = abs[Math.min(idx, abs.length - 1)];
    return p95 > 10000n ? p95 : 10000n;
  }
}

function formatEuro(cents: bigint): string {
  const n = Number(cents) / 100;
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
}
