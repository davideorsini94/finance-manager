import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight, ChevronDown, PiggyBank } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { NAV_SECTIONS, isNavItemActive } from './nav-items';
import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/button';

export function Sidebar() {
  const { t } = useTranslation();
  const { location } = useRouterState();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const sectionsCollapsed = useUIStore((s) => s.sectionsCollapsed);
  const toggleSection = useUIStore((s) => s.toggleSection);

  return (
    <aside
      className={cn(
        'hidden lg:flex shrink-0 flex-col border-r bg-card fm-chrome transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b px-4 py-4',
          collapsed && 'justify-center px-2',
        )}
      >
        <Link to="/" className="flex items-center gap-2 min-w-0" aria-label={t('app.name')}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <PiggyBank className="h-5 w-5" />
          </span>
          {!collapsed && (
            <span className="truncate text-base font-semibold tracking-tight">
              {t('app.name')}
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_SECTIONS.map((section) => {
          const isCollapsed = !collapsed && !!sectionsCollapsed[section.labelKey];
          return (
            <div key={section.labelKey} className="mb-3 px-2">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleSection(section.labelKey)}
                  className="group flex w-full items-center justify-between rounded-md px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                  aria-expanded={!isCollapsed}
                  aria-controls={`nav-${section.labelKey}`}
                >
                  <span>{t(section.labelKey)}</span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform duration-200',
                      isCollapsed && '-rotate-90',
                    )}
                  />
                </button>
              )}
              {!isCollapsed && (
                <ul id={`nav-${section.labelKey}`} className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isNavItemActive(item.to, location.pathname);
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          title={collapsed ? t(item.labelKey) : undefined}
                          className={cn(
                            'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                            collapsed && 'justify-center px-2',
                            active
                              ? 'bg-secondary text-secondary-foreground font-medium'
                              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                          )}
                        >
                          {active && (
                            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
                          )}
                          <Icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn('w-full justify-start gap-2', collapsed && 'justify-center px-2')}
          onClick={toggle}
          aria-label={collapsed ? 'Espandi sidebar' : 'Comprimi sidebar'}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" />
              <span className="text-xs">Comprimi</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
