import { Module } from '@nestjs/common';
import { LlmChatModule } from '../llm-chat/llm-chat.module';
import { ReportsModule } from '../reports/reports.module';
import { LlmReportsController } from './llm-reports.controller';
import { LlmReportsService } from './llm-reports.service';

/**
 * Modulo autonomo, non una sottocartella di `reports/`: `LlmChatModule` importa
 * già `ReportsModule` (i tool della chat leggono i report), quindi far
 * dipendere `ReportsModule` da `LlmChatModule` creerebbe un ciclo. Qui
 * importiamo entrambi e non siamo importati da nessuno.
 */
@Module({
  imports: [ReportsModule, LlmChatModule],
  controllers: [LlmReportsController],
  providers: [LlmReportsService],
})
export class LlmReportsModule {}
