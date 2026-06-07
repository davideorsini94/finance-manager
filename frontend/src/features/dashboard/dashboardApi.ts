import { api } from '@/lib/api/client';
import type { Transaction } from '@/types/domain';

export interface PeriodTotals {
  incomeCents: string;
  expenseCents: string;
  netCents: string;
  txCount: number;
}

export interface CategoryBreakdownItem {
  categoryId: string | null;
  categoryName: string;
  color: string | null;
  amountCents: string;
  count: number;
}

/**
 * Nodo gerarchico della spesa per categoria: categorie padre al primo livello,
 * sottocategorie nei `children`. Un nodo senza `children` con `categoryId`
 * valorizzato è drillabile fino alle singole transazioni.
 */
export interface CategoryNode {
  /** ID delle categorie unificate sotto questo nodo (per il drill-down). Vuoto per "Senza categoria". */
  categoryIds: string[];
  categoryName: string;
  color: string | null;
  amountCents: string;
  count: number;
  children: CategoryNode[];
}

export interface DailyPoint {
  date: string;
  incomeCents: string;
  expenseCents: string;
  balanceCents: string;
}

export interface DashboardData {
  from: string;
  to: string;
  accountIds: string[] | null;
  totals: PeriodTotals;
  byCategory: CategoryBreakdownItem[];
  daily: DailyPoint[];
  recent: Transaction[];
}

export interface MonthlyAggregate {
  month: number;
  incomeCents: string;
  expenseCents: string;
  netCents: string;
}

export interface AnnualReport {
  year: number;
  totals: PeriodTotals;
  byMonth: MonthlyAggregate[];
  byCategory: CategoryBreakdownItem[];
  byCategoryTree: CategoryNode[];
}

export interface MonthlyReport {
  from: string;
  to: string;
  totals: PeriodTotals;
  byCategory: CategoryBreakdownItem[];
  byCategoryTree: CategoryNode[];
  daily: DailyPoint[];
}

export interface CustomReport {
  from: string;
  to: string;
  totals: PeriodTotals;
  byCategory: CategoryBreakdownItem[];
  daily: DailyPoint[];
}

export interface CompareReport {
  period1: { from: Date; to: Date; totals: PeriodTotals; categories: CategoryBreakdownItem[] };
  period2: { from: Date; to: Date; totals: PeriodTotals; categories: CategoryBreakdownItem[] };
}

export const reportsApi = {
  dashboard: (from?: string, to?: string, accountIds?: string[]) =>
    api
      .get('reports/dashboard', { searchParams: buildParams({ from, to, accountIds }) })
      .json<DashboardData>(),

  annual: (year: number, accountIds?: string[]) =>
    api
      .get('reports/annual', {
        searchParams: buildParams({ year: String(year), accountIds }),
      })
      .json<AnnualReport>(),

  monthly: (year: number, month: number, accountIds?: string[]) =>
    api
      .get('reports/monthly', {
        searchParams: buildParams({ year: String(year), month: String(month), accountIds }),
      })
      .json<MonthlyReport>(),

  custom: (from: string, to: string, accountIds?: string[]) =>
    api
      .get('reports/custom', { searchParams: buildParams({ from, to, accountIds }) })
      .json<CustomReport>(),

  compare: (
    period1From: string,
    period1To: string,
    period2From: string,
    period2To: string,
    accountIds?: string[],
  ) =>
    api
      .get('reports/compare', {
        searchParams: buildParams({
          period1From,
          period1To,
          period2From,
          period2To,
          accountIds,
        }),
      })
      .json<CompareReport>(),
};

/**
 * Costruisce URLSearchParams gestendo array multi-valore (es. `accountIds`)
 * come `?accountIds=a&accountIds=b`. Salta valori vuoti o undefined.
 */
function buildParams(o: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item) params.append(k, item);
      }
    } else {
      params.append(k, v);
    }
  }
  return params;
}
