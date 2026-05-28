// SOSTITUISCE: frontend/src/app/providers.tsx
// Estende il bootstrap del tema esistente per applicare anche colorTheme,
// numFont e privacy mode allo <html> tramite data-attributes.

import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { queryClient } from '@/lib/api/queryClient';
import { router } from './router';
import { setUnauthorizedHandler } from '@/lib/api/client';
import { useAuth } from '@/features/auth/useAuth';
import { applyTheme, applyUIChrome, useUIStore } from '@/store/uiStore';
import '@/lib/i18n';

function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  const setUnauthenticated = useAuth((s) => s.setUnauthenticated);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUnauthenticated();
      // Non redirigere a /login se l'utente è già su una rotta pubblica di
      // onboarding/auth: il 401 lì è atteso (il bootstrap fa fetchMe per
      // forza ma l'utente non è ancora loggato). Senza questa guardia
      // l'invitato viene buttato fuori prima di poter impostare la password.
      const path = window.location.pathname;
      const PUBLIC_PATHS = [
        '/login',
        '/accept-invite',
        '/accounts/invite/accept',
        '/reset-password',
      ];
      if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
        return;
      }
      router.navigate({ to: '/login' });
    });
    return () => setUnauthorizedHandler(null);
  }, [setUnauthenticated]);

  if (status === 'unknown') {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Caricamento...
      </div>
    );
  }

  return <>{children}</>;
}

function ThemeBootstrap() {
  const theme = useUIStore((s) => s.theme);
  const colorTheme = useUIStore((s) => s.colorTheme);
  const numFont = useUIStore((s) => s.numFont);
  const privacy = useUIStore((s) => s.privacy);

  useEffect(() => {
    applyTheme(theme);
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(theme);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  useEffect(() => {
    applyUIChrome({ colorTheme, numFont, privacy });
  }, [colorTheme, numFont, privacy]);

  return null;
}

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeBootstrap />
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </QueryClientProvider>
  );
}
