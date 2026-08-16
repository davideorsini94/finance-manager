import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, FileSpreadsheet, FileText } from 'lucide-react';
import { api } from '@/lib/api/client';
import { AccountMultiSelect } from '@/components/shared/AccountMultiSelect';
import { accountsApi } from '@/features/accounts/accountsApi';
import { sortByName } from '@/lib/utils/sort';

/** Costruisce una query string `key=value&key=value` includendo array. */
function qs(params: Record<string, string | number | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v)) for (const item of v) sp.append(k, item);
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

interface CashflowResult {
  history: { month: string; income: number; expense: number; net: number; isForecast: boolean }[];
  forecast: { month: string; income: number; expense: number; net: number; isForecast: boolean }[];
  cumulativeBalance: { month: string; balance: number; isForecast: boolean }[];
}

interface CompareResult {
  mode: 'mom' | 'yoy';
  currentLabel: string;
  previousLabel: string;
  rows: {
    categoryId: string;
    categoryName: string;
    currentExpense: number;
    previousExpense: number;
    deltaExpense: number;
    deltaPctExpense: number | null;
  }[];
  totals: {
    currentExpense: number;
    previousExpense: number;
    currentIncome: number;
    previousIncome: number;
  };
}

interface SankeyResult {
  nodes: { id: string; label: string; kind: 'income' | 'pool' | 'expense' | 'savings' }[];
  links: { source: string; target: string; value: number }[];
  period: { from: string; to: string };
}

const fmt = (n: number) =>
  new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n);

export function AdvancedReports() {
  const [cashflow, setCashflow] = useState<CashflowResult | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [sankey, setSankey] = useState<SankeyResult | null>(null);
  const [mode, setMode] = useState<'mom' | 'yoy'>('mom');
  const [accountIds, setAccountIds] = useState<string[]>([]);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  });
  const accounts = useMemo(
    () => sortByName(accountsQuery.data ?? []),
    [accountsQuery.data],
  );
  // join stabile per evitare di ri-fetch ad ogni reorder dell'array
  const accountKey = accountIds.length > 0 ? [...accountIds].sort().join(',') : '';

  useEffect(() => {
    const filter = accountIds.length > 0 ? accountIds : undefined;
    void api
      .get(`reports/advanced/cashflow${qs({ months: 12, forecastMonths: 6, accountIds: filter })}`)
      .json<CashflowResult>()
      .then(setCashflow);
    void api
      .get(`reports/advanced/sankey${qs({ accountIds: filter })}`)
      .json<SankeyResult>()
      .then(setSankey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);
  useEffect(() => {
    const filter = accountIds.length > 0 ? accountIds : undefined;
    void api
      .get(`reports/advanced/compare${qs({ mode, accountIds: filter })}`)
      .json<CompareResult>()
      .then(setCompare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, accountKey]);

  const exportXlsx = async () => {
    const j = await api
      .get('reports/advanced/export?format=xlsx')
      .json<{ filename: string; base64: string }>();
    const blob = new Blob([Uint8Array.from(atob(j.base64), (c) => c.charCodeAt(0))], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = j.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    window.print();
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Report avanzati</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cashflow, confronti tra periodi, flusso entrate→uscite.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountMultiSelect
            accounts={accounts}
            value={accountIds}
            onChange={setAccountIds}
          />
          <button
            type="button"
            onClick={exportXlsx}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </button>
          <button
            type="button"
            onClick={exportPdf}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            <FileText className="h-4 w-4" /> PDF
          </button>
        </div>
      </header>

      <CashflowSection data={cashflow} />
      <CompareSection data={compare} mode={mode} setMode={setMode} />
      <SankeySection data={sankey} />
    </div>
  );
}

function CashflowSection({ data }: { data: CashflowResult | null }) {
  if (!data) return <Skeleton h={320} />;
  const all = [...data.history, ...data.forecast];
  const lastReal = data.history.length;
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Cashflow 12 mesi + 6 di previsione</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Le barre sono i flussi mensili effettivi (storico) e proiettati (forecast da regole
        ricorrenti). La linea è il saldo cumulato.
      </p>
      <div className="mt-4 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={all.map((p, i) => ({
              ...p,
              balance: data.cumulativeBalance[i]?.balance ?? 0,
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tickLine={false} fontSize={11} />
            <YAxis tickLine={false} fontSize={11} tickFormatter={fmt} />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius)',
                color: 'hsl(var(--popover-foreground))',
              }}
              itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
              labelStyle={{ color: 'hsl(var(--popover-foreground))', fontWeight: 600 }}
              formatter={(v: number) => fmt(v)}
            />
            <ReferenceLine
              x={data.history[lastReal - 1]?.month}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label="oggi"
            />
            <Bar dataKey="income" fill="#10b981" name="Entrate" />
            <Bar dataKey="expense" fill="#ef4444" name="Uscite" />
            <Line
              type="monotone"
              dataKey="balance"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              name="Saldo cumulato"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CompareSection({
  data,
  mode,
  setMode,
}: {
  data: CompareResult | null;
  mode: 'mom' | 'yoy';
  setMode: (m: 'mom' | 'yoy') => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Confronto periodi</h2>
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('mom')}
            className={`rounded px-3 py-1 ${mode === 'mom' ? 'bg-primary text-primary-foreground' : ''}`}
          >
            Mese su mese
          </button>
          <button
            type="button"
            onClick={() => setMode('yoy')}
            className={`rounded px-3 py-1 ${mode === 'yoy' ? 'bg-primary text-primary-foreground' : ''}`}
          >
            Anno su anno
          </button>
        </div>
      </div>
      {!data ? (
        <Skeleton h={250} />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <SummaryCard
              label={data.currentLabel}
              expense={data.totals.currentExpense}
              income={data.totals.currentIncome}
              highlight
            />
            <SummaryCard
              label={data.previousLabel}
              expense={data.totals.previousExpense}
              income={data.totals.previousIncome}
            />
          </div>
          <div className="mt-4 overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Categoria</th>
                  <th className="px-3 py-2 text-right">{data.currentLabel}</th>
                  <th className="px-3 py-2 text-right">{data.previousLabel}</th>
                  <th className="px-3 py-2 text-right">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.slice(0, 12).map((r) => (
                  <tr key={r.categoryId}>
                    <td className="px-3 py-2">{r.categoryName}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.currentExpense)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {fmt(r.previousExpense)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${
                        r.deltaExpense > 0 ? 'text-rose-600' : 'text-emerald-600'
                      }`}
                    >
                      {r.deltaExpense > 0 ? (
                        <TrendingUp className="inline h-3 w-3" />
                      ) : (
                        <TrendingDown className="inline h-3 w-3" />
                      )}{' '}
                      {fmt(Math.abs(r.deltaExpense))}{' '}
                      {r.deltaPctExpense !== null &&
                        `(${r.deltaPctExpense > 0 ? '+' : ''}${r.deltaPctExpense.toFixed(0)}%)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  expense,
  income,
  highlight,
}: {
  label: string;
  expense: number;
  income: number;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg p-4 ${highlight ? 'bg-blue-50 dark:bg-blue-950/30' : 'bg-muted/50'}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <div className="text-xs text-muted-foreground">Entrate</div>
          <div className="font-mono text-emerald-600">{fmt(income)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Uscite</div>
          <div className="font-mono text-rose-600">{fmt(expense)}</div>
        </div>
      </div>
      <div className="mt-2 border-t pt-2">
        <div className="text-xs text-muted-foreground">Netto</div>
        <div
          className={`font-mono ${income - expense >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
        >
          {fmt(income - expense)}
        </div>
      </div>
    </div>
  );
}

function SankeySection({ data }: { data: SankeyResult | null }) {
  if (!data) return <Skeleton h={320} />;
  const incomeNodes = data.nodes.filter((n) => n.kind === 'income');
  const expenseNodes = data.nodes.filter((n) => n.kind === 'expense');
  const total = data.links.filter((l) => l.target === 'pool').reduce((s, l) => s + l.value, 0) || 1;
  const incomeMax = Math.max(
    ...incomeNodes.map((n) => data.links.find((l) => l.source === n.id)?.value ?? 0),
    1,
  );
  // Includiamo il "risparmio" nel max delle uscite così la sua barra resta
  // proporzionale al resto della colonna e non eccede mai il 100% del container.
  const savingsValue = data.links.find((l) => l.target === 'savings')?.value ?? 0;
  const expenseMax = Math.max(
    ...expenseNodes.map((n) => data.links.find((l) => l.target === n.id)?.value ?? 0),
    savingsValue,
    1,
  );
  // Clamp larghezza: la formula `30 + (v/max)*70` può sforare se v > max
  // (es. risparmio più grande della voce di uscita più alta), causando
  // overflow oltre il bordo destro.
  const widthPct = (v: number, max: number) =>
    `${Math.min(100, 30 + (v / max) * 70)}%`;

  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Flusso entrate → uscite</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Da {data.period.from} a {data.period.to}. Le barre sono proporzionali al valore.
      </p>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] gap-6 overflow-hidden">
        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium uppercase text-emerald-600">Entrate</div>
          <ul className="space-y-1.5">
            {incomeNodes.map((n) => {
              const v = data.links.find((l) => l.source === n.id)?.value ?? 0;
              return (
                <li
                  key={n.id}
                  className="max-w-full rounded border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30"
                  style={{ width: widthPct(v, incomeMax) }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{n.label}</span>
                    <span className="font-mono font-medium text-emerald-700">{fmt(v)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-col items-center justify-center border-x border-dashed px-4">
          <div className="text-center">
            <div className="text-xs uppercase text-muted-foreground">Totale</div>
            <div className="mt-1 font-mono text-xl font-semibold">{fmt(total)}</div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium uppercase text-rose-600">Uscite</div>
          <ul className="space-y-1.5">
            {expenseNodes.map((n) => {
              const v = data.links.find((l) => l.target === n.id)?.value ?? 0;
              return (
                <li
                  key={n.id}
                  className="max-w-full rounded border border-rose-200 bg-rose-50 p-2 dark:border-rose-900 dark:bg-rose-950/30"
                  style={{ width: widthPct(v, expenseMax) }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate">{n.label}</span>
                    <span className="font-mono font-medium text-rose-700">{fmt(v)}</span>
                  </div>
                </li>
              );
            })}
            {data.nodes.find((n) => n.kind === 'savings') &&
              (() => {
                const v = savingsValue;
                return (
                  <li
                    className="mt-2 max-w-full rounded border-2 border-dashed border-blue-300 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-950/30"
                    style={{ width: widthPct(v, expenseMax) }}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span>💰 Risparmio</span>
                      <span className="font-mono font-medium text-blue-700">{fmt(v)}</span>
                    </div>
                  </li>
                );
              })()}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Skeleton({ h }: { h: number }) {
  return <div className="animate-pulse rounded-xl bg-muted" style={{ height: h }} />;
}
