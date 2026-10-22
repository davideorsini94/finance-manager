import { Module } from '@nestjs/common';
import { LlmChatModule } from '../llm-chat/llm-chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillExtractorService } from './bill-extractor.service';
import { UtilityBillsController } from './utility-bills.controller';
import { UtilityBillsService } from './utility-bills.service';
import { HouseholdsController } from './households.controller';
import { HouseholdsService } from './households.service';

/**
 * Bollette di luce, gas e acqua. Indipendente dai movimenti bancari: non
 * importa né Transactions né Accounts. Da `LlmChatModule` prende solo la
 * configurazione LLM e il client OpenCode per leggere i PDF. MinIO e Prisma
 * sono moduli globali.
 */
@Module({
  imports: [LlmChatModule, NotificationsModule],
  controllers: [UtilityBillsController, HouseholdsController],
  providers: [UtilityBillsService, BillExtractorService, HouseholdsService],
})
export class UtilityBillsModule {}
