import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { NAV_ITEMS } from './nav-items';

/**
 * Pill di ricerca nella TopBar. Apre un dialog k-bar minimale che cerca
 * nei link di navigazione. Estendibile in futuro per cercare anche
 * transazioni/conti.
 */
export function CommandSearch() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    return NAV_ITEMS.filter((i) =>
      term.length === 0 ? true : t(i.labelKey).toLowerCase().includes(term),
    );
  }, [q, t]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border bg-background/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">{t('common.search')}…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium md:inline-block">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.search')}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">Esc</kbd>
          </div>
          <ul className="max-h-80 overflow-y-auto p-1.5">
            {matches.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nessun risultato
              </li>
            ) : (
              matches.map((m) => {
                const Icon = m.icon;
                return (
                  <li key={m.to}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setQ('');
                        void navigate({ to: m.to });
                      }}
                      className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span>{t(m.labelKey)}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
