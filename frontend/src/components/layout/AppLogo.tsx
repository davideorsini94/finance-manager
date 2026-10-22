import { useId } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Icona dell'app (pallottoliere, v0.21.2): la stessa di `public/favicon.svg`
 * e dei PNG in `public/icons/`, disegnata inline per la barra laterale e il
 * menu. Id dei gradienti unici per istanza (`useId`).
 */
export function AppLogo({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const beads: Array<[number, number[], string]> = [
    [36, [27, 37, 47], '#ffb340'],
    [50, [27, 37, 64, 74], '#7d7aff'],
    [64, [27, 54, 64, 74], '#30d0c6'],
  ];
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={cn('shrink-0 rounded-[22.37%] shadow-sm', className)}>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a9ad4" />
          <stop offset="1" stopColor="#0d4f78" />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe8ef" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22.37" fill={`url(#${id}b)`} />
      <rect x="16" y="18" width="68" height="64" rx="11" fill="none" stroke={`url(#${id}f)`} strokeWidth="7" />
      {[36, 50, 64].map((y) => (
        <path key={y} d={`M19 ${y} H81`} stroke="#ffffff" strokeOpacity=".5" strokeWidth="2.5" />
      ))}
      {beads.flatMap(([y, xs, c]) => xs.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="6" fill={c} />))}
    </svg>
  );
}
