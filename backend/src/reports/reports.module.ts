import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportContextService } from './report-context.service';
import { AdvancedReportsController } from './advanced/advanced-reports.controller';
import { AdvancedReportsService } from './advanced/advanced-reports.service';

@Module({
  controllers: [ReportsController, AdvancedReportsController],
  providers: [ReportsService, ReportContextService, AdvancedReportsService],
  exports: [ReportsService, ReportContextService, AdvancedReportsService],
})
export class ReportsModule {}
