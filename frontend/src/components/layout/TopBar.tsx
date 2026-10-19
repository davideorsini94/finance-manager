import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import { PrivacyToggle } from '@/components/shared/PrivacyToggle';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';
import { CommandSearch } from './CommandSearch';
import { MobileMenu } from './MobileMenu';
import { NAV_ITEMS, isNavItemActive } from './nav-items';
import { useScrollStore } from '@/store/scrollStore';
import { cn } from '@/lib/utils/cn';

/**
 * Barra superiore alla Liquid Glass: nessuna striscia piena, solo controlli
 * flottanti di vetro (menu a sinistra, gruppo di azioni a destra) sopra il
 * contenuto che scorre. Dove il contenuto passa sotto compare lo scroll edge
 * effect (sfumatura + sfocatura) al posto del filo divisorio.
 *
 * Il vetro dei controlli sta su uno strato fratello (`<span aria-hidden>`),
 * non sul contenitore dei pulsanti: un `backdrop-filter` su un antenato
 * diventa il containing block dei `position: fixed` (il pannello notifiche
 * su mobile) e impedisce ai figli di sfocare la pagina (vetro su vetro).
 */
export function TopBar() {
  const { t } = useTranslation();
  const { location } = useRouterState();
  const scrolled = useScrollStore((s) => s.scrolled);
  const titleShown = useScrollStore((s) => s.titleShown);
  const current = NAV_ITEMS.find((i) => isNavItemActive(i.to, location.pathname));

  return (
    <header className="sticky top-0 z-20" style={{ paddingTop: 'var(--safe-top)' }}>
      <div
        aria-hidden
        className={cn(
          'fm-scroll-edge-top pointer-events-none absolute inset-x-0 top-0 -bottom-5 transition-opacity duration-200',
          scrolled ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className="relative flex h-16 items-center gap-3 px-4 lg:px-6">
        <div className="lg:hidden">
          <MobileMenu />
        </div>

        {/* Titolo compatto: compare quando quello grande della pagina è
            scorso sotto la barra (large title di iOS). */}
        {current && (
          <div
            aria-hidden={!titleShown}
            className={cn(
              'pointer-events-none absolute left-1/2 max-w-[42%] -translate-x-1/2 truncate text-[15px] font-semibold transition-opacity duration-200 lg:hidden',
              titleShown ? 'opacity-100' : 'opacity-0',
            )}
          >
            {t(current.labelKey)}
          </div>
        )}

        <div className="hidden max-w-md flex-1 lg:flex">
          <CommandSearch />
        </div>

        <div role="group" aria-label="Azioni rapide" className="relative ml-auto flex h-11 items-center gap-0.5 px-1">
          <span aria-hidden className="fm-material pointer-events-none absolute inset-0 rounded-full border" />
          <div className="relative flex items-center gap-0.5">
            <PrivacyToggle />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
