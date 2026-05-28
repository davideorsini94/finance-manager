import { useEffect, useState } from 'react';
import { Filter } from 'lucide-react';

export function OnlyMineToggle() {
  const [v, setV] = useState<boolean>(() => localStorage.getItem('only_mine') === '1');
  useEffect(() => {
    localStorage.setItem('only_mine', v ? '1' : '0');
    window.dispatchEvent(new CustomEvent('only-mine-changed', { detail: v }));
  }, [v]);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs">
      <Filter className="h-3.5 w-3.5 text-muted-foreground" />
      <input type="checkbox" checked={v} onChange={(e) => setV(e.target.checked)} className="h-3.5 w-3.5" />
      <span>Solo i miei movimenti</span>
    </label>
  );
}

export function useOnlyMineFilter(): boolean {
  const [v, setV] = useState<boolean>(() => localStorage.getItem('only_mine') === '1');
  useEffect(() => {
    const h = (e: Event) => setV((e as CustomEvent<boolean>).detail);
    window.addEventListener('only-mine-changed', h);
    return () => window.removeEventListener('only-mine-changed', h);
  }, []);
  return v;
}
