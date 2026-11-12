import { FlaskConical, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/store/uiStore';

/**
 * Avviso "dati demo": una pillola di vetro sotto la barra in alto invece della
 * striscia gialla a tutta larghezza. Toccando "Esci" si torna ai dati reali.
 */
export function DemoBanner() {
  const demoData = useUIStore((s) => s.demoData);
  const setDemoData = useUIStore((s) => s.setDemoData);
  const queryClient = useQueryClient();

  if (!demoData) return null;

  const exit = () => {
    setDemoData(false);
    void queryClient.invalidateQueries();
    void queryClient.removeQueries();
  };

  return (
    <div className="flex justify-center px-4 pt-1">
      <div
        role="status"
        className="fm-material inline-flex items-center gap-2 rounded-full border py-1 pl-3 pr-1 text-xs font-medium text-[hsl(var(--warn))]"
      >
        <FlaskConical className="h-3.5 w-3.5" aria-hidden />
        <span>
          Dati demo<span className="hidden sm:inline">: le modifiche non vengono salvate</span>
        </span>
        <button
          type="button"
          onClick={exit}
          className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2.5 py-1 font-semibold text-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3 w-3" aria-hidden /> Esci
        </button>
      </div>
    </div>
  );
}
