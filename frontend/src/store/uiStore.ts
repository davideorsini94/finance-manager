import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Theme = ThemeMode;
export type ColorTheme = 'registro' | 'glass' | 'fintech' | 'linear' | 'nordic' | 'sunset';
export type NumFont = 'sans' | 'mono' | 'serif';

interface UIState {
  theme: ThemeMode;
  colorTheme: ColorTheme;
  numFont: NumFont;
  privacy: boolean;
  demoData: boolean;
  sidebarCollapsed: boolean;
  /** Sezioni della sidebar collassate. Chiave = labelKey della sezione. */
  sectionsCollapsed: Record<string, boolean>;

  setTheme: (theme: ThemeMode) => void;
  setColorTheme: (t: ColorTheme) => void;
  setNumFont: (f: NumFont) => void;
  setPrivacy: (v: boolean) => void;
  togglePrivacy: () => void;
  setDemoData: (v: boolean) => void;
  toggleDemoData: () => void;
  toggleSidebar: () => void;
  toggleSection: (labelKey: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'system',
      colorTheme: 'registro',
      numFont: 'sans',
      privacy: false,
      demoData: false,
      sidebarCollapsed: false,
      sectionsCollapsed: {},
      setTheme: (theme) => set({ theme }),
      setColorTheme: (colorTheme) => set({ colorTheme }),
      setNumFont: (numFont) => set({ numFont }),
      setPrivacy: (privacy) => set({ privacy }),
      togglePrivacy: () => set((s) => ({ privacy: !s.privacy })),
      setDemoData: (demoData) => set({ demoData }),
      toggleDemoData: () => set((s) => ({ demoData: !s.demoData })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleSection: (labelKey) =>
        set((s) => ({
          sectionsCollapsed: { ...s.sectionsCollapsed, [labelKey]: !s.sectionsCollapsed[labelKey] },
        })),
    }),
    {
      name: 'fm.ui',
      version: 4,
      migrate: (persisted: unknown, version: number) => {
        const base = (persisted ?? {}) as Partial<UIState>;
        if (version < 2) {
          return {
            theme: base.theme ?? 'system',
            colorTheme: 'registro',
            numFont: 'sans',
            privacy: false,
            demoData: false,
            sidebarCollapsed: base.sidebarCollapsed ?? false,
            sectionsCollapsed: {},
          } as Partial<UIState>;
        }
        if (version < 3) {
          // v2 → v3: i temi 'linear'/'nordic'/'sunset' restano supportati
          // ma gli utenti esistenti vengono migrati a 'glass' come nuovo default
          // se erano sul vecchio default 'linear'.
          if (base.colorTheme === 'linear') base.colorTheme = 'glass';
        }
        if (version < 4) {
          // v3 → v4: 'registro' diventa l'identità del prodotto. Chi era sul
          // vecchio default 'glass' ci passa; chi aveva scelto esplicitamente
          // un altro tema resta dov'è.
          if (base.colorTheme === 'glass') base.colorTheme = 'registro';
        }
        if (!base.sectionsCollapsed) base.sectionsCollapsed = {};
        return base;
      },
    },
  ),
);

/**
 * Il meta `theme-color` (barra di stato iOS/Android) è statico in
 * `index.html`. Lo teniamo allineato a `--background` (variabile CSS che
 * dipende da dark/light E da colorTheme, vedi index.css) rileggendola dal
 * computed style dopo ogni mutazione di classe/data-attribute su <html>.
 */
function syncThemeColorMeta(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  if (!bg) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', `hsl(${bg})`);
}

export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  syncThemeColorMeta();
}

export function applyUIChrome(state: {
  colorTheme: ColorTheme;
  numFont: NumFont;
  privacy: boolean;
}): void {
  const root = document.documentElement;
  root.dataset.theme = state.colorTheme;
  root.dataset.numFont = state.numFont;
  root.dataset.privacy = state.privacy ? 'on' : 'off';
  syncThemeColorMeta();
}
