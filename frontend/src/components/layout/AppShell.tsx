import type { ReactNode } from 'react';
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
  return <TransactionForm open={open} onOpenChange={setOpen} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <ConfirmProvider>
        {/* Background decorativo — blob animati per Glass, grid per Fintech, vuoto altrove */}
        <div className="fm-bg-decor" aria-hidden>
          <div className="fm-blob-3" />
        </div>
        <div
          className="relative z-[1] flex h-dvh w-full bg-background text-foreground"
          style={{
            paddingLeft: 'var(--safe-left)',
            paddingRight: 'var(--safe-right)',
          }}
        >
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <DemoBanner />
            <OnlineIndicator />
            <main
              className="flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-0"
            >
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
