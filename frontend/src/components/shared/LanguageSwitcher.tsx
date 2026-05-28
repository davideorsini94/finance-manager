import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const LANGS = ['it', 'en'] as const;

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'it';
  const next = LANGS[(LANGS.indexOf(current as (typeof LANGS)[number]) + 1) % LANGS.length];

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('common.language')}
      onClick={() => void i18n.changeLanguage(next)}
      title={current.toUpperCase()}
    >
      <Languages className="h-4 w-4" />
    </Button>
  );
}
