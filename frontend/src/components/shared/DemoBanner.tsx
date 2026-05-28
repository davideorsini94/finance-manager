import { FlaskConical, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/store/uiStore';

/**
 * Banner sticky che mostra "Modalità demo attiva". Cliccando "Esci" si
 * disattiva la modalità e si invalidano le query (refetch dati reali).
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
    <div className="flex items-center justify-between gap-3 border-b bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
      <span className="inline-flex items-center gap-1.5">
        <FlaskConical className="h-3.5 w-3.5" />
        Modalità demo attiva — i dati mostrati sono fittizi e nessuna modifica viene salvata.
      </span>
      <button
        type="button"
        onClick={exit}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-amber-200/60 dark:hover:bg-amber-900/40"
      >
        <X className="h-3 w-3" /> Esci
      </button>
    </div>
  );
}
