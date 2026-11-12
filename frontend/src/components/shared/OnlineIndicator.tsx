import { useOnlineStatus } from '@/lib/pwa';
import { WifiOff } from 'lucide-react';

/**
 * Pillola di vetro sotto la barra in alto quando manca la rete: non sposta la
 * pagina e non copre i pulsanti della barra.
 */
export function OnlineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ top: 'calc(var(--safe-top, 0px) + 3.9rem)' }}
    >
      <div className="fm-material inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-[hsl(var(--warn))]">
        <WifiOff className="h-3.5 w-3.5" aria-hidden /> Sei offline
        <span className="hidden sm:inline">: le modifiche partono al ritorno della rete</span>
      </div>
    </div>
  );
}
