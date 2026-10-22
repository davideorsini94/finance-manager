import { Module } from '@nestjs/common';
import { LlmChatModule } from '../llm-chat/llm-chat.module';
import { BillExtractorService } from './bill-extractor.service';
import { UtilityBillsController } from './utility-bills.controller';
import { UtilityBillsService } from './utility-bills.service';

/**
 * Bollette di luce, gas e acqua. Indipendente dai movimenti bancari: non
 * importa né Transactions né Accounts. Da `LlmChatModule` prende solo la
 * configurazione LLM e il client OpenCode per leggere i PDF. MinIO e Prisma
 * sono moduli globali.
 */
@Module({
  imports: [LlmChatModule],
  controllers: [UtilityBillsController],
  providers: [UtilityBillsService, BillExtractorService],
})
export class UtilityBillsModule {}
