import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface Props {
  children: ReactNode;
  /** Soglia di visibilità (0–1) per attivare il reveal */
  threshold?: number;
  /** Ritardo in ms prima dell'animazione */
  delay?: number;
  /** Classe extra */
  className?: string;
  /** Una volta visibile, smetti di osservare */
  once?: boolean;
}

/**
 * Wrapper che applica un fade+slide-up quando il figlio entra in viewport.
 * Usa la utility `.fm-reveal` definita in index.css. Rispetta reduced motion.
 */
export function Reveal({
  children,
  threshold = 0.1,
  delay = 0,
  className,
  once = true,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true);
            if (once) obs.unobserve(el);
          } else if (!once) {
            setVisible(false);
          }
        });
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold, once]);

  return (
    <div
      ref={ref}
      className={cn('fm-reveal', visible && 'is-visible', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
