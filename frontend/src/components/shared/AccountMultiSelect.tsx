import { useMemo, useState } from 'react';
import { Check, ChevronDown, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { getIcon } from '@/components/shared/icon-pool';
import type { Account } from '@/types/domain';

interface Props {
  accounts: Account[];
  /** Lista di id selezionati. Array vuoto = "tutti i conti". */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Testo del trigger quando è "tutti i conti" (vuoto). */
  allLabel?: string;
  className?: string;
}

/**
 * Multi-select per filtrare i dati in base a uno o più conti.
 * Convenzione: array vuoto = nessun filtro (tutti i conti accessibili).
 */
export function AccountMultiSelect({
  accounts,
  value,
  onChange,
  allLabel = 'Tutti i conti',
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedAccounts = accounts.filter((a) => selectedSet.has(a.id));

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(value.filter((x) => x !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const triggerLabel = (() => {
    if (selectedAccounts.length === 0) return allLabel;
    if (selectedAccounts.length === 1) return selectedAccounts[0].name;
    return `${selectedAccounts.length} conti`;
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('justify-between gap-2 min-w-[160px]', className)}
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <Wallet className="h-3.5 w-3.5 opacity-60" />
            <span className="truncate">{triggerLabel}</span>
          </span>
          {value.length > 0 && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {value.length}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center justify-between p-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">Filtra per conto</span>
          {value.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onChange([])}
            >
              <X className="h-3 w-3 mr-1" />
              Pulisci
            </Button>
          )}
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" style={{ touchAction: 'pan-y' }}>
          {accounts.length === 0 ? (
            <li className="text-xs text-muted-foreground text-center py-4">
              Nessun conto disponibile
            </li>
          ) : (
            accounts.map((a) => {
              const Icon = getIcon(a.icon);
              const selected = selectedSet.has(a.id);
              const tint = a.color ?? undefined;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => toggle(a.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                      selected && 'bg-accent',
                    )}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor: tint ? `${tint}33` : 'hsl(var(--muted))',
                        color: tint ?? 'hsl(var(--foreground))',
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate text-left">{a.name}</span>
                    {selected && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
