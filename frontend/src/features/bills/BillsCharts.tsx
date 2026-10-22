import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCents } from '@/lib/utils/currency';
import type { MonthPoint, UnitPricePoint, UtilityKind, YearSummary, YoYPoint } from './analytics';
import { UTILITIES } from './analytics';
import {
  UTILITY_META,
  formatConsumption,
  formatUnitPrice,
  monthLabel,
  monthTick,
  utilColor,
} from './utilities';

const AXIS = { fontSize: 11, stroke: 'hsl(var(--muted-foreground))', tickLine: false, axisLine: false } as const;
const GRID = <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />;
const TOOLTIP = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.875rem',
    color: 'hsl(var(--popover-foreground))',
    boxShadow: '0 10px 30px -12px hsl(var(--foreground) / 0.25)',
    fontSize: 13,
  },
  itemStyle: { color: 'hsl(var(--popover-foreground))' },
  labelStyle: { color: 'hsl(var(--popover-foreground))', fontWeight: 600, marginBottom: 2 },
  cursor: { fill: 'hsl(var(--foreground) / 0.05)' },
} as const;

const euro = (v: number) => formatCents(Math.round(v * 100));
const compactEuro = (v: number) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(v)} €`;
const compact = (v: number) => new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

/** Consumo o costo mese per mese di un servizio. */
export function MonthlyChart({
  points,
  utility,
  metric,
}: {
  points: MonthPoint[];
  utility: UtilityKind;
  metric: 'consumption' | 'cost';
}) {
  const data = points.map((p) => ({
    month: p.month,
    value: metric === 'consumption' ? p.consumption : p.costCents === null ? null : p.costCents / 100,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="month" tickFormatter={monthTick} {...AXIS} minTickGap={12} />
        <YAxis {...AXIS} width={48} tickFormatter={metric === 'cost' ? compactEuro : compact} />
        <Tooltip
          {...TOOLTIP}
          labelFormatter={(m: string) => monthLabel(m)}
          formatter={(v: number) => [
            metric === 'cost' ? euro(v) : formatConsumption(utility, v),
            metric === 'cost' ? 'Spesa' : 'Consumo',
          ]}
        />
        <Bar dataKey="value" fill={utilColor(utility)} radius={[6, 6, 2, 2]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** Anno su anno: barre piene per l'anno corrente, velate per il precedente. */
export function YearOverYearChart({
  points,
  year,
  utility,
  metric,
}: {
  points: YoYPoint[];
  year: number;
  utility: UtilityKind;
  metric: 'consumption' | 'cost';
}) {
  const data = points.map((p) => ({ month: MONTHS[p.month - 1], current: p.current, previous: p.previous }));
  const fmt = (v: number) => (metric === 'cost' ? euro(v) : formatConsumption(utility, v));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={2}>
        {GRID}
        <XAxis dataKey="month" {...AXIS} interval={0} fontSize={10} />
        <YAxis {...AXIS} width={48} tickFormatter={metric === 'cost' ? compactEuro : compact} />
        <Tooltip {...TOOLTIP} formatter={(v: number, name: string) => [fmt(v), name]} />
        <Bar dataKey="previous" name={String(year - 1)} fill={utilColor(utility, 0.3)} radius={[5, 5, 2, 2]} maxBarSize={14} />
        <Bar dataKey="current" name={String(year)} fill={utilColor(utility)} radius={[5, 5, 2, 2]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Spesa mensile di tutti i servizi impilata (panoramica).
 * - senza `year`: gli ultimi 24 mesi;
 * - con `year`: i 12 mesi di quell'anno, più (`previous`) la spesa totale
 *   dell'anno prima mese per mese come linea tratteggiata, per confronto.
 */
export function CostStackChart({
  series,
  year,
  previous,
}: {
  series: Record<UtilityKind, MonthPoint[]>;
  year?: number;
  /** Spesa dell'anno precedente per mese (centesimi), 12 valori. */
  previous?: Array<number | null>;
}) {
  const months = new Map<string, Record<string, number | string | null>>();
  if (year) {
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      months.set(key, { month: key, previous: previous?.[m - 1] == null ? null : previous[m - 1]! / 100 });
    }
  }
  for (const u of UTILITIES) {
    for (const p of series[u]) {
      if (year && Number(p.month.slice(0, 4)) !== year) continue;
      const row = months.get(p.month) ?? { month: p.month };
      row[u] = p.costCents === null ? null : p.costCents / 100;
      months.set(p.month, row);
    }
  }
  const sorted = [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const data = year ? sorted : sorted.slice(-24);
  const present = UTILITIES.filter((u) => series[u].length > 0);
  const showPrevious = !!year && !!previous?.some((v) => v !== null);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="month" tickFormatter={monthTick} {...AXIS} minTickGap={year ? 4 : 12} />
        <YAxis {...AXIS} width={48} tickFormatter={compactEuro} />
        <Tooltip
          {...TOOLTIP}
          labelFormatter={(m: string) => monthLabel(m)}
          formatter={(v: number, key: string) => [
            euro(v),
            key === 'previous' ? `Totale ${year ? year - 1 : ''}` : (UTILITY_META[key as UtilityKind]?.label ?? key),
          ]}
        />
        {present.map((u, i) => (
          <Bar
            key={u}
            dataKey={u}
            stackId="cost"
            fill={utilColor(u)}
            maxBarSize={28}
            // Solo la barra in cima alla pila ha gli angoli arrotondati.
            radius={i === present.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
        {showPrevious && (
          <Line
            type="monotone"
            dataKey="previous"
            stroke="hsl(var(--foreground) / 0.55)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 2.5, fill: 'hsl(var(--foreground) / 0.55)', strokeWidth: 0 }}
            connectNulls={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Spesa anno per anno, impilata per servizio. */
export function YearCompareChart({ years }: { years: YearSummary[] }) {
  const present = UTILITIES.filter((u) => years.some((y) => y.costCents[u] !== null));
  const data = years.map((y) => ({
    year: String(y.year),
    ...Object.fromEntries(present.map((u) => [u, y.costCents[u] === null ? null : y.costCents[u]! / 100])),
  }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="year" {...AXIS} />
        <YAxis {...AXIS} width={60} tickFormatter={compactEuro} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v: number, key: string) => [euro(v), UTILITY_META[key as UtilityKind]?.label ?? key]}
        />
        {present.map((u, i) => (
          <Bar
            key={u}
            dataKey={u}
            stackId="year"
            fill={utilColor(u)}
            maxBarSize={56}
            radius={i === present.length - 1 ? [8, 8, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Prezzo per unità bolletta per bolletta, con una linea verticale dove cambia
 * il fornitore: è lì che di solito il prezzo salta.
 */
export function UnitPriceChart({ points, utility }: { points: UnitPricePoint[]; utility: UtilityKind }) {
  const data = points.map((p) => ({ ...p, value: p.unitPriceCents / 100 }));
  const changes = data.filter((p, i) => i > 0 && (p.provider ?? '') !== (data[i - 1].provider ?? ''));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 18, right: 8, left: -8, bottom: 0 }}>
        {GRID}
        <XAxis dataKey="date" tickFormatter={(d: string) => monthTick(d.slice(0, 7))} {...AXIS} minTickGap={16} />
        <YAxis
          {...AXIS}
          width={48}
          domain={['auto', 'auto']}
          tickFormatter={(v: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(v)}
        />
        <Tooltip
          {...TOOLTIP}
          labelFormatter={(d: string) => monthLabel(d.slice(0, 7))}
          formatter={(v: number, _n: string, item: { payload?: UnitPricePoint }) => [
            formatUnitPrice(utility, v * 100),
            item.payload?.provider ?? 'Prezzo',
          ]}
        />
        {changes.map((c) => (
          <ReferenceLine
            key={c.billId}
            x={c.date}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="3 3"
            label={{ value: c.provider ?? '', position: 'top', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          />
        ))}
        <Line
          type="monotone"
          dataKey="value"
          stroke={utilColor(utility)}
          strokeWidth={2.5}
          dot={{ r: 3.5, fill: utilColor(utility), strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
