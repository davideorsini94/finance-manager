import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCents } from '@/lib/utils/currency';
import type { DailyPoint } from '../dashboardApi';

interface Props {
  data: DailyPoint[];
}

export function BalanceArea({ data }: Props) {
  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    Saldo: Number(d.balanceCents) / 100,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.6} />
            <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" fontSize={12} stroke="hsl(var(--muted-foreground))" />
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
        <Area
          type="monotone"
          dataKey="Saldo"
          stroke="hsl(var(--chart-1))"
          fill="url(#balanceGrad)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
