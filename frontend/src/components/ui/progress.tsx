import * as React from 'react';
import { cn } from '@/lib/utils/cn';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  indicatorClassName?: string;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, indicatorClassName, ...props }, ref) => {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
        {...props}
      >
        {/* translateX invece di width: l'animazione resta sul compositor. */}
        <div
          className={cn(
            'h-full w-full rounded-full bg-primary transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none',
            indicatorClassName,
          )}
          style={{ transform: `translateX(-${100 - pct}%)` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';
