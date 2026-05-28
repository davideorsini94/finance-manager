import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface Props {
  children: ReactNode;
  className?: string;
  /** Tag da usare come root (default: div) */
  as?: 'div' | 'ul' | 'ol' | 'section';
}

/**
 * Container che applica entry animation staggered ai figli diretti.
 * I figli devono avere classe `fm-card-in` per opacizzarsi/slittare in alto.
 * Stagger fino a 8 elementi via :nth-child (vedi index.css).
 */
export function StaggerList({ children, className, as: Tag = 'div' }: Props) {
  return <Tag className={cn('fm-stagger', className)}>{children}</Tag>;
}
