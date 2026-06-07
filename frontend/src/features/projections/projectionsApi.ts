import { api } from '@/lib/api/client';

export interface ProjectionPoint {
  date: string; // YYYY-MM-DD (fine mese)
  balanceCents: string;
  isYearEnd: boolean;
}

export interface ProjectionAccount {
  accountId: string;
  name: string;
  type: string;
  color: string | null;
  currentBalanceCents: string;
  points: ProjectionPoint[];
}

export interface ProjectionResult {
  today: string;
  horizonYears: number;
  months: string[]; // YYYY-MM
  accounts: ProjectionAccount[];
  total: {
    currentBalanceCents: string;
    points: ProjectionPoint[];
  };
}

export const projectionsApi = {
  get: (yearsAhead: number, accountIds?: string[]) =>
    api
      .get('reports/advanced/projections', {
        searchParams: buildParams({ yearsAhead: String(yearsAhead), accountIds }),
      })
      .json<ProjectionResult>(),
};

function buildParams(o: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) if (item) params.append(k, item);
    } else {
      params.append(k, v);
    }
  }
  return params;
}
