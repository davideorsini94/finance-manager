import { useMemo, type HTMLAttributes } from 'react';
import { centsToNumber } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';

type Cents = string | number | bigint;

/** Quanto "peso" dare all'importo. È una scelta tipografica, non semantica. */
export type MoneySize = 'inline' | 'row' | 'kpi' | 'hero';

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
  /** Scala tipografica. `hero`/`kpi` usano la faccia display. */
  size?: MoneySize;
}

/**
 * Come si scrive il denaro in questa app.
 *
 * `Intl.NumberFormat.formatToParts()` invece di `format()`: le parti vengono
 * composte con pesi diversi — intero pieno, decimali e simbolo di valuta più
 * piccoli e smorzati. È il dettaglio che distingue una colonna di importi
 * scritta con intenzione da una stringa stampata così com'è; e siccome le
 * cifre sono tabulari, nelle liste le colonne si incolonnano davvero.
 *
 * Tutti i valori monetari dell'app dovrebbero passare di qui: dove serve una
 * stringa (formatter dei grafici, testo di una modale) resta `formatCents`.
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
  size = 'inline',
  className,
  ...rest
}: MoneyAmountProps) {
  const value = centsToNumber(cents);

  const parts = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: hideCents ? 0 : 2,
        maximumFractionDigits: hideCents ? 0 : 2,
      }).formatToParts(value),
    [locale, currency, hideCents, value],
  );

  let tone: 'pos' | 'neg' | 'neutral' = 'neutral';
  if (asIncome || (colored && value > 0)) tone = 'pos';
  else if (asExpense || (colored && value < 0)) tone = 'neg';

  const scale = SIZES[size];

  return (
    <span
      className={cn(
        'font-num inline-flex items-baseline whitespace-nowrap',
        scale.root,
        tone === 'pos' && 'text-[hsl(var(--pos))]',
        tone === 'neg' && 'text-[hsl(var(--neg))]',
        className,
      )}
      {...rest}
    >
      <span className="money-blur-target inline-flex items-baseline">
        {sign === 'auto' && value > 0 && <span className={scale.minor}>+</span>}
        {parts.map((part, i) => {
          switch (part.type) {
            // Simbolo e decimali arretrano: l'occhio deve cadere sull'intero.
            case 'currency':
              return (
                <span key={i} className={cn(scale.symbol, 'ml-[0.15em]')}>
                  {part.value}
                </span>
              );
            case 'decimal':
            case 'fraction':
              return (
                <span key={i} className={scale.minor}>
                  {part.value}
                </span>
              );
            case 'literal':
              // Lo spazio prima del simbolo lo gestiamo noi con il margine.
              return part.value.trim() ? <span key={i}>{part.value}</span> : null;
            default:
              return <span key={i}>{part.value}</span>;
          }
        })}
      </span>
    </span>
  );
}

/**
 * Una sola faccia (quella dell'interfaccia) a tutte le taglie: a cambiare è il
 * peso e il rapporto tra intero, decimali e simbolo. Nelle taglie grandi lo
 * stacco è più marcato, perché lì il numero è il soggetto della schermata.
 */
const SIZES: Record<MoneySize, { root: string; minor: string; symbol: string }> = {
  inline: { root: '', minor: 'opacity-60', symbol: 'opacity-50' },
  row: { root: 'font-medium', minor: 'text-[0.85em] opacity-60', symbol: 'text-[0.8em] opacity-50' },
  kpi: {
    root: 'font-semibold tracking-tight',
    minor: 'text-[0.55em] font-medium opacity-60',
    symbol: 'text-[0.5em] font-medium opacity-50',
  },
  hero: {
    root: 'font-semibold tracking-tight',
    minor: 'text-[0.45em] font-medium opacity-60',
    symbol: 'text-[0.4em] font-medium opacity-50',
  },
};
