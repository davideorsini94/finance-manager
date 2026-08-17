import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import {
  AnnualReportQueryDto,
  CompareQueryDto,
  CustomReportQueryDto,
  DashboardQueryDto,
  MonthlyReportQueryDto,
} from './dto/reports.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.reportsService.dashboard(
      user.id,
      query.from,
      query.to,
      query.accountIds,
      query.categoryIds,
    );
  }

  @Get('monthly')
  async monthly(@CurrentUser() user: AuthUser, @Query() query: MonthlyReportQueryDto) {
    const from = new Date(Date.UTC(query.year, query.month - 1, 1));
    const to = new Date(Date.UTC(query.year, query.month, 0));
    // Due alberi (uscite + entrate): il selettore Entrate/Uscite della pagina
    // Report cambia solo la vista, senza rifare la richiesta.
    const [totals, breakdown, tree, treeIncome, daily] = await Promise.all([
      this.reportsService.periodTotals(user.id, from, to, query.accountIds),
      this.reportsService.categoryBreakdown(user.id, from, to, query.accountIds),
      this.reportsService.categoryBreakdownTree(user.id, from, to, query.accountIds),
      this.reportsService.categoryBreakdownTree(
        user.id,
        from,
        to,
        query.accountIds,
        undefined,
        'income',
      ),
      this.reportsService.dailyTimeSeries(user.id, from, to, query.accountIds),
    ]);
    return {
      from,
      to,
      totals,
      byCategory: breakdown,
      byCategoryTree: tree,
      byCategoryTreeIncome: treeIncome,
      daily,
    };
  }

  @Get('annual')
  async annual(@CurrentUser() user: AuthUser, @Query() query: AnnualReportQueryDto) {
    const from = new Date(Date.UTC(query.year, 0, 1));
    const to = new Date(Date.UTC(query.year, 11, 31));
    const [totals, byMonth, breakdown, tree, treeIncome] = await Promise.all([
      this.reportsService.periodTotals(user.id, from, to, query.accountIds),
      this.reportsService.monthlyAggregates(user.id, query.year, query.accountIds),
      this.reportsService.categoryBreakdown(user.id, from, to, query.accountIds),
      this.reportsService.categoryBreakdownTree(user.id, from, to, query.accountIds),
      this.reportsService.categoryBreakdownTree(
        user.id,
        from,
        to,
        query.accountIds,
        undefined,
        'income',
      ),
    ]);
    return {
      year: query.year,
      totals,
      byMonth,
      byCategory: breakdown,
      byCategoryTree: tree,
      byCategoryTreeIncome: treeIncome,
    };
  }

  @Get('custom')
  async custom(@CurrentUser() user: AuthUser, @Query() query: CustomReportQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const [totals, byCategory, daily] = await Promise.all([
      this.reportsService.periodTotals(user.id, from, to, query.accountIds),
      this.reportsService.categoryBreakdown(user.id, from, to, query.accountIds),
      this.reportsService.dailyTimeSeries(user.id, from, to, query.accountIds),
    ]);
    return { from, to, totals, byCategory, daily };
  }

  @Get('compare')
  compare(@CurrentUser() user: AuthUser, @Query() query: CompareQueryDto) {
    return this.reportsService.comparePeriods(
      user.id,
      { from: new Date(query.period1From), to: new Date(query.period1To) },
      { from: new Date(query.period2From), to: new Date(query.period2To) },
      query.accountIds,
    );
  }
}
