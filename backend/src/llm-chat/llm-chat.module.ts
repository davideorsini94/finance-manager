import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { LlmChatController } from './llm-chat.controller';
import { LlmChatService } from './llm-chat.service';
import { LlmSettingsController } from './llm-settings.controller';
import { LlmConfigService } from './llm-config.service';
import { LlmModelsService } from './llm-models.service';
import { OpencodeClient } from './opencode.client';
import { OpencodeAvailabilityService } from './opencode-availability.service';
import { ToolRegistry } from './tools/tool-registry';

@Module({
  imports: [ReportsModule, BudgetsModule],
  controllers: [LlmChatController, LlmSettingsController],
  providers: [
    LlmChatService,
    LlmConfigService,
    LlmModelsService,
    OpencodeClient,
    OpencodeAvailabilityService,
    ToolRegistry,
  ],
  // Esportato per ImportsModule (CategoryAiService deve risolvere il modello attivo).
  exports: [LlmConfigService, OpencodeClient],
})
export class LlmChatModule {}
