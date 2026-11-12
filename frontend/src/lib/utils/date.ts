import { format, parseISO } from 'date-fns';
import { it, enUS } from 'date-fns/locale';
import i18n from '@/lib/i18n';

const LOCALES = { it, en: enUS } as const;

function currentLocale() {
  const lng = (i18n.resolvedLanguage ?? 'it') as keyof typeof LOCALES;
  return LOCALES[lng] ?? it;
}

export function formatDate(value: string | Date, pattern = 'dd MMM yyyy'): string {
  const d = typeof value === 'string' ? parseISO(value) : value;
  return format(d, pattern, { locale: currentLocale() });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Etichetta di un giorno per le liste raggruppate: "Oggi · mar 11 nov",
 * "Ieri · lun 10 nov", "lun 10 nov", con l'anno solo se non è quello corrente.
 * `iso` è una data YYYY-MM-DD (o un ISO completo: conta solo il giorno).
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const day = iso.slice(0, 10);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = parseISO(day);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  const sameYear = d.getFullYear() === today.getFullYear();
  const base = format(d, sameYear ? 'EEE d MMM' : 'EEE d MMM yyyy', { locale: currentLocale() });
  if (diff === 0) return `Oggi · ${base}`;
  if (diff === 1) return `Ieri · ${base}`;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Data breve per assi e righe: "13 ott" (con l'anno se diverso da quello corrente). */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = parseISO(iso.slice(0, 10));
  return format(d, d.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yy', {
    locale: currentLocale(),
  });
}
