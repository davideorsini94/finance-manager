import { Module } from '@nestjs/common';
import { LlmChatModule } from '../llm-chat/llm-chat.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  // Per invalidare la cache del modello LLM attivo dopo un restore.
  imports: [LlmChatModule],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
