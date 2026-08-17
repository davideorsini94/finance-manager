import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Verso mostrato dagli aggregati per categoria (torta, lista, albero):
 * uscite — il default storico — oppure entrate. Condiviso tra dashboard e
 * pagina Report, dove le card KPI Entrate/Uscite fanno da selettore.
 * Rispecchia `CategoryFlow` del backend.
 */
export type Flow = 'expense' | 'income';

/** Etichette e colori dipendenti dal flusso, in un posto solo. */
export const FLOW_UI: Record<
  Flow,
  {
    /** Titolo della card "per categoria". */
    categoryTitle: string;
    /** Nome del flusso, per titoli e descrizioni ("uscite"/"entrate"). */
    name: string;
    /** Plurale dei movimenti, per i testi delle liste ("spese"/"entrate"). */
    itemsPlural: string;
    /** Testo a lista vuota. */
    noneLabel: string;
    /** Testo a grafico vuoto. */
    emptyChart: string;
    /**
     * Evidenziazione della card/voce selezionata. **Outline, non ring**: nel tema
     * glass `fm-glass` sovrascrive il `box-shadow` della card e l'anello di
     * Tailwind sparirebbe (stessa trappola delle card conto dei Movimenti).
     */
    selected: string;
    /** Sfondo tenue per le voci selezionate compatte (colonne di confronto). */
    selectedTint: string;
  }
> = {
  expense: {
    categoryTitle: 'Spese per categoria',
    name: 'uscite',
    itemsPlural: 'spese',
    noneLabel: 'Nessuna spesa.',
    emptyChart: 'Nessuna spesa nel periodo',
    selected: 'outline outline-2 outline-offset-2 outline-red-500',
    selectedTint: 'bg-red-500/10',
  },
  income: {
    categoryTitle: 'Entrate per categoria',
    name: 'entrate',
    itemsPlural: 'entrate',
    noneLabel: 'Nessuna entrata.',
    emptyChart: 'Nessuna entrata nel periodo',
    selected: 'outline outline-2 outline-offset-2 outline-emerald-500',
    selectedTint: 'bg-emerald-500/10',
  },
};

/**
 * Props di accessibilità/interazione per rendere una card KPI un selettore di
 * flusso. Le `Card` del progetto sono `div`: serve `role`/`tabIndex` e la
 * gestione di Invio/Spazio, che sarebbe da duplicare in ogni pagina.
 */
export function flowSelectProps(opts: { active: boolean; hint: string; onSelect: () => void }) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': opts.active,
    title: opts.hint,
    onClick: opts.onSelect,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        opts.onSelect();
      }
    },
  };
}

/** Micro-hint sulla card KPI: senza affordance il click non si scoprirebbe. */
export function FlowHint({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'text-[10px] font-medium normal-case tracking-normal',
        active ? 'text-foreground/70' : 'text-muted-foreground/60',
      )}
    >
      {active ? '· in dettaglio' : '· vedi dettaglio'}
    </span>
  );
}
