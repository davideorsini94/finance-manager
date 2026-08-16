import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { NAV_ITEMS, isNavItemActive } from './nav-items';
import { useQuickAdd } from '@/store/quickAddStore';

/**
 * In mobile mostriamo 4 nav primari + un bottone centrale "Aggiungi"
 * (FAB integrato). Apre sempre la modale "Nuovo movimento" globale,
 * indipendentemente dalla pagina corrente.
 */
export function BottomNav() {
  const { t } = useTranslation();
  const { location } = useRouterState();
  const showQuickAdd = useQuickAdd((s) => s.show);
  const items = NAV_ITEMS.filter((i) => i.primary).slice(0, 4);
  const left = items.slice(0, 2);
  const right = items.slice(2, 4);

  const renderItem = (item: (typeof items)[number]) => {
    const Icon = item.icon;
    const active = isNavItemActive(item.to, location.pathname);
    return (
      <li key={item.to} className="flex-1">
        <Link
          to={item.to}
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] transition-colors',
            active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-5 w-5" />
          <span>{t(item.labelKey)}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav
      className="fm-bottomnav lg:hidden fixed inset-x-0 bottom-[var(--fm-lvh-fix,0px)] z-30 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      aria-label="primary"
    >
      <ul className="relative flex items-stretch">
        {left.map(renderItem)}

        <li className="flex w-16 items-center justify-center">
          <button
            type="button"
            onClick={showQuickAdd}
            aria-label={t('common.add')}
            className="grid h-12 w-12 -translate-y-3 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-background transition-transform active:scale-95"
          >
            <Plus className="h-6 w-6" />
          </button>
        </li>

        {right.map(renderItem)}
      </ul>
    </nav>
  );
}
