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
            'mx-0.5 flex flex-col items-center justify-center gap-0.5 rounded-[20px] py-1.5 text-[10.5px] font-medium tracking-[0.01em] transition-[color,background-color] duration-200',
            active ? 'fm-tab-lens text-primary' : 'text-foreground/60 hover:text-foreground',
          )}
        >
          <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.8} />
          <span>{t(item.labelKey)}</span>
        </Link>
      </li>
    );
  };

  return (
    // Tab bar flottante alla iOS 26: capsula di vetro staccata dai bordi, il
    // contenuto scorre sotto e si intravede. Il <nav> esterno resta fixed e
    // trasparente perché `ios-viewport.ts` compensa il pan su `.fm-bottomnav`.
    <nav
      className="fm-bottomnav lg:hidden pointer-events-none fixed inset-x-0 bottom-[var(--fm-lvh-fix,0px)] z-30 px-3 pb-[max(0.625rem,calc(env(safe-area-inset-bottom)-0.375rem))] pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))]"
      aria-label="primary"
    >
      <ul className="fm-material pointer-events-auto relative mx-auto flex max-w-md items-stretch rounded-[28px] border p-1">
        {left.map(renderItem)}

        <li className="flex w-16 items-center justify-center">
          <button
            type="button"
            onClick={showQuickAdd}
            aria-label={t('common.add')}
            className="fm-fab grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.92]"
          >
            <Plus className="h-6 w-6" strokeWidth={2.4} />
          </button>
        </li>

        {right.map(renderItem)}
      </ul>
    </nav>
  );
}
