import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { MinioModule } from './minio/minio.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AccountsModule } from './accounts/accounts.module';
import { CategoriesModule } from './categories/categories.module';
import { CreditCardsModule } from './credit-cards/credit-cards.module';
import { TransactionsModule } from './transactions/transactions.module';
import { TransfersModule } from './transfers/transfers.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { RecurringModule } from './recurring/recurring.module';
import { BudgetsModule } from './budgets/budgets.module';
import { GoalsModule } from './goals/goals.module';
import { ReportsModule } from './reports/reports.module';
import { LlmChatModule } from './llm-chat/llm-chat.module';
import { ImportsModule } from './imports/imports.module';
import { BackupModule } from './backup/backup.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SharingModule } from './sharing/sharing.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    MinioModule,
    MailModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    CategoriesModule,
    CreditCardsModule,
    TransactionsModule,
    TransfersModule,
    AttachmentsModule,
    RecurringModule,
    BudgetsModule,
    GoalsModule,
    ReportsModule,
    LlmChatModule,
    ImportsModule,
    BackupModule,
    SharingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
