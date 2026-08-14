import { Module } from '@nestjs/common';
import { LlmChatModule } from '../llm-chat/llm-chat.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { CategoryAiService } from './category-ai.service';

@Module({
  // LlmChatModule esporta LlmConfigService (modello Ollama attivo), usato da
  // CategoryAiService. Nessun ciclo: llm-chat non dipende da imports.
  imports: [LlmChatModule],
  controllers: [ImportsController],
  providers: [ImportsService, CategoryAiService],
  // CategoryAiService è esportato per BankSyncModule (categorizzazione della
  // coda di revisione bancaria): stesso classificatore, un solo prompt da
  // mantenere. Nessun ciclo: imports non dipende da bank-sync.
  exports: [ImportsService, CategoryAiService],
})
export class ImportsModule {}
