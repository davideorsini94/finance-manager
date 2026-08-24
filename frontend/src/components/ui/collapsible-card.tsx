import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

export interface CollapsibleCardProps {
  /** Contenuto del titolo (icona + testo + badge di stato). Resta visibile da collassato. */
  title: ReactNode;
  /** Descrizione, mostrata solo da espanso (per non appesantire l'header collassato). */
  description?: ReactNode;
  /** Azioni sempre visibili a destra dell'header (es. pulsante "Sincronizza"). */
  action?: ReactNode;
  /** Stato iniziale. Default: espanso. */
  defaultOpen?: boolean;
  /** Se presente, lo stato aperto/chiuso viene persistito in localStorage. */
  storageKey?: string;
  children: ReactNode;
}

/**
 * Sezione delle Impostazioni comprimibile/espandibile: l'header è un bottone
 * che apre/chiude il contenuto. I badge di stato nel `title` (es. "Configurato",
 * "Ollama raggiungibile") restano visibili anche da collassato, così si vede a
 * colpo d'occhio cosa è configurato senza aprire la sezione.
 */
export function CollapsibleCard({
  title,
  description,
  action,
  defaultOpen = true,
  storageKey,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState<boolean>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === '1';
    }
    return defaultOpen;
  });

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (storageKey) localStorage.setItem(storageKey, next ? '1' : '0');
      return next;
    });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
              <span className="flex items-center gap-2 flex-wrap">{title}</span>
            </div>
            {description && open && (
              <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {open && <div className="p-4 pt-3">{children}</div>}
    </Card>
  );
}