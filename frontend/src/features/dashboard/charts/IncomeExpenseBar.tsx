import {
  Bar,
  BarChart,
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

export function IncomeExpenseBar({ data }: Props) {
  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    Entrate: Number(d.incomeCents) / 100,
    Uscite: Number(d.expenseCents) / 100,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData}>
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
        <Bar dataKey="Entrate" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Uscite" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
