import { Moon, Sun, MonitorSmartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { applyTheme, useUIStore } from '@/store/uiStore';

export function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : MonitorSmartphone;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('common.theme.toggle')}
      onClick={() => {
        setTheme(next);
        applyTheme(next);
      }}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
