import { Card } from '@/components/ui/card';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { AnimatedNumber } from '@/components/shared/animated/AnimatedNumber';
import { SparkLine } from '@/components/shared/animated/SparkLine';
import { Skeleton } from '@/components/shared/animated/Skeleton';
import { formatCents } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';
import { FLOW_UI, FlowHint, flowSelectProps, type Flow } from '@/features/dashboard/flow';

interface Totals {
  incomeCents: string;
  expenseCents: string;
  netCents: string;
}

interface PeriodSummaryProps {
  /** undefined finché i dati non arrivano (skeleton). */
  totals: Totals | undefined;
  /** Totali del periodo precedente, per la variazione del netto. */
  previous?: Totals;
  /** Es. "Netto del periodo", "Netto 2026". */
  netLabel: string;
  /** Es. "rispetto ai 30 giorni prima", "rispetto al 2025". */
  previousLabel?: string;
  /** Serie del netto giornaliero/mensile per il grafico nella card. */
  netSpark?: number[];
  flow: Flow;
  onSelectFlow: (flow: Flow) => void;
}

/**
 * Riepilogo di un periodo: il **netto** è il numero principale, entrate e
 * uscite stanno sotto in due riquadri con la barra di proporzione. I due
 * riquadri fanno da selettore del flusso per gli aggregati per categoria
 * (come prima le card KPI). Condiviso da Dashboard e Report.
 */
export function PeriodSummary({
  totals,
  previous,
  netLabel,
  previousLabel,
  netSpark,
  flow,
  onSelectFlow,
}: PeriodSummaryProps) {
  if (!totals) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Skeleton height={148} rounded="lg" className="col-span-2" />
        <Skeleton height={148} rounded="lg" />
        <Skeleton height={148} rounded="lg" />
      </div>
    );
  }

  const income = Number(totals.incomeCents);
  const expense = Number(totals.expenseCents);
  const net = Number(totals.netCents);
  const max = Math.max(income, expense, 1);
  const delta = previous ? net - Number(previous.netCents) : null;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <Card className="fm-card-in col-span-2 flex flex-col justify-between gap-2 overflow-hidden p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-muted-foreground">{netLabel}</span>
          {delta !== null && delta !== 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                delta > 0
                  ? 'bg-[hsl(var(--pos-soft))] text-[hsl(var(--pos))]'
                  : 'bg-[hsl(var(--neg-soft))] text-[hsl(var(--neg))]',
              )}
              title={previousLabel}
            >
              {delta > 0 ? '▲' : '▼'} {formatCents(Math.abs(delta))}
              {previousLabel && <span className="font-medium opacity-80">{previousLabel}</span>}
            </span>
          )}
        </div>
        <div
          className={cn(
            'text-[2.25rem] leading-none sm:text-[2.5rem]',
            net >= 0 ? 'text-[hsl(var(--pos))]' : 'text-[hsl(var(--neg))]',
          )}
        >
          <AnimatedNumber
            value={net / 100}
            render={(n) => <MoneyAmount cents={Math.round(n * 100)} size="hero" sign="auto" />}
          />
        </div>
        {netSpark && netSpark.length > 1 && (
          <SparkLine
            data={netSpark}
            color={net >= 0 ? 'hsl(var(--pos))' : 'hsl(var(--neg))'}
            fill
            stretch
            width={480}
            height={44}
            className="-mx-1 h-11 w-[calc(100%+0.5rem)]"
          />
        )}
      </Card>
      <FlowTile
        flow="income"
        label="Entrate"
        cents={income}
        ratio={income / max}
        active={flow === 'income'}
        onSelect={() => onSelectFlow('income')}
      />
      <FlowTile
        flow="expense"
        label="Uscite"
        cents={expense}
        ratio={expense / max}
        active={flow === 'expense'}
        onSelect={() => onSelectFlow('expense')}
      />
    </div>
  );
}

function FlowTile({
  flow,
  label,
  cents,
  ratio,
  active,
  onSelect,
}: {
  flow: Flow;
  label: string;
  cents: number;
  ratio: number;
  active: boolean;
  onSelect: () => void;
}) {
  const tone = flow === 'income' ? 'var(--pos)' : 'var(--neg)';
  return (
    <Card
      className={cn(
        'fm-card-in fm-press flex cursor-pointer flex-col justify-between gap-3 p-4 sm:p-5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && FLOW_UI[flow].selected,
      )}
      {...flowSelectProps({
        active,
        onSelect,
        hint: flow === 'income' ? 'Mostra le entrate per categoria' : 'Mostra le spese per categoria',
      })}
    >
      <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-medium text-muted-foreground">
        {label}
        <FlowHint active={active} />
      </span>
      <span className="text-xl sm:text-2xl" style={{ color: `hsl(${tone})` }}>
        <AnimatedNumber
          value={cents / 100}
          render={(n) => <MoneyAmount cents={Math.round(n * 100)} size="kpi" />}
        />
      </span>
      <span className="block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className="block h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(ratio * 100)}%`, background: `hsl(${tone})` }}
        />
      </span>
    </Card>
  );
}
