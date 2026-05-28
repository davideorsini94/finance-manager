import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Probe giornaliero: per ogni budget del mese corrente di ogni utente,
 * calcola la spesa effettiva e — se supera 80% o 100% del limite —
 * crea una notifica `budget_threshold`. Idempotente via dedupKey.
 */
@Injectable()
export class BudgetThresholdProbe {
  private readonly logger = new Logger(BudgetThresholdProbe.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    const monthStr = new Date().toISOString().slice(0, 7);
    const [y, m] = monthStr.split('-').map((s) => parseInt(s, 10));
    const start = new Date(Date.UTC(y, m - 1, 1));
    const nextStart = new Date(Date.UTC(y, m, 1));

    const budgets = await this.prisma.budget.findMany({
      where: { month: start },
      include: { category: { select: { name: true } } },
    });
    if (budgets.length === 0) return;

    // Spesa per categoria nel mese (per tutti i conti accessibili: usiamo
    // l'utente owner del budget; in caso di conti condivisi la spesa di
    // categoria è già su transazioni dell'utente).
    let count = 0;
    for (const b of budgets) {
      const spent = await this.prisma.transaction.aggregate({
        where: {
          userId: b.userId,
          categoryId: b.categoryId,
          transactionDate: { gte: start, lt: nextStart },
          amountCents: { lt: 0 },
        },
        _sum: { amountCents: true },
      });
      const spentAbs = -(spent._sum.amountCents ?? 0n);
      if (spentAbs <= 0n) continue;
      const pct = Number((spentAbs * 100n) / b.limitCents);

      // Soglie: 80% e 100% (la 100 sovrascrive la 80 grazie a dedupKey separati)
      for (const threshold of [80, 100]) {
        if (pct < threshold) continue;
        const created = await this.notifications.create({
          userId: b.userId,
          type: NotificationType.budget_threshold,
          title:
            threshold === 100
              ? `Budget superato: ${b.category.name}`
              : `Budget all'80%: ${b.category.name}`,
          body:
            threshold === 100
              ? `Hai superato il budget mensile per ${b.category.name}.`
              : `Hai usato l'${pct}% del budget di ${b.category.name} questo mese.`,
          data: {
            kind: 'budget_threshold',
            budgetId: b.id,
            categoryId: b.categoryId,
            categoryName: b.category.name,
            spentCents: spentAbs.toString(),
            limitCents: b.limitCents.toString(),
            pct,
            month: monthStr,
          },
          dedupKey: `budget:${b.id}:${monthStr}:${threshold}`,
        });
        if (created) count++;
      }
    }
    if (count > 0) this.logger.log(`Created ${count} budget threshold notifications`);
  }
}
