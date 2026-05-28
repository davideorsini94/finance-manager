import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { PrivacyToggle } from '@/components/shared/PrivacyToggle';
import { PaletteToggle } from './PaletteToggle';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';
import { CommandSearch } from './CommandSearch';
import { MobileMenu } from './MobileMenu';

export function TopBar() {
  const { t } = useTranslation();

  return (
    <header
      className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur fm-chrome"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
        <div className="lg:hidden -ml-2">
          <MobileMenu />
        </div>
        <div className="flex-1 lg:hidden text-base font-semibold truncate">{t('app.name')}</div>

        <div className="hidden lg:flex flex-1 max-w-md">
          <CommandSearch />
        </div>

        <div className="flex items-center gap-1">
          <PrivacyToggle />
          <PaletteToggle />
          <LanguageSwitcher />
          <ThemeToggle />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
