import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Paperclip } from 'lucide-react';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { findIcon } from '@/components/shared/icon-pool';
import type { Transaction } from '@/types/domain';

const TYPE_LABEL = { income: 'Entrata', expense: 'Uscita', transfer: 'Giroconto' } as const;

/**
 * Contenuto di una riga movimento: tassello con icona e colore della
 * categoria, descrizione, "categoria · conto" e importo. Usato da Movimenti e
 * dalle Ultime operazioni della Dashboard, così le due liste si leggono uguali.
 */
export function TxRowContent({
  tx,
  showAccount = true,
}: {
  tx: Transaction;
  showAccount?: boolean;
}) {
  const isTransfer = tx.type === 'transfer';
  const cents = Number(tx.amountCents);
  const color = tx.category?.color ?? null;
  const Icon = isTransfer
    ? ArrowLeftRight
    : (findIcon(tx.category?.icon) ?? (cents >= 0 ? ArrowUpRight : ArrowDownRight));
  const tone = isTransfer
    ? 'text-muted-foreground'
    : cents >= 0
      ? 'text-[hsl(var(--pos))]'
      : 'text-[hsl(var(--neg))]';
  const meta = [
    isTransfer ? 'Giroconto' : tx.category?.name,
    showAccount ? tx.account.name : null,
  ].filter(Boolean);

  return (
    <>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
        style={
          color && !isTransfer
            ? { backgroundColor: color, color: '#fff' }
            : { backgroundColor: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }
        }
        aria-hidden
      >
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug">
          {tx.description || (isTransfer ? 'Giroconto' : TYPE_LABEL[tx.type])}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{meta.join(' · ') || 'Senza categoria'}</span>
          {tx.attachments.length > 0 && (
            <span className="inline-flex shrink-0 items-center" title="Allegati">
              <Paperclip className="mr-0.5 h-3 w-3" aria-hidden />
              {tx.attachments.length}
            </span>
          )}
          {tx.isPending && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium">
              In attesa
            </span>
          )}
        </span>
      </span>
      <MoneyAmount cents={cents} size="row" className={`shrink-0 text-right text-[15px] font-semibold ${tone}`} />
    </>
  );
}

/** Raggruppa i movimenti per giorno mantenendo l'ordine della lista. */
export function groupByDay(items: Transaction[]): { day: string; items: Transaction[]; netCents: number }[] {
  const groups: { day: string; items: Transaction[]; netCents: number }[] = [];
  for (const tx of items) {
    const day = tx.transactionDate.slice(0, 10);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      g = { day, items: [], netCents: 0 };
      groups.push(g);
    }
    g.items.push(tx);
    // I giroconti non sono né entrate né uscite: fuori dal totale del giorno.
    if (tx.type !== 'transfer') g.netCents += Number(tx.amountCents);
  }
  return groups;
}
