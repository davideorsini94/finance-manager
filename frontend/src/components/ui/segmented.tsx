import { cn } from '@/lib/utils/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Controllo segmentato alla iOS: capsula di vetro (livello funzionale) con la
 * voce scelta su un foglio pieno. Sostituisce le file di pulsanti outline
 * (7g/30g/90g, mensile/annuale) che andavano a capo e non dicevano quale
 * fosse attivo. `value` null = nessuna voce scelta (es. date personalizzate).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('fm-material flex gap-0.5 rounded-full border p-1', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-[32px] flex-1 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold',
              'transition-[background-color,color,box-shadow] duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-card text-foreground shadow-[0_1px_3px_hsl(var(--foreground)/0.14)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
