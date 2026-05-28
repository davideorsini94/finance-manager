import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePWAInstall } from '@/hooks/usePWAInstall';

export function PWAInstallPrompt() {
  const { canInstall, promptInstall, dismiss } = usePWAInstall();
  if (!canInstall) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 lg:bottom-4 lg:left-auto lg:right-4 lg:translate-x-0">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2 shadow-lg">
        <Download className="h-4 w-4 text-primary" />
        <p className="text-sm">Installa Finance Manager come app</p>
        <Button size="sm" onClick={() => void promptInstall()}>
          Installa
        </Button>
        <Button size="icon" variant="ghost" onClick={dismiss} aria-label="Ignora">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
