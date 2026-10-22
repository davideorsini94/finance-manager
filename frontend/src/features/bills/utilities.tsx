import { Droplet, Flame, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { UtilityKind } from './analytics';

/**
 * Identità di luce, gas e acqua. Il colore di ciascun servizio è un **dato**
 * (come i colori delle categorie), non un accento dell'interfaccia: token
 * `--util-*` in `index.css`, con variante per il tema scuro.
 */
export interface UtilityMeta {
  label: string;
  unit: string;
  /** Unità del prezzo, per le etichette "€/kWh". */
  priceUnit: string;
  /** Decimali con cui si mostra il consumo. */
  decimals: number;
  icon: LucideIcon;
  /** Nome del token CSS: `hsl(var(--util-electricity))`. */
  token: string;
  codeLabel: string;
}

export const UTILITY_META: Record<UtilityKind, UtilityMeta> = {
  electricity: {
    label: 'Luce',
    unit: 'kWh',
    priceUnit: '€/kWh',
    decimals: 0,
    icon: Zap,
    token: '--util-electricity',
    codeLabel: 'POD',
  },
  gas: {
    label: 'Gas',
    unit: 'Smc',
    priceUnit: '€/Smc',
    decimals: 0,
    icon: Flame,
    token: '--util-gas',
    codeLabel: 'PDR',
  },
  water: {
    label: 'Acqua',
    unit: 'm³',
    priceUnit: '€/m³',
    decimals: 1,
    icon: Droplet,
    token: '--util-water',
    codeLabel: 'Codice utenza',
  },
};

export const utilColor = (u: UtilityKind, alpha?: number) =>
  alpha === undefined ? `hsl(var(${UTILITY_META[u].token}))` : `hsl(var(${UTILITY_META[u].token}) / ${alpha})`;

const NUMBER = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

export function formatConsumption(u: UtilityKind, value: number | null, withUnit = true): string {
  if (value === null) return '—';
  const meta = UTILITY_META[u];
  const n = new Intl.NumberFormat('it-IT', { maximumFractionDigits: meta.decimals }).format(value);
  return withUnit ? `${n} ${meta.unit}` : n;
}

/** Prezzo unitario da centesimi per unità: "0,284 €/kWh". */
export function formatUnitPrice(u: UtilityKind, cents: number | null): string {
  if (cents === null) return '—';
  return `${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(cents / 100)} ${UTILITY_META[u].priceUnit}`;
}

export function formatPct(value: number | null): string {
  if (value === null) return '';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${NUMBER.format(Math.abs(value))}%`;
}

const MONTH_SHORT = new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('it-IT', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const asDate = (iso: string) => new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);

/** "gen 26" per gli assi dei grafici. */
export function monthTick(month: string): string {
  return `${MONTH_SHORT.format(asDate(month)).replace('.', '')} ${month.slice(2, 4)}`;
}

export function monthLabel(month: string): string {
  return MONTH_YEAR.format(asDate(month)).replace('.', '');
}

export function dayLabel(iso: string | null): string {
  return iso ? DAY_MONTH_YEAR.format(asDate(iso)).replace('.', '') : '—';
}

/** "gen – feb 2026" oppure "dic 2025 – feb 2026". */
export function periodLabel(start: string | null, end: string | null): string {
  if (!start || !end) return 'Periodo non indicato';
  const s = asDate(start);
  const e = asDate(end);
  if (s.getUTCFullYear() === e.getUTCFullYear()) {
    const a = MONTH_SHORT.format(s).replace('.', '');
    const b = MONTH_YEAR.format(e).replace('.', '');
    return a === MONTH_SHORT.format(e).replace('.', '') ? b : `${a} – ${b}`;
  }
  return `${MONTH_YEAR.format(s).replace('.', '')} – ${MONTH_YEAR.format(e).replace('.', '')}`;
}

/**
 * Glifo di un servizio: tassello col colore del servizio, luce che arriva
 * dall'alto (gradiente) e icona. Tre taglie: `sm` nelle righe, `md` nelle
 * card, `lg` in testata.
 */
export function UtilityGlyph({
  utility,
  size = 'md',
  className,
}: {
  utility: UtilityKind;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const Icon = UTILITY_META[utility].icon;
  const box = { xs: 'h-6 w-6 rounded-[0.5rem]', sm: 'h-8 w-8 rounded-[0.65rem]', md: 'h-10 w-10 rounded-xl', lg: 'h-14 w-14 rounded-2xl' }[size];
  const icon = { xs: 'h-3.5 w-3.5', sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' }[size];
  return (
    <span
      aria-hidden
      className={cn('relative grid shrink-0 place-items-center text-white', box, className)}
      style={{
        backgroundColor: utilColor(utility),
        backgroundImage: 'linear-gradient(160deg, hsl(0 0% 100% / 0.32), hsl(0 0% 100% / 0) 60%)',
        boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.35), 0 4px 12px -4px ${utilColor(utility, 0.55)}`,
      }}
    >
      <Icon className={icon} strokeWidth={2.2} fill={utility === 'water' ? 'currentColor' : 'none'} />
    </span>
  );
}

/** Glifi sovrapposti per le bollette con più servizi. */
export function UtilityStack({ utilities }: { utilities: UtilityKind[] }) {
  return (
    <span className="flex shrink-0 -space-x-2">
      {utilities.map((u) => (
        <UtilityGlyph key={u} utility={u} size="sm" className="ring-2 ring-card" />
      ))}
    </span>
  );
}
