import { useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { shortDate } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';

interface DateRangeChipProps {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  /** Testo senza intervallo ("Sempre", "Periodo"). */
  emptyLabel?: string;
  /** Consente di togliere l'intervallo (filtro facoltativo). */
  clearable?: boolean;
  /** Scorciatoie mostrate nel pannello. */
  presets?: { label: string; range: () => { from: string; to: string } }[];
  className?: string;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Scorciatoie comuni: mese corrente, mese scorso, ultimi 90 giorni, anno. */
export const COMMON_RANGES: NonNullable<DateRangeChipProps['presets']> = [
  {
    label: 'Questo mese',
    range: () => {
      const n = new Date();
      return { from: iso(new Date(n.getFullYear(), n.getMonth(), 1)), to: iso(n) };
    },
  },
  {
    label: 'Mese scorso',
    range: () => {
      const n = new Date();
      return {
        from: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
        to: iso(new Date(n.getFullYear(), n.getMonth(), 0)),
      };
    },
  },
  {
    label: 'Ultimi 90 giorni',
    range: () => ({ from: iso(new Date(Date.now() - 90 * 86_400_000)), to: iso(new Date()) }),
  },
  {
    label: "Quest'anno",
    range: () => ({ from: `${new Date().getFullYear()}-01-01`, to: iso(new Date()) }),
  },
];

/**
 * Chip del periodo: mostra l'intervallo in breve ("13 ott – 12 nov") e apre un
 * pannello con le scorciatoie e le due date. Sostituisce la coppia di campi
 * gg/mm/aaaa sempre visibili, che andava a capo su tablet.
 */
export function DateRangeChip({
  from,
  to,
  onChange,
  emptyLabel = 'Periodo',
  clearable = false,
  presets = COMMON_RANGES,
  className,
}: DateRangeChipProps) {
  const [open, setOpen] = useState(false);
  const active = !!(from || to);
  const label = active
    ? `${from ? shortDate(from) : '…'} – ${to ? shortDate(to) : 'oggi'}`
    : emptyLabel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1.5 rounded-full border-border/80 bg-card/70 px-3 font-medium',
            active && clearable && 'border-transparent bg-accent text-accent-foreground hover:bg-accent',
            className,
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 opacity-60" />
          <span className="whitespace-nowrap tabular-nums">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onChange(p.range());
                setOpen(false);
              }}
              className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="range-from" className="text-xs text-muted-foreground">Dal</Label>
            <Input
              id="range-from"
              type="date"
              value={from ?? ''}
              max={to}
              onChange={(e) => onChange({ from: e.target.value || undefined, to })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="range-to" className="text-xs text-muted-foreground">Al</Label>
            <Input
              id="range-to"
              type="date"
              value={to ?? ''}
              min={from}
              onChange={(e) => onChange({ from, to: e.target.value || undefined })}
            />
          </div>
        </div>
        {clearable && active && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              onChange({ from: undefined, to: undefined });
              setOpen(false);
            }}
          >
            <X className="mr-1.5 h-3.5 w-3.5" /> Togli il periodo
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
