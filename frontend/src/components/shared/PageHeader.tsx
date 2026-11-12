import type { ReactNode } from 'react';
import { Plus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

interface PageHeaderProps {
  title: string;
  /** Riga sotto il titolo: solo se aggiunge qualcosa al titolo. */
  subtitle?: ReactNode;
  /** Azione principale della pagina ("Nuovo movimento"). */
  action?: { label: string; onClick: () => void; icon?: LucideIcon; disabled?: boolean };
  /** Altri controlli a destra (sempre visibili). */
  extra?: ReactNode;
  className?: string;
}

/**
 * Titolo grande della pagina con l'azione principale. Su PC l'azione è un
 * pulsante col testo; su telefono e tablet un cerchio di vetro col + accanto
 * al titolo: il pulsante pieno largo metà schermo ripeteva il + della tab bar.
 */
export function PageHeader({ title, subtitle, action, extra, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="fm-large-title">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {extra}
        {action && <AddButton {...action} />}
      </div>
    </div>
  );
}

/**
 * Azione principale di una pagina: pulsante col testo su PC, cerchio di vetro
 * col + su telefono e tablet (dove il testo occupava metà riga).
 */
export function AddButton({
  label,
  onClick,
  icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
}) {
  const Icon = icon ?? Plus;
  return (
    <>
      <Button className="hidden lg:inline-flex" onClick={onClick} disabled={disabled}>
        <Icon className="mr-2 h-4 w-4" /> {label}
      </Button>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="fm-material fm-glass-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:hidden"
      >
        <Icon className="h-5 w-5" strokeWidth={2.2} />
      </button>
    </>
  );
}
