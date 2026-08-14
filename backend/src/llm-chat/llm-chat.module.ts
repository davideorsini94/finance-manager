import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { LlmChatController } from './llm-chat.controller';
import { LlmChatService } from './llm-chat.service';
import { LlmSettingsController } from './llm-settings.controller';
import { LlmConfigService } from './llm-config.service';
import { LlmModelsService } from './llm-models.service';
import { ToolRegistry } from './tools/tool-registry';

@Module({
  imports: [ReportsModule, BudgetsModule],
  controllers: [LlmChatController, LlmSettingsController],
  providers: [LlmChatService, LlmConfigService, LlmModelsService, ToolRegistry],
  // Esportato per ImportsModule (CategoryAiService deve risolvere il modello attivo).
  exports: [LlmConfigService],
})
export class LlmChatModule {}
