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
