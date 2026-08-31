import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AccountMultiSelect } from '@/components/shared/AccountMultiSelect';
import { accountsApi } from '@/features/accounts/accountsApi';
import { sortByName } from '@/lib/utils/sort';
import { projectionsApi, type ProjectionResult } from '@/features/projections/projectionsApi';
import { formatCents } from '@/lib/utils/currency';

const PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

const eur = (cents: string | number) => formatCents(cents);

export function ProjectionsPage() {
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [years, setYears] = useState(3);

  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() });
  const accounts = useMemo(() => sortByName(accountsQuery.data ?? []), [accountsQuery.data]);
  const accountIdsKey = useMemo(() => [...accountIds].sort(), [accountIds]);

  const projQuery = useQuery({
    queryKey: ['projections', years, accountIdsKey],
    queryFn: () => projectionsApi.get(years, accountIds.length > 0 ? accountIds : undefined),
  });

  const data = projQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proiezioni</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stima dei saldi dei conti a fine anno e per gli anni successivi, in base alle spese
            ricorrenti e ai movimenti futuri già registrati.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountMultiSelect accounts={accounts} value={accountIds} onChange={setAccountIds} />
          <Label htmlFor="years" className="text-sm">
            Orizzonte
          </Label>
          <Select value={String(years)} onValueChange={(v) => setYears(Number(v))}>
            <SelectTrigger id="years" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Solo anno corrente</SelectItem>
              {[1, 2, 3, 5, 10].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  +{y} {y === 1 ? 'anno' : 'anni'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {projQuery.isError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Errore nel caricamento delle proiezioni.
        </p>
      )}

      {data && data.accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">Nessun conto da proiettare.</p>
      )}

      {data && data.accounts.length > 0 && (
        <>
          <KpiRow data={data} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Andamento saldo proiettato</CardTitle>
              <CardDescription>
                Saldo a fine mese. Le linee tratteggiate verticali segnano la fine di ogni anno.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectionChart data={data} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saldi stimati a fine anno</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <YearEndTable data={data} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiRow({ data }: { data: ProjectionResult }) {
  const lastTotal = data.total.points.at(-1);
  const startN = Number(data.total.currentBalanceCents);
  const endN = lastTotal ? Number(lastTotal.balanceCents) : startN;
  const diff = endN - startN;
  const horizonLabel = lastTotal ? formatMonth(data.months.at(-1)!) : '—';
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Saldo totale oggi</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{eur(data.total.currentBalanceCents)}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Saldo totale stimato ({horizonLabel})</CardDescription>
          <CardTitle className="text-2xl tabular-nums">
            {lastTotal ? eur(lastTotal.balanceCents) : '—'}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Variazione attesa</CardDescription>
          <CardTitle
            className={`text-2xl tabular-nums ${
              diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {diff >= 0 ? '+' : ''}
            {eur(diff)}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}

function ProjectionChart({ data }: { data: ProjectionResult }) {
  const rows = data.months.map((ym, i) => {
    const row: Record<string, number | string> = {
      label: formatMonth(ym),
      Totale: Number(data.total.points[i].balanceCents) / 100,
    };
    for (const a of data.accounts) {
      row[`a_${a.accountId}`] = Number(a.points[i].balanceCents) / 100;
    }
    return row;
  });
  // Etichette di fine anno per le linee di riferimento verticali
  const yearEndLabels = data.months
    .map((ym, i) => (data.total.points[i].isYearEnd ? formatMonth(ym) : null))
    .filter((x): x is string => x !== null);

  return (
    <ResponsiveContainer width="100%" height={380}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
        <XAxis dataKey="label" fontSize={11} stroke="hsl(var(--muted-foreground))" minTickGap={24} />
        <YAxis
          fontSize={11}
          stroke="hsl(var(--muted-foreground))"
          width={70}
          tickFormatter={(v: number) => eur(v * 100)}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 'var(--radius)',
            color: 'hsl(var(--popover-foreground))',
          }}
          itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
          labelStyle={{ color: 'hsl(var(--popover-foreground))', fontWeight: 600 }}
          formatter={(value: number) => eur(value * 100)}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {yearEndLabels.map((lbl) => (
          <ReferenceLine key={lbl} x={lbl} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
        ))}
        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
        {data.accounts.map((a, i) => (
          <Line
            key={a.accountId}
            type="monotone"
            dataKey={`a_${a.accountId}`}
            name={a.name}
            stroke={a.color ?? PALETTE[i % PALETTE.length]}
            strokeWidth={1.5}
            dot={false}
          />
        ))}
        <Line
          type="monotone"
          dataKey="Totale"
          name="Totale"
          stroke="hsl(var(--primary))"
          strokeWidth={3}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function YearEndTable({ data }: { data: ProjectionResult }) {
  // Indici dei punti di fine anno
  const yearCols = data.months
    .map((ym, i) => ({ year: ym.slice(0, 4), i, isYearEnd: data.total.points[i].isYearEnd }))
    .filter((c) => c.isYearEnd);

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr className="border-b">
          <th className="px-3 py-2 text-left">Conto</th>
          <th className="px-3 py-2 text-right">Oggi</th>
          {yearCols.map((c) => (
            <th key={c.year} className="px-3 py-2 text-right">
              Dic {c.year}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {data.accounts.map((a) => (
          <tr key={a.accountId}>
            <td className="px-3 py-2">
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: a.color ?? 'hsl(var(--muted-foreground))' }}
                />
                <span className="truncate">{a.name}</span>
              </span>
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              {eur(a.currentBalanceCents)}
            </td>
            {yearCols.map((c) => (
              <td key={c.year} className={`px-3 py-2 text-right tabular-nums ${signClass(a.points[c.i].balanceCents)}`}>
                {eur(a.points[c.i].balanceCents)}
              </td>
            ))}
          </tr>
        ))}
        <tr className="border-t-2 font-semibold">
          <td className="px-3 py-2">Totale</td>
          <td className="px-3 py-2 text-right tabular-nums">{eur(data.total.currentBalanceCents)}</td>
          {yearCols.map((c) => (
            <td key={c.year} className={`px-3 py-2 text-right tabular-nums ${signClass(data.total.points[c.i].balanceCents)}`}>
              {eur(data.total.points[c.i].balanceCents)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function signClass(cents: string): string {
  return Number(cents) < 0 ? 'text-red-600 dark:text-red-400' : '';
}

function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const label = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][
    m - 1
  ];
  return `${label} ${String(y).slice(2)}`;
}
