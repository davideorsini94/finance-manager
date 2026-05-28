import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'fm.pwa.dismissed';

export function usePWAInstall(): {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
  dismiss: () => void;
} {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() =>
    typeof window !== 'undefined' && localStorage.getItem(DISMISSED_KEY) === '1',
  );

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const canInstall = !!evt && !dismissed;

  return {
    canInstall,
    async promptInstall() {
      if (!evt) return;
      await evt.prompt();
      const choice = await evt.userChoice;
      setEvt(null);
      if (choice.outcome === 'dismissed') {
        localStorage.setItem(DISMISSED_KEY, '1');
        setDismissed(true);
      }
    },
    dismiss() {
      localStorage.setItem(DISMISSED_KEY, '1');
      setDismissed(true);
    },
  };
}
