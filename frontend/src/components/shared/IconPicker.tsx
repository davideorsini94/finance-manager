import { useRef, useState } from 'react';
import { Smile, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils/cn';
import { ICON_POOL, getIcon } from './icon-pool';

interface Props {
  value: string | null | undefined;
  onChange: (icon: string | null) => void;
  /** Colore dell'icona (anteprima trigger) */
  color?: string | null;
}

export function IconPicker({ value, onChange, color }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const Selected = getIcon(value);
  const entries = Object.entries(ICON_POOL).filter(([key]) =>
    !query.trim() || key.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 font-normal"
        >
          {value ? (
            <Selected
              className="h-5 w-5 shrink-0"
              style={color ? { color } : undefined}
            />
          ) : (
            <Smile className="h-5 w-5 shrink-0 opacity-50" />
          )}
          <span className="truncate text-sm">
            {value ?? <span className="text-muted-foreground">Scegli icona</span>}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        // Wheel manuale: dentro Radix Dialog gli eventi wheel sui Portal
        // figli a volte non scrollano automaticamente il container interno.
        // Intercettiamo l'evento sul wrapper e lo applichiamo a mano.
        onWheel={(e) => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop += e.deltaY;
          }
        }}
      >
        <div className="p-3 pb-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca icona…"
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>

        <div
          ref={scrollRef}
          className="overflow-y-auto px-3 py-2"
          style={{ height: '220px', touchAction: 'pan-y' }}
        >
          {entries.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-4">
              Nessuna icona trovata
            </p>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {entries.map(([key, Icon]) => {
                const selected = value === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    title={key}
                    onClick={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex h-9 w-full items-center justify-center rounded-md border transition-colors hover:bg-accent',
                      selected && 'bg-accent ring-2 ring-ring',
                    )}
                  >
                    <Icon
                      className="h-4 w-4"
                      style={selected && color ? { color } : undefined}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {value && (
          <div className="p-2 border-t">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full"
              onClick={() => onChange(null)}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Rimuovi icona
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
