import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Un'azione che porta fuori dal vuoto ("Ultimi 90 giorni", "Aggiungi"). */
  action?: ReactNode;
  className?: string;
}

/** Stato vuoto con un'uscita: dice perché non c'è niente e cosa fare. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {description && (
        <p className="mt-1 max-w-[36ch] text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
