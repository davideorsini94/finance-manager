import { type HTMLAttributes } from 'react';
import { centsToNumber } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';

type Cents = string | number | bigint;

export interface MoneyAmountProps extends HTMLAttributes<HTMLSpanElement> {
  /** Importo in centesimi (segno preservato) */
  cents: Cents;
  /** Currency code ISO 4217 (default EUR) */
  currency?: string;
  /** Locale (default it-IT) */
  locale?: string;
  /** Forza segno: 'auto' mostra '+' solo se positivo (utile per delta), 'never' non mostra mai segno esplicito (negativi standard JS) */
  sign?: 'auto' | 'never';
  /** Colora positivo/negativo con var --pos / --neg */
  colored?: boolean;
  /** Nascondi i decimali (es. KPI grandi) */
  hideCents?: boolean;
  /** Considera il valore come spesa (forza colore rosso anche se memorizzato come positivo) */
  asExpense?: boolean;
  /** Considera il valore come entrata (forza colore verde) */
  asIncome?: boolean;
}

/**
 * Visualizza un importo monetario in modo coerente (font numerico tabular,
 * colorato se richiesto, blurrabile in modalità privacy). Tutti i valori
 * monetari dell'app dovrebbero passare di qui.
 */
export function MoneyAmount({
  cents,
  currency = 'EUR',
  locale = 'it-IT',
  sign = 'never',
  colored = false,
  hideCents = false,
  asExpense = false,
  asIncome = false,
  className,
  ...rest
}: MoneyAmountProps) {
  const value = centsToNumber(cents);
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: hideCents ? 0 : 2,
    maximumFractionDigits: hideCents ? 0 : 2,
  });
  let formatted = fmt.format(value);
  if (sign === 'auto' && value > 0) formatted = `+${formatted}`;

  let tone: 'pos' | 'neg' | 'neutral' = 'neutral';
  if (asIncome || (colored && value > 0)) tone = 'pos';
  else if (asExpense || (colored && value < 0)) tone = 'neg';

  return (
    <span
      className={cn(
        'font-num',
        tone === 'pos' && 'text-[hsl(var(--pos))]',
        tone === 'neg' && 'text-[hsl(var(--neg))]',
        className,
      )}
      {...rest}
    >
      <span className="money-blur-target">{formatted}</span>
    </span>
  );
}
