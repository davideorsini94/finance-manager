import { create } from 'zustand';

/**
 * Stato di scorrimento del `<main>` dell'AppShell, letto dalle barre di vetro:
 * - `scrolled`: il contenuto è passato sotto la TopBar → compare lo scroll edge
 * - `titleShown`: il titolo grande della pagina è uscito → il titolo va nella barra
 * - `compact`: si sta scorrendo in giù → la tab bar si riduce alla voce attiva
 *   (come `tabBarMinimizeBehavior(.onScrollDown)` di iOS 26); torna intera
 *   appena si scorre in su.
 */
interface ScrollState {
  scrolled: boolean;
  titleShown: boolean;
  compact: boolean;
  update: (top: number) => void;
  reset: () => void;
}

let lastTop = 0;

export const useScrollStore = create<ScrollState>()((set, get) => ({
  scrolled: false,
  titleShown: false,
  compact: false,
  update: (top) => {
    const delta = top - lastTop;
    const s = get();
    const next = {
      scrolled: top > 8,
      titleShown: top > 56,
      // Soglia di 6px: il rimbalzo elastico di iOS non deve far ballare la barra.
      compact: Math.abs(delta) < 6 ? s.compact : delta > 0 && top > 80,
    };
    if (Math.abs(delta) >= 6) lastTop = top;
    if (next.scrolled !== s.scrolled || next.titleShown !== s.titleShown || next.compact !== s.compact) {
      set(next);
    }
  },
  reset: () => {
    lastTop = 0;
    set({ scrolled: false, titleShown: false, compact: false });
  },
}));
