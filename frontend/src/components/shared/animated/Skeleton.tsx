import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils/cn';

interface Props {
  className?: string;
  width?: number | string;
  height?: number | string;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
  style?: CSSProperties;
}

/**
 * Sostituisce `animate-pulse` con uno shimmer più elegante (gradient sliding).
 * Usato per caricamenti card/lista.
 */
export function Skeleton({ className, width, height, rounded = 'md', style }: Props) {
  const r =
    rounded === 'sm'
      ? 'rounded-sm'
      : rounded === 'md'
        ? 'rounded-md'
        : rounded === 'lg'
          ? 'rounded-lg'
          : 'rounded-full';
  return (
    <div
      className={cn('fm-shimmer', r, className)}
      style={{ width, height, ...style }}
      aria-hidden
    />
  );
}
