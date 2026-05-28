/**
 * Tutti gli importi nel backend sono in centesimi (BigInt) e arrivano al
 * frontend come stringhe per evitare overflow di JS Number sopra ~9e15 cents.
 */

export function centsToNumber(cents: string | number | bigint): number {
  if (typeof cents === 'number') return cents / 100;
  if (typeof cents === 'bigint') return Number(cents) / 100;
  return Number(cents) / 100;
}

export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

const FORMATTER = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
});

export function formatCents(cents: string | number | bigint): string {
  return FORMATTER.format(centsToNumber(cents));
}

export function formatCentsSigned(cents: string | number | bigint): string {
  const value = centsToNumber(cents);
  const sign = value > 0 ? '+' : '';
  return `${sign}${FORMATTER.format(value)}`;
}
