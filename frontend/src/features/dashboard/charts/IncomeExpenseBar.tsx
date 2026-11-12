import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { shortDate } from '@/lib/utils/date';
import type { DailyPoint } from '../dashboardApi';
import { AXIS_PROPS, ChartTooltip, compactEuro } from './ChartTooltip';

interface Props {
  data: DailyPoint[];
}

export function IncomeExpenseBar({ data }: Props) {
  const chartData = data.map((d) => ({
    label: shortDate(d.date),
    Entrate: Number(d.incomeCents) / 100,
    Uscite: Number(d.expenseCents) / 100,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
        <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={40} tickMargin={8} />
        <YAxis {...AXIS_PROPS} width={40} tickFormatter={compactEuro} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--foreground))', fillOpacity: 0.05 }} />
        <Bar dataKey="Entrate" fill="hsl(var(--pos))" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
        <Bar dataKey="Uscite" fill="hsl(var(--neg))" fillOpacity={0.75} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
