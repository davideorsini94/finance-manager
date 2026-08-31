import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { GenerateLlmReportDto, LlmReportQueryDto } from './dto/llm-report.dto';
import { LlmReportsService } from './llm-reports.service';

@Controller('reports/llm')
export class LlmReportsController {
  constructor(private readonly service: LlmReportsService) {}

  /** Sola lettura: un GET che scatena lavoro e costi sarebbe una trappola per prefetch e retry. */
  @Get()
  status(@CurrentUser() user: AuthUser, @Query() query: LlmReportQueryDto) {
    return this.service.getStatus(user.id, query);
  }

  /** Ogni chiamata costa una generazione LLM: tetto stretto anche se il lock già protegge. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('generate')
  @HttpCode(202)
  generate(@CurrentUser() user: AuthUser, @Body() body: GenerateLlmReportDto) {
    return this.service.requestGeneration(user.id, body, body.force === true);
  }
}
