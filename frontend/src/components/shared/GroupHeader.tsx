import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/** Intestazione di un gruppo di righe ("Oggi · mar 11 nov" … totale a destra). */
export function GroupHeader({
  label,
  aside,
  className,
}: {
  label: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 px-1 pb-1.5 text-xs font-semibold text-muted-foreground',
        className,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {aside && <span className="shrink-0 tabular-nums">{aside}</span>}
    </div>
  );
}
