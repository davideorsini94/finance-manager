import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Menu, X, PiggyBank } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NAV_SECTIONS, isNavItemActive } from './nav-items';
import { cn } from '@/lib/utils/cn';

/**
 * Drawer laterale per smartphone: hamburger nella TopBar che apre un
 * pannello con TUTTE le voci di navigazione (le sezioni della Sidebar),
 * inclusi gli endpoint che la BottomNav non ha spazio di mostrare
 * (Categorie, Budget, Ricorrenze, Obiettivi, Importazioni, Settings, ...).
 *
 * Visibile solo `< lg` (la sidebar desktop ha già tutto).
 */
export function MobileMenu() {
  const { t } = useTranslation();
  const { location } = useRouterState();
  const [open, setOpen] = useState(false);

  // Chiudi al cambio rotta (per quando l'utente clicca un Link interno)
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Blocca scroll del body quando il drawer è aperto
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Chiusura con ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Menu"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Portal su body: la TopBar (sticky z-20) crea uno stacking context,
          quindi senza portal il drawer — pur con z-50 — finirebbe DIETRO la
          BottomNav (z-30, contesto radice) che ne copriva le ultime voci. */}
      {createPortal(
        <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 h-[calc(100dvh-var(--fm-lvh-fix,0px))] z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/* Drawer */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-[calc(100dvh-var(--fm-lvh-fix,0px))] w-72 max-w-[85vw] flex-col border-r bg-card shadow-xl',
          'transition-transform duration-200 lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{
          paddingTop: 'var(--safe-top)',
          // Somma l'eventuale offset del visual viewport (banda scoperta da
          // pan residuo su iOS standalone, vedi lib/ios-viewport.ts) così
          // l'ultima voce del menu non resta nascosta sotto la zona scoperta.
          paddingBottom: 'calc(var(--safe-bottom) + var(--fm-vv-offset, 0px))',
          paddingLeft: 'var(--safe-left)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu di navigazione"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <Link
            to="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 min-w-0"
            aria-label={t('app.name')}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <PiggyBank className="h-5 w-5" />
            </span>
            <span className="truncate text-base font-semibold tracking-tight">{t('app.name')}</span>
          </Link>
          <Button variant="ghost" size="icon" aria-label="Chiudi" onClick={() => setOpen(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto pt-3 pb-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.labelKey} className="mb-4 px-2">
              <div className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t(section.labelKey)}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(item.to, location.pathname);
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                          active
                            ? 'bg-secondary text-secondary-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
                        )}
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
        </>,
        document.body,
      )}
    </>
  );
}
