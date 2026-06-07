import { Controller, Get, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AdvancedReportsService } from './advanced-reports.service';

const ToStringArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Array.isArray(value) ? value : [value];
  });

class CashflowQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  forecastMonths?: number;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

class CompareV2Query {
  @IsOptional()
  @IsEnum(['mom', 'yoy'])
  mode?: 'mom' | 'yoy';

  @IsOptional()
  @IsString()
  month?: string;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

class SankeyQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

class ProjectionsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yearsAhead?: number;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

@Controller('reports/advanced')
export class AdvancedReportsController {
  constructor(private readonly service: AdvancedReportsService) {}

  @Get('cashflow')
  cashflow(@CurrentUser() u: AuthUser, @Query() q: CashflowQuery) {
    return this.service.cashflow(u.id, q.months ?? 12, q.forecastMonths ?? 6, q.accountIds);
  }

  @Get('compare')
  compare(@CurrentUser() u: AuthUser, @Query() q: CompareV2Query) {
    return this.service.comparePeriods(u.id, q.mode ?? 'mom', q.month, q.accountIds);
  }

  @Get('sankey')
  sankey(@CurrentUser() u: AuthUser, @Query() q: SankeyQuery) {
    return this.service.sankey(u.id, q.from, q.to, q.accountIds);
  }

  @Get('projections')
  projections(@CurrentUser() u: AuthUser, @Query() q: ProjectionsQuery) {
    return this.service.projectBalances(u.id, q.yearsAhead ?? 3, q.accountIds);
  }

  @Get('export')
  export(
    @CurrentUser() u: AuthUser,
    @Query('format') format: 'pdf' | 'xlsx',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.exportReport(u.id, format, from, to);
  }
}
