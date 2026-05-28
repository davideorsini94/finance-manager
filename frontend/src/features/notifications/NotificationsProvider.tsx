import { createContext, useContext, type ReactNode } from 'react';
import { useNotifications } from './useNotifications';

type Ctx = ReturnType<typeof useNotifications>;
const NotificationsContext = createContext<Ctx | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotifications();
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotificationsCtx(): Ctx {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotificationsCtx must be used inside NotificationsProvider');
  return ctx;
}
