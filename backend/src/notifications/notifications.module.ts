import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { BudgetThresholdProbe } from './budget-threshold.cron';
import { LargeTransactionProbe } from './large-transaction.probe';
import { CcPaymentDueProbe } from './cc-payment-due.cron';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    BudgetThresholdProbe,
    LargeTransactionProbe,
    CcPaymentDueProbe,
  ],
  exports: [NotificationsService, LargeTransactionProbe],
})
export class NotificationsModule {}
