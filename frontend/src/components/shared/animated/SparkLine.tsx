import { useId } from 'react';
import { cn } from '@/lib/utils/cn';

interface Props {
  /** Punti dati grezzi (l'asse X è implicito = indice) */
  data: number[];
  width?: number;
  height?: number;
  /** Tinta della linea (default: var(--primary)) */
  color?: string;
  /** Mostra fill area sottostante */
  fill?: boolean;
  className?: string;
  /** Disabilita draw-in */
  disableMotion?: boolean;
  strokeWidth?: number;
}

/**
 * Mini grafico a linea con animazione draw-in (stroke-dasharray).
 * Usato nelle KPI card della Dashboard, Budget, Goals.
 */
export function SparkLine({
  data,
  width = 100,
  height = 36,
  color,
  fill = false,
  className,
  disableMotion,
  strokeWidth = 2,
}: Props) {
  const gradId = useId();
  if (!data.length) return <svg width={width} height={height} className={className} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const pad = strokeWidth;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  // Smooth curve via cardinal interpolation lite (avg di 2 punti)
  const path = points
    .map(([x, y], i, arr) => {
      if (i === 0) return `M${x},${y}`;
      const [px, py] = arr[i - 1];
      const cx = (px + x) / 2;
      return `Q${cx},${py} ${x},${y}`;
    })
    .join(' ');
  const areaPath = `${path} L${width},${height} L0,${height} Z`;

  const stroke = color ?? 'hsl(var(--primary))';
  const animClass = disableMotion ? '' : 'fm-spark-path';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.3" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#spark-${gradId})`} opacity="0.7" />
        </>
      )}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animClass}
      />
    </svg>
  );
}
