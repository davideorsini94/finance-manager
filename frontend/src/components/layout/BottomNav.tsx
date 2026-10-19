import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { NAV_ITEMS, isNavItemActive } from './nav-items';
import { useQuickAdd } from '@/store/quickAddStore';
import { useScrollStore } from '@/store/scrollStore';

/**
 * Tab bar mobile alla iOS 26: capsula di vetro con le 4 sezioni principali e,
 * staccato, un cerchio di vetro tinto per "Nuovo movimento" (l'azione
 * primaria, come la tab di ricerca di iOS). Scorrendo in giù la capsula si
 * riduce alla sola voce attiva e torna intera scorrendo in su
 * (`tabBarMinimizeBehavior(.onScrollDown)`).
 *
 * Il `<nav>` esterno resta fixed e trasparente: è lui che `ios-viewport.ts`
 * sposta per compensare il pan del visual viewport su iOS.
 */
export function BottomNav() {
  const { t } = useTranslation();
  const { location } = useRouterState();
  const showQuickAdd = useQuickAdd((s) => s.show);
  const compact = useScrollStore((s) => s.compact);
  const items = NAV_ITEMS.filter((i) => i.primary).slice(0, 4);

  return (
    <nav
      data-compact={compact || undefined}
      className="fm-bottomnav group/nav pointer-events-none fixed inset-x-0 bottom-[var(--fm-lvh-fix,0px)] z-30 pb-[max(0.75rem,calc(env(safe-area-inset-bottom)-0.25rem))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] lg:hidden"
      aria-label="primary"
    >
      {/* Scroll edge in basso: il contenuto che passa sotto la tab bar sfuma. */}
      <div aria-hidden className="fm-scroll-edge-bottom absolute inset-x-0 bottom-0 h-32" />
      <div className="relative mx-auto flex max-w-md items-end justify-center gap-2.5">
        <ul className="fm-material fm-tabcap pointer-events-auto flex h-16 min-w-0 max-w-[19rem] flex-1 items-center overflow-hidden rounded-[2rem] border p-1">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(item.to, location.pathname);
            return (
              <li key={item.to} data-active={active || undefined} className="fm-tab flex min-w-0 flex-1 justify-center">
                <Link
                  to={item.to}
                  aria-label={t(item.labelKey)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    // Raggio concentrico: capsula 32px − padding 4px = 28px.
                    'fm-glass-press flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-[1.75rem] text-[10.5px] font-medium',
                    active ? 'bg-foreground/[0.07] text-primary' : 'text-foreground',
                  )}
                >
                  <Icon className="h-6 w-6" strokeWidth={active ? 2.1 : 1.8} />
                  <span className="fm-tab-label">{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={showQuickAdd}
          aria-label={t('common.add')}
          className="fm-material fm-fab fm-glass-press pointer-events-auto grid h-16 w-16 shrink-0 place-items-center rounded-full border text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="h-7 w-7" strokeWidth={2.4} />
        </button>
      </div>
    </nav>
  );
}
