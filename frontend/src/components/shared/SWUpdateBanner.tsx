import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { Button } from '@/components/ui/button';

/**
 * Banner che appare quando vite-plugin-pwa segnala una nuova versione del
 * SW disponibile. In modalità `registerType: 'prompt'` l'aggiornamento
 * NON è automatico: il SW resta in waiting finché chiamiamo `updateSW(true)`
 * (skipWaiting + reload pagina). Così non vediamo più la modale "vuota
 * con caricamento" causata da skipWaiting+clientsClaim mid-flight.
 */
export function SWUpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    const fn = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        // primo install: niente banner, l'app è pronta offline.
      },
    });
    setUpdateSW(() => fn);
  }, []);

  if (!needRefresh) return null;

  const apply = async () => {
    if (!updateSW) {
      window.location.reload();
      return;
    }
    // updateSW(true) → SKIP_WAITING + reload una volta che il nuovo SW
    // prende il controllo.
    await updateSW(true);
  };

  return (
    <div className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg lg:bottom-4">
      <span className="inline-flex items-center gap-2 text-sm">
        <RefreshCw className="h-4 w-4" />
        Nuova versione disponibile
      </span>
      <Button size="sm" onClick={apply}>
        Aggiorna ora
      </Button>
    </div>
  );
}
