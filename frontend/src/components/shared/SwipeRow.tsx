import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface SwipeAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onAction: () => void;
  tone?: 'primary' | 'destructive' | 'neutral';
  disabled?: boolean;
}

interface SwipeRowProps {
  actions: SwipeAction[];
  children: ReactNode;
  /** Tocco/click sulla riga (non sulle azioni): apre il dettaglio. */
  onActivate?: () => void;
  /** Posti riservati alle azioni col mouse: uguale tra righe con un numero
   *  diverso di azioni, tiene gli importi incolonnati. */
  slots?: number;
  className?: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
}

/** Larghezza di un'azione rivelata dallo swipe. */
const ACTION_W = 72;
/** Spostamento minimo prima di decidere la direzione del gesto. */
const SLOP = 10;
/** Velocità (px/ms) oltre la quale un colpetto basta ad aprire o chiudere. */
const FLICK = 0.35;

/** Una sola riga aperta alla volta in tutta l'app. */
const OPEN_EVENT = 'fm-swipe-open';

const TONE: Record<NonNullable<SwipeAction['tone']>, string> = {
  primary: 'bg-primary text-primary-foreground',
  destructive: 'bg-[hsl(var(--neg))] text-white',
  neutral: 'bg-muted-foreground/80 text-white',
};

/**
 * Riga con azioni nascoste, come le liste di iOS.
 *
 * - **Dito** (`pointer: coarse`): si scorre la riga a sinistra e compaiono le
 *   azioni; un colpetto basta (velocità), oltre la fine la riga resiste. Lo
 *   scroll verticale resta al browser (`touch-action: pan-y`) e la direzione
 *   si decide solo dopo 10px, così scorrere la lista non apre le righe.
 * - **Mouse** (`pointer: fine`): le azioni sono pulsanti a destra della riga,
 *   visibili al passaggio o col focus da tastiera.
 *
 * Al posto delle tre icone sempre visibili, che si mangiavano un terzo della
 * riga e tagliavano le descrizioni.
 */
export function SwipeRow({
  actions,
  children,
  onActivate,
  slots = 0,
  className,
  contentClassName,
  contentStyle,
}: SwipeRowProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const width = actions.length * ACTION_W;
  const drag = useRef<{
    x: number;
    y: number;
    t: number;
    from: number;
    axis: 'x' | 'y' | null;
    offset: number;
    v: number;
  } | null>(null);
  // Fine dell'ultimo trascinamento: il click che il browser può emettere
  // subito dopo non deve aprire la riga (né chiuderla due volte).
  const dragEndAt = useRef(0);
  // Le azioni dietro la riga esistono solo mentre servono: sempre presenti,
  // il rosso di "Elimina" filtrava dagli angoli arrotondati della card.
  const [revealed, setRevealed] = useState(false);

  const place = (offset: number, animate: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 340ms var(--ease-drawer)' : 'none';
    el.style.transform = offset ? `translate3d(${offset}px,0,0)` : '';
  };

  useEffect(() => {
    place(open ? -width : 0, true);
    if (!open) {
      const t = window.setTimeout(() => {
        if (!drag.current) setRevealed(false);
      }, 360);
      return () => window.clearTimeout(t);
    }
    setRevealed(true);
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    const onOutside = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open, width, id]);

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, onOther);
    return () => window.removeEventListener(OPEN_EVENT, onOther);
  }, [id]);

  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' || actions.length === 0) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      from: open ? -width : 0,
      axis: null,
      offset: open ? -width : 0,
      v: 0,
    };
  };

  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.axis === null) {
      if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) {
        d.axis = 'x';
        setRevealed(true);
        contentRef.current?.setPointerCapture(e.pointerId);
      } else if (Math.abs(dy) > SLOP) {
        d.axis = 'y';
      }
    }
    if (d.axis !== 'x') return;
    let next = d.from + dx;
    // Oltre i bordi la riga resiste invece di fermarsi di colpo.
    if (next > 0) next = next * 0.25;
    if (next < -width) next = -width + (next + width) * 0.25;
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = (next - d.offset) / dt;
    d.t = e.timeStamp;
    d.offset = next;
    place(next, false);
  };

  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== 'x') return;
    dragEndAt.current = performance.now();
    const shouldOpen = d.v < -FLICK ? true : d.v > FLICK ? false : d.offset < -width / 2;
    if (shouldOpen !== open) {
      setOpen(shouldOpen);
      return;
    }
    place(open ? -width : 0, true);
    if (!open) window.setTimeout(() => !drag.current && setRevealed(false), 360);
  };

  const onClick = () => {
    if (performance.now() - dragEndAt.current < 350) return;
    if (open) {
      setOpen(false);
      return;
    }
    onActivate?.();
  };

  const run = (a: SwipeAction) => {
    setOpen(false);
    a.onAction();
  };

  return (
    <div ref={rootRef} className={cn('group/swipe relative overflow-hidden', className)}>
      {/* Azioni rivelate dal dito: dietro la riga, solo su schermi touch e
          solo mentre la riga si sposta o resta aperta. */}
      <div
        className={cn('absolute inset-y-0 right-0 flex [@media(pointer:fine)]:hidden', !revealed && 'invisible')}
        style={{ width }}
      >
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={a.disabled}
            tabIndex={open ? 0 : -1}
            onClick={() => run(a)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold disabled:opacity-50',
              TONE[a.tone ?? 'neutral'],
            )}
          >
            <a.icon className="h-[18px] w-[18px]" aria-hidden />
            {a.label}
          </button>
        ))}
      </div>
      <div
        ref={contentRef}
        role={onActivate ? 'button' : undefined}
        tabIndex={onActivate ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => {
          if (!onActivate || e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={contentStyle}
        className={cn(
          'relative flex items-center gap-3 bg-card [touch-action:pan-y]',
          onActivate && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          contentClassName,
        )}
      >
        {children}
        {/* Col mouse: spazio riservato alle azioni, uguale su tutte le righe
            così gli importi restano incolonnati. */}
        {actions.length > 0 && (
          <span
            aria-hidden
            className="hidden shrink-0 [@media(pointer:fine)]:block"
            style={{ width: Math.max(actions.length, slots) * 36 }}
          />
        )}
      </div>
      {/* Azioni col mouse: fratelli della riga (non dentro il suo
          role=button), visibili al passaggio o col focus da tastiera. */}
      {actions.length > 0 && (
        <div className="pointer-events-none absolute inset-y-0 right-3 hidden items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/swipe:pointer-events-auto group-hover/swipe:opacity-100 group-focus-within/swipe:pointer-events-auto group-focus-within/swipe:opacity-100 sm:right-4 [@media(pointer:fine)]:flex">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={a.disabled}
              title={a.label}
              aria-label={a.label}
              onClick={() => a.onAction()}
              className={cn(
                'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/80 text-muted-foreground transition-colors',
                'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                a.tone === 'destructive' && 'hover:text-[hsl(var(--neg))]',
              )}
            >
              <a.icon className="h-4 w-4" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
