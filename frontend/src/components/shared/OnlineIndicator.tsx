import { useOnlineStatus } from '@/lib/pwa';
import { WifiOff } from 'lucide-react';

export function OnlineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white">
      <span className="inline-flex items-center gap-1.5">
        <WifiOff className="h-3.5 w-3.5" /> Sei offline — le modifiche verranno sincronizzate quando torni online
      </span>
    </div>
  );
}
