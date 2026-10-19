import { useEffect, useRef, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useScrollStore } from '@/store/scrollStore';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';
import { PWAInstallPrompt } from '@/components/shared/PWAInstallPrompt';
import { NotificationsProvider } from '@/features/notifications/NotificationsProvider';
import { OnlineIndicator } from '@/components/shared/OnlineIndicator';
import { ConfirmProvider } from '@/components/shared/confirm';
import { DemoBanner } from '@/components/shared/DemoBanner';
import { SWUpdateBanner } from '@/components/shared/SWUpdateBanner';
import { TransactionForm } from '@/features/transactions/TransactionForm';
import { useQuickAdd } from '@/store/quickAddStore';

function GlobalQuickAdd() {
  const open = useQuickAdd((s) => s.open);
  const setOpen = useQuickAdd((s) => s.set);
  const defaultAccountId = useQuickAdd((s) => s.defaultAccountId);
  return <TransactionForm open={open} onOpenChange={setOpen} defaultAccountId={defaultAccountId} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  const updateScroll = useScrollStore((s) => s.update);
  const resetScroll = useScrollStore((s) => s.reset);
  const { location } = useRouterState();

  // Lo scroll vive dentro <main>: le barre di vetro leggono da qui se il
  // contenuto è passato sotto di loro e in che verso si sta scorrendo.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => updateScroll(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [updateScroll]);

  // Cambio pagina: barre di nuovo intere e senza scroll edge.
  useEffect(() => {
    resetScroll();
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname, resetScroll]);

  return (
    <NotificationsProvider>
      <ConfirmProvider>
        {/* Background decorativo — blob animati per Glass, grid per Fintech, vuoto altrove */}
        <div className="fm-bg-decor" aria-hidden>
          <div className="fm-blob-3" />
        </div>
        <div
          className="fm-shell relative z-[1] flex h-dvh w-full bg-background text-foreground"
          style={{
            paddingLeft: 'var(--safe-left)',
            paddingRight: 'var(--safe-right)',
          }}
        >
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            {/* La TopBar sta DENTRO lo scroller (sticky): così il contenuto le
                scorre sotto e il vetro ha qualcosa da sfocare. Fuori, sarebbe
                stata una striscia opaca qualunque. */}
            <main
              ref={mainRef}
              className="flex-1 scroll-pt-[calc(var(--safe-top)+4rem)] overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-0"
            >
              <TopBar />
              <DemoBanner />
              <OnlineIndicator />
              <div className="mx-auto w-full max-w-7xl px-4 py-5 lg:px-8 lg:py-7">{children}</div>
            </main>
            <BottomNav />
          </div>
          <PWAInstallPrompt />
          <GlobalQuickAdd />
          <SWUpdateBanner />
        </div>
      </ConfirmProvider>
    </NotificationsProvider>
  );
}
