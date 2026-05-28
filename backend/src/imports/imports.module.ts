import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { CategoryAiService } from './category-ai.service';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService, CategoryAiService],
  exports: [ImportsService],
})
export class ImportsModule {}
