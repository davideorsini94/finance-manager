import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { shortDate } from '@/lib/utils/date';
import type { DailyPoint } from '../dashboardApi';
import { AXIS_PROPS, ChartTooltip, compactEuro } from './ChartTooltip';

interface Props {
  data: DailyPoint[];
}

/**
 * Saldo cumulativo: niente assi né tacche, date brevi in italiano, linea dello
 * zero tratteggiata e punto sull'ultimo valore. Toccando compare il cursore.
 */
export function BalanceArea({ data }: Props) {
  const chartData = data.map((d) => ({
    label: shortDate(d.date),
    Saldo: Number(d.balanceCents) / 100,
  }));
  const values = chartData.map((d) => d.Saldo);
  const crossesZero = values.some((v) => v < 0) && values.some((v) => v > 0);
  const last = chartData.length - 1;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.32} />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
        <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={40} tickMargin={8} />
        <YAxis {...AXIS_PROPS} width={40} tickFormatter={compactEuro} />
        {crossesZero && (
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.6} strokeDasharray="3 4" />
        )}
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: 'hsl(var(--foreground))', strokeOpacity: 0.25, strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="Saldo"
          stroke="hsl(var(--chart-1))"
          fill="url(#balanceGrad)"
          strokeWidth={2.2}
          activeDot={{ r: 5, strokeWidth: 2.2, stroke: 'hsl(var(--chart-1))', fill: 'hsl(var(--card))' }}
          dot={(props: { cx?: number; cy?: number; index?: number }) =>
            props.index === last && props.cx != null && props.cy != null ? (
              <circle key="last" cx={props.cx} cy={props.cy} r={4} fill="hsl(var(--chart-1))" />
            ) : (
              <g key={props.index} />
            )
          }
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
