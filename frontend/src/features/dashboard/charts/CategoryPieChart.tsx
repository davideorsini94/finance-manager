import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { formatCents } from '@/lib/utils/currency';
import type { CategoryBreakdownItem } from '../dashboardApi';

const FALLBACK_PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  '#94a3b8',
  '#f43f5e',
  '#22c55e',
];

interface Props {
  data: CategoryBreakdownItem[];
  maxSlices?: number;
  /** Messaggio a dati vuoti: la torta serve sia alle uscite sia alle entrate. */
  emptyLabel?: string;
}

export function CategoryPieChart({
  data,
  maxSlices = 8,
  emptyLabel = 'Nessuna spesa nel periodo',
}: Props) {
  const sorted = [...data].sort((a, b) => Number(BigInt(b.amountCents) - BigInt(a.amountCents)));
  const top = sorted.slice(0, maxSlices);
  const others = sorted.slice(maxSlices);
  const othersTotal = others.reduce((acc, c) => acc + Number(c.amountCents), 0);
  const slices = [
    ...top.map((c) => ({
      name: c.categoryName,
      value: Number(c.amountCents) / 100,
      color: c.color,
    })),
    ...(othersTotal > 0
      ? [{ name: 'Altro', value: othersTotal / 100, color: null as string | null }]
      : []),
  ];

  if (slices.length === 0) {
    return (
      <p className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius={50}
          outerRadius={90}
          paddingAngle={2}
        >
          {slices.map((s, i) => (
            <Cell key={i} fill={s.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]} />
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
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
