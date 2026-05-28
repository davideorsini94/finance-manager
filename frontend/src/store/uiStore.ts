import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Theme = ThemeMode;
export type ColorTheme = 'glass' | 'fintech' | 'linear' | 'nordic' | 'sunset';
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
      colorTheme: 'glass',
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
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        const base = (persisted ?? {}) as Partial<UIState>;
        if (version < 2) {
          return {
            theme: base.theme ?? 'system',
            colorTheme: 'glass',
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
        if (!base.sectionsCollapsed) base.sectionsCollapsed = {};
        return base;
      },
    },
  ),
);

export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
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
}
