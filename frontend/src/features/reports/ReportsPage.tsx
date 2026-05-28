import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { reportsApi, type CategoryBreakdownItem } from '@/features/dashboard/dashboardApi';
import { formatCents } from '@/lib/utils/currency';

type Mode = 'annual' | 'compare';

const PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export function ReportsPage() {
  const [mode, setMode] = useState<Mode>('annual');
  const [year, setYear] = useState(new Date().getFullYear());
  const [accountIds, setAccountIds] = useState<string[]>([]);

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const twoMonthsAgo = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);

  const [p1From, setP1From] = useState(twoMonthsAgo);
  const [p1To, setP1To] = useState(monthAgo);
  const [p2From, setP2From] = useState(monthAgo);
  const [p2To, setP2To] = useState(today);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  });
  const accounts = useMemo(
    () => sortByName(accountsQuery.data ?? []),
    [accountsQuery.data],
  );
  // Cache key stabile a prescindere dall'ordine di selezione
  const accountIdsKey = useMemo(() => [...accountIds].sort(), [accountIds]);

  const annualQuery = useQuery({
    queryKey: ['report', 'annual', year, accountIdsKey],
    queryFn: () =>
      reportsApi.annual(year, accountIds.length > 0 ? accountIds : undefined),
    enabled: mode === 'annual',
  });

  const compareQuery = useQuery({
    queryKey: ['report', 'compare', p1From, p1To, p2From, p2To, accountIdsKey],
    queryFn: () =>
      reportsApi.compare(
        p1From,
        p1To,
        p2From,
        p2To,
        accountIds.length > 0 ? accountIds : undefined,
      ),
    enabled: mode === 'compare',
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Report</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AccountMultiSelect
            accounts={accounts}
            value={accountIds}
            onChange={setAccountIds}
          />
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="annual">Riepilogo annuale</SelectItem>
              <SelectItem value="compare">Confronto periodi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {mode === 'annual' ? (
        <>
          <div className="flex items-center gap-2">
            <Label htmlFor="year">Anno</Label>
            <Input
              id="year"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || year)}
              className="w-32"
            />
          </div>

          {annualQuery.data && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <KpiCard label="Entrate" value={annualQuery.data.totals.incomeCents} tone="emerald" />
                <KpiCard label="Uscite" value={annualQuery.data.totals.expenseCents} tone="red" />
                <KpiCard label="Netto" value={annualQuery.data.totals.netCents} tone="primary" />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Mensile</CardTitle>
                  <CardDescription>Entrate e uscite per ogni mese</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={annualQuery.data.byMonth.map((m) => ({
                        month: monthLabel(m.month),
                        Entrate: Number(m.incomeCents) / 100,
                        Uscite: Number(m.expenseCents) / 100,
                        Netto: Number(m.netCents) / 100,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" fontSize={12} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={12} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 'var(--radius)',
                          color: 'hsl(var(--popover-foreground))',
                        }}
                        itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                        labelStyle={{ color: 'hsl(var(--popover-foreground))', fontWeight: 600 }}
                        formatter={(value: number) => formatCents(value * 100)}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Entrate" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Uscite" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top categorie</CardTitle>
                </CardHeader>
                <CardContent>
                  <CategoryList data={annualQuery.data.byCategory} />
                </CardContent>
              </Card>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Periodo 1</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Input type="date" value={p1From} onChange={(e) => setP1From(e.target.value)} />
                <Input type="date" value={p1To} onChange={(e) => setP1To(e.target.value)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Periodo 2</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Input type="date" value={p2From} onChange={(e) => setP2From(e.target.value)} />
                <Input type="date" value={p2To} onChange={(e) => setP2To(e.target.value)} />
              </CardContent>
            </Card>
          </div>

          {compareQuery.data && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <ComparisonColumn
                  title="Periodo 1"
                  totals={compareQuery.data.period1.totals}
                  categories={compareQuery.data.period1.categories}
                />
                <ComparisonColumn
                  title="Periodo 2"
                  totals={compareQuery.data.period2.totals}
                  categories={compareQuery.data.period2.categories}
                />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Delta totali</CardTitle>
                </CardHeader>
                <CardContent>
                  <DeltaRow
                    label="Entrate"
                    a={compareQuery.data.period1.totals.incomeCents}
                    b={compareQuery.data.period2.totals.incomeCents}
                  />
                  <DeltaRow
                    label="Uscite"
                    a={compareQuery.data.period1.totals.expenseCents}
                    b={compareQuery.data.period2.totals.expenseCents}
                  />
                  <DeltaRow
                    label="Netto"
                    a={compareQuery.data.period1.totals.netCents}
                    b={compareQuery.data.period2.totals.netCents}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'red' | 'primary' }) {
  const cls =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'red'
        ? 'text-red-600 dark:text-red-400'
        : '';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-2xl tabular-nums ${cls}`}>{formatCents(value)}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function ComparisonColumn({
  title,
  totals,
  categories,
}: {
  title: string;
  totals: { incomeCents: string; expenseCents: string; netCents: string };
  categories: CategoryBreakdownItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <p className="text-muted-foreground">Entrate</p>
            <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCents(totals.incomeCents)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Uscite</p>
            <p className="font-semibold tabular-nums text-red-600 dark:text-red-400">
              {formatCents(totals.expenseCents)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Netto</p>
            <p className="font-semibold tabular-nums">{formatCents(totals.netCents)}</p>
          </div>
        </div>
        <div className="h-[200px]">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center pt-12">
              Nessuna spesa nel periodo
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories.slice(0, 6).map((c) => ({
                    name: c.categoryName,
                    value: Number(c.amountCents) / 100,
                    color: c.color,
                  }))}
                  dataKey="value"
                  innerRadius={40}
                  outerRadius={75}
                >
                  {categories.slice(0, 6).map((c, i) => (
                    <Cell key={i} fill={c.color ?? PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 'var(--radius)',
                    color: 'hsl(var(--popover-foreground))',
                  }}
                  itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
                  labelStyle={{ color: 'hsl(var(--popover-foreground))', fontWeight: 600 }}
                  formatter={(value: number) => formatCents(value * 100)}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryList({ data }: { data: CategoryBreakdownItem[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Nessun dato.</p>;
  const total = data.reduce((acc, c) => acc + Number(c.amountCents), 0);
  return (
    <ul className="space-y-2">
      {data.slice(0, 10).map((c) => {
        const pct = total > 0 ? (Number(c.amountCents) / total) * 100 : 0;
        return (
          <li key={c.categoryId ?? 'none'} className="flex items-center gap-3">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: c.color ?? 'hsl(var(--muted-foreground))' }}
            />
            <span className="flex-1 truncate text-sm">{c.categoryName}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{pct.toFixed(0)}%</span>
            <span className="font-medium tabular-nums w-24 text-right">
              {formatCents(c.amountCents)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DeltaRow({ label, a, b }: { label: string; a: string; b: string }) {
  const aN = Number(a);
  const bN = Number(b);
  const diff = bN - aN;
  const pct = aN !== 0 ? (diff / Math.abs(aN)) * 100 : 0;
  const tone = diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${tone}`}>
        {diff >= 0 ? '+' : ''}
        {formatCents(diff)} ({pct.toFixed(1)}%)
      </span>
    </div>
  );
}

function monthLabel(m: number): string {
  return ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][m - 1];
}
