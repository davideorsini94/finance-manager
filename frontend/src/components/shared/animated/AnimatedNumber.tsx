import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';

interface Props {
  /** Valore finale */
  value: number;
  /** Durata in ms */
  duration?: number;
  /** Funzione di formattazione */
  format?: (n: number) => string;
  /** Decimali nel default formatter */
  decimals?: number;
  /** Prefisso (es. "€", "+€", "−€") */
  prefix?: string;
  /** Suffisso (es. "%") */
  suffix?: string;
  className?: string;
  /** Animazione disabilitata se reduced motion */
  disableMotion?: boolean;
}

const defaultFmt = (n: number, decimals: number) =>
  new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Anima un numero da 0 (o dal valore precedente) al valore target con easing.
 * Rispetta `prefers-reduced-motion`. Usa `tabular-nums` automaticamente.
 */
export function AnimatedNumber({
  value,
  duration = 1200,
  format,
  decimals = 2,
  prefix = '',
  suffix = '',
  className,
  disableMotion,
}: Props) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (disableMotion || reducedMotion()) {
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4); // easeOutQuart
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, disableMotion]);

  const formatted = format ? format(display) : defaultFmt(display, decimals);
  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
