import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { LlmChatController } from './llm-chat.controller';
import { LlmChatService } from './llm-chat.service';
import { ToolRegistry } from './tools/tool-registry';

@Module({
  imports: [ReportsModule, BudgetsModule],
  controllers: [LlmChatController],
  providers: [LlmChatService, ToolRegistry],
})
export class LlmChatModule {}
