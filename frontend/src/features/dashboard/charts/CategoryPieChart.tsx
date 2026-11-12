import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CategoryBreakdownItem } from '../dashboardApi';
import { ChartTooltip } from './ChartTooltip';

export const FALLBACK_PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  '#94a3b8',
  '#f43f5e',
  '#22c55e',
];

const WHOLE_EURO = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/**
 * Fette della ciambella: le prime `max` categorie per importo più "Altro".
 * La usa anche la legenda, così voci e colori coincidono con le fette.
 */
export function pieSlices(
  data: CategoryBreakdownItem[],
  max = 8,
): { name: string; cents: number; color: string | null }[] {
  const sorted = [...data].sort((a, b) => Number(BigInt(b.amountCents) - BigInt(a.amountCents)));
  const top = sorted.slice(0, max).map((c) => ({
    name: c.categoryName,
    cents: Number(c.amountCents),
    color: c.color,
  }));
  const others = sorted.slice(max).reduce((acc, c) => acc + Number(c.amountCents), 0);
  return others > 0 ? [...top, { name: 'Altro', cents: others, color: null }] : top;
}

interface Props {
  data: CategoryBreakdownItem[];
  maxSlices?: number;
  /** Messaggio a dati vuoti: la ciambella serve sia alle uscite sia alle entrate. */
  emptyLabel?: string;
  /** Etichetta sopra il totale al centro ("Uscite", "Entrate"). */
  centerLabel?: string;
  size?: number;
}

/**
 * Ciambella con il **totale al centro**: la torta di prima non diceva quanto
 * si era speso. La legenda con importi e percentuali sta accanto (lista della
 * pagina), non sotto il grafico.
 */
export function CategoryPieChart({
  data,
  maxSlices = 8,
  emptyLabel = 'Nessuna spesa nel periodo',
  centerLabel = 'Totale',
  size = 180,
}: Props) {
  const slices = pieSlices(data, maxSlices).map((c) => ({
    name: c.name,
    value: c.cents / 100,
    color: c.color,
  }));
  const total = slices.reduce((acc, c) => acc + c.value * 100, 0);

  if (slices.length === 0) {
    return (
      <p className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="68%"
            outerRadius="100%"
            paddingAngle={1.5}
            stroke="none"
            startAngle={90}
            endAngle={-270}
          >
            {slices.map((s, i) => (
              <Cell key={i} fill={s.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
        <span className="text-base font-bold tabular-nums tracking-tight">
          {WHOLE_EURO.format(total / 100)}
        </span>
      </div>
    </div>
  );
}
