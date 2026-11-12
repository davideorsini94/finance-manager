import type { TooltipProps } from 'recharts';
import { formatCents } from '@/lib/utils/currency';

/**
 * Etichetta del cursore dei grafici: pillola scura con data e valori, come
 * lo scrub di Borsa/Salute su iPhone. Recharts la segue col dito (tocco e
 * trascinamento) e col mouse.
 */
export function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-foreground px-3 py-2 text-background shadow-lg">
      <div className="text-[11px] opacity-70">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-sm font-semibold tabular-nums">
          {payload.length > 1 && (
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          )}
          {payload.length > 1 && <span className="font-medium opacity-80">{p.name}</span>}
          {formatCents(Math.round(Number(p.value) * 100))}
        </div>
      ))}
    </div>
  );
}

/** Assi senza linee né tacche: solo etichette tenui. */
export const AXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  fontSize: 11,
  stroke: 'hsl(var(--muted-foreground))',
} as const;

/** Importo compatto per l'asse Y ("1,2k"). */
export function compactEuro(v: number): string {
  return new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}
