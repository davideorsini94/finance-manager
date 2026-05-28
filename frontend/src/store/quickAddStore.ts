import { create } from 'zustand';

/**
 * Stato globale per l'apertura della modale "Nuovo movimento" da
 * componenti remoti (es. il FAB della BottomNav, oppure shortcut PWA
 * `/quick-add`). La modale stessa vive in `AppShell` e si apre quando
 * `open === true`.
 */
interface QuickAddState {
  open: boolean;
  show: () => void;
  hide: () => void;
  set: (open: boolean) => void;
}

export const useQuickAdd = create<QuickAddState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  set: (open) => set({ open }),
}));
