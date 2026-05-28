import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import { AccountMultiSelect } from '@/components/shared/AccountMultiSelect';
import { accountsApi } from '@/features/accounts/accountsApi';
import { sortByName } from '@/lib/utils/sort';
import { reportsApi } from './dashboardApi';
import { IncomeExpenseBar } from './charts/IncomeExpenseBar';
import { CategoryPieChart } from './charts/CategoryPieChart';
import { BalanceArea } from './charts/BalanceArea';
import { AnimatedNumber } from '@/components/shared/animated/AnimatedNumber';
import { SparkLine } from '@/components/shared/animated/SparkLine';
import { StaggerList } from '@/components/shared/animated/StaggerList';
import { Skeleton } from '@/components/shared/animated/Skeleton';
import { cn } from '@/lib/utils/cn';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

const PRESETS = [
  { label: '7g', days: 7 },
  { label: '30g', days: 30 },
  { label: '90g', days: 90 },
  { label: 'YTD', days: -1 },
];

export function DashboardPage() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [accountIds, setAccountIds] = useState<string[]>([]);

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  });
  const accounts = useMemo(
    () => sortByName(accountsQuery.data ?? []),
    [accountsQuery.data],
  );

  const dashboardQuery = useQuery({
    // ordino gli accountIds per avere una cache key stabile a prescindere
    // dall'ordine in cui l'utente ha selezionato i conti
    queryKey: ['dashboard', from, to, [...accountIds].sort()],
    queryFn: () =>
      reportsApi.dashboard(from, to, accountIds.length > 0 ? accountIds : undefined),
    // I totali e il saldo dipendono dalle transazioni: refetch fresh ad
    // ogni mount per non mostrare valori obsoleti dopo un giroconto/movimento.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const data = dashboardQuery.data;

  const setPreset = (days: number) => {
    if (days < 0) {
      setFrom(`${new Date().getFullYear()}-01-01`);
      setTo(new Date().toISOString().slice(0, 10));
    } else {
      setFrom(isoDaysAgo(days));
      setTo(new Date().toISOString().slice(0, 10));
    }
  };

  return (
    <div className="space-y-6 relative">
      {/* Hero glow decorativo dietro l'header */}
      <div className="fm-hero-glow" aria-hidden />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 relative">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Panoramica finanziaria del periodo selezionato
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountMultiSelect
            accounts={accounts}
            value={accountIds}
            onChange={setAccountIds}
          />
          {PRESETS.map((p) => (
            <Button key={p.label} variant="outline" size="sm" onClick={() => setPreset(p.days)}>
              {p.label}
            </Button>
          ))}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
        </div>
      </div>

      {/* KPI cards */}
      <StaggerList className="grid gap-4 md:grid-cols-3">
        <Card className="fm-glass fm-card-in relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardDescription className="uppercase tracking-wider text-[11px] font-semibold">
              Entrate
            </CardDescription>
            <CardTitle className="text-3xl font-num text-emerald-600 dark:text-emerald-400">
              {data ? (
                <AnimatedNumber
                  value={Number(data.totals.incomeCents) / 100}
                  prefix="€ "
                  decimals={2}
                />
              ) : (
                '—'
              )}
            </CardTitle>
          </CardHeader>
          {data?.daily && data.daily.length > 1 && (
            <div className="absolute bottom-3 right-3 opacity-60">
              <SparkLine
                data={data.daily.map((d) => Number(d.incomeCents) / 100)}
                color="hsl(var(--pos))"
                width={110}
                height={32}
              />
            </div>
          )}
        </Card>
        <Card className="fm-glass fm-card-in relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardDescription className="uppercase tracking-wider text-[11px] font-semibold">
              Uscite
            </CardDescription>
            <CardTitle className="text-3xl font-num text-red-600 dark:text-red-400">
              {data ? (
                <AnimatedNumber
                  value={Number(data.totals.expenseCents) / 100}
                  prefix="€ "
                  decimals={2}
                />
              ) : (
                '—'
              )}
            </CardTitle>
          </CardHeader>
          {data?.daily && data.daily.length > 1 && (
            <div className="absolute bottom-3 right-3 opacity-60">
              <SparkLine
                data={data.daily.map((d) => Math.abs(Number(d.expenseCents)) / 100)}
                color="hsl(var(--neg))"
                width={110}
                height={32}
              />
            </div>
          )}
        </Card>
        <Card className="fm-glass fm-card-in relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardDescription className="uppercase tracking-wider text-[11px] font-semibold">
              Netto
            </CardDescription>
            <CardTitle
              className={cn(
                'text-3xl font-num',
                data && Number(data.totals.netCents) >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400',
              )}
            >
              {data ? (
                <AnimatedNumber
                  value={Number(data.totals.netCents) / 100}
                  prefix="€ "
                  decimals={2}
                />
              ) : (
                '—'
              )}
            </CardTitle>
          </CardHeader>
          {data?.daily && data.daily.length > 1 && (
            <div className="absolute bottom-3 right-3 opacity-60">
              <SparkLine
                data={data.daily.map(
                  (d) => (Number(d.incomeCents) + Number(d.expenseCents)) / 100,
                )}
                color="hsl(var(--primary))"
                width={110}
                height={32}
              />
            </div>
          )}
        </Card>
      </StaggerList>

      <StaggerList className="grid gap-4 lg:grid-cols-2">
        <Card className="fm-glass fm-card-in">
          <CardHeader>
            <CardTitle className="text-base">Andamento patrimonio</CardTitle>
            <CardDescription>Saldo cumulativo nel periodo</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? <BalanceArea data={data.daily} /> : <Skel />}
          </CardContent>
        </Card>

        <Card className="fm-glass fm-card-in">
          <CardHeader>
            <CardTitle className="text-base">Spese per categoria</CardTitle>
            <CardDescription>Distribuzione nel periodo</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? <CategoryPieChart data={data.byCategory} /> : <Skel />}
          </CardContent>
        </Card>

        <Card className="fm-glass fm-card-in lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Entrate vs uscite</CardTitle>
            <CardDescription>Per giornata</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? <IncomeExpenseBar data={data.daily} /> : <Skel />}
          </CardContent>
        </Card>
      </StaggerList>

      <Card className="fm-glass fm-card-in">
        <CardHeader>
          <CardTitle className="text-base">Ultime operazioni</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!data || data.recent.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">Nessun movimento.</p>
          ) : (
            <ul className="divide-y fm-stagger">
              {data.recent.map((tx) => {
                const cents = Number(tx.amountCents);
                const tone =
                  cents >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400';
                return (
                  <li
                    key={tx.id}
                    className="fm-card-in flex items-center gap-3 p-3 sm:px-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {tx.description || (tx.category?.name ?? 'Movimento')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(tx.transactionDate)} · {tx.account.name}
                        {tx.category && ` · ${tx.category.name}`}
                      </p>
                    </div>
                    <p className={`font-semibold tabular-nums ${tone}`}>{formatCents(cents)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Skel() {
  return <Skeleton height={260} rounded="md" />;
}
