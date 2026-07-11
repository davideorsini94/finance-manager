import { create } from 'zustand';

/**
 * Stato globale per l'apertura della modale "Nuovo movimento" da
 * componenti remoti (es. il FAB della BottomNav, oppure shortcut PWA
 * `/quick-add`). La modale stessa vive in `AppShell` e si apre quando
 * `open === true`.
 *
 * `defaultAccountId`: conto da proporre in creazione. Lo imposta la pagina
 * Movimenti quando è attivo un filtro per conto, così anche il quick-add
 * globale (FAB mobile) propone il conto filtrato come su desktop.
 */
interface QuickAddState {
  open: boolean;
  defaultAccountId: string | null;
  show: () => void;
  hide: () => void;
  set: (open: boolean) => void;
  setDefaultAccountId: (id: string | null) => void;
}

export const useQuickAdd = create<QuickAddState>((set) => ({
  open: false,
  defaultAccountId: null,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  set: (open) => set({ open }),
  setDefaultAccountId: (id) => set({ defaultAccountId: id }),
}));
