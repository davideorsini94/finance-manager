import { api } from '@/lib/api/client';

export type LlmReportScope = 'annual' | 'monthly';

export interface LlmReportParams {
  scope: LlmReportScope;
  year: number;
  month?: number;
  accountIds?: string[];
}

export interface LlmReportView {
  status: 'missing' | 'generating' | 'ready' | 'error';
  content: string | null;
  generatedAt: string | null;
  provider: string | null;
  model: string | null;
  /** I dati del periodo sono cambiati dopo la generazione. */
  stale: boolean;
  elapsedSeconds: number | null;
  errorMessage: string | null;
}

export const llmReportsApi = {
  get: (p: LlmReportParams) =>
    api.get('reports/llm', { searchParams: buildParams(p) }).json<LlmReportView>(),

  /** 202 se la generazione parte, 409 se è già in corso o serve la conferma. */
  generate: (p: LlmReportParams, force: boolean) =>
    api.post('reports/llm/generate', { json: { ...p, force } }).json<{ status: 'generating' }>(),
};

function buildParams(p: LlmReportParams): URLSearchParams {
  const params = new URLSearchParams();
  params.set('scope', p.scope);
  params.set('year', String(p.year));
  if (p.month !== undefined) params.set('month', String(p.month));
  for (const id of p.accountIds ?? []) params.append('accountIds', id);
  return params;
}
