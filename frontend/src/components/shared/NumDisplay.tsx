import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export interface NumDisplayProps extends HTMLAttributes<HTMLSpanElement> {
  value: number | string;
  /** Es. '%', 'gg', 'tx'... */
  suffix?: string;
  prefix?: string;
  decimals?: number;
  locale?: string;
  /** Se true, blurra in modalità privacy (per KPI sensibili non strettamente monetari) */
  privacy?: boolean;
}

/**
 * Display di numeri non monetari (KPI, percentuali, contatori) con il
 * font numerico scelto dall'utente.
 */
export function NumDisplay({
  value,
  prefix,
  suffix,
  decimals = 0,
  locale = 'it-IT',
  privacy = false,
  className,
  ...rest
}: NumDisplayProps) {
  const num = typeof value === 'string' ? Number(value) : value;
  const formatted = Number.isFinite(num)
    ? new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(num)
    : String(value);

  return (
    <span className={cn('font-num', className)} {...rest}>
      {prefix}
      <span className={privacy ? 'money-blur-target' : undefined}>{formatted}</span>
      {suffix}
    </span>
  );
}
