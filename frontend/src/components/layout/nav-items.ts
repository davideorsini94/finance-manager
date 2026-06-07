import {
  LayoutDashboard,
  Wallet,
  Receipt,
  Tags,
  PieChart,
  TrendingUp,
  LineChart,
  Target,
  Repeat,
  FileUp,
  FileText,
  Sparkles,
  MessageSquare,
  Settings,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** mostra in BottomNav mobile */
  primary: boolean;
}

export interface NavSection {
  /** chiave i18n (es. 'nav.section.overview') */
  labelKey: string;
  items: NavItem[];
}

/** Lista piatta — usata da BottomNav e dalle ricerche */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, primary: true },
  { to: '/accounts', labelKey: 'nav.accounts', icon: Wallet, primary: true },
  { to: '/transactions', labelKey: 'nav.transactions', icon: Receipt, primary: true },
  { to: '/reports', labelKey: 'nav.reports', icon: PieChart, primary: true },
  { to: '/reports/advanced', labelKey: 'nav.reportsAdvanced', icon: TrendingUp, primary: false },
  { to: '/projections', labelKey: 'nav.projections', icon: LineChart, primary: false },
  { to: '/chat', labelKey: 'nav.chat', icon: MessageSquare, primary: true },
  { to: '/categories', labelKey: 'nav.categories', icon: Tags, primary: false },
  { to: '/budget', labelKey: 'nav.budget', icon: Target, primary: false },
  { to: '/recurring', labelKey: 'nav.recurring', icon: Repeat, primary: false },
  { to: '/goals', labelKey: 'nav.goals', icon: Trophy, primary: false },
  { to: '/import', labelKey: 'nav.import', icon: FileUp, primary: false },
  { to: '/import/wizard', labelKey: 'nav.importWizard', icon: Sparkles, primary: false },
  { to: '/import/templates', labelKey: 'nav.importTemplates', icon: FileText, primary: false },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings, primary: false },
];

/** Raggruppata per Sidebar */
export const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'nav.section.overview',
    items: [
      { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, primary: true },
      { to: '/reports', labelKey: 'nav.reports', icon: PieChart, primary: true },
      { to: '/reports/advanced', labelKey: 'nav.reportsAdvanced', icon: TrendingUp, primary: false },
      { to: '/projections', labelKey: 'nav.projections', icon: LineChart, primary: false },
    ],
  },
  {
    labelKey: 'nav.section.finance',
    items: [
      { to: '/accounts', labelKey: 'nav.accounts', icon: Wallet, primary: true },
      { to: '/transactions', labelKey: 'nav.transactions', icon: Receipt, primary: true },
      { to: '/categories', labelKey: 'nav.categories', icon: Tags, primary: false },
    ],
  },
  {
    labelKey: 'nav.section.planning',
    items: [
      { to: '/budget', labelKey: 'nav.budget', icon: Target, primary: false },
      { to: '/recurring', labelKey: 'nav.recurring', icon: Repeat, primary: false },
      { to: '/goals', labelKey: 'nav.goals', icon: Trophy, primary: false },
    ],
  },
  {
    labelKey: 'nav.section.tools',
    items: [
      { to: '/chat', labelKey: 'nav.chat', icon: MessageSquare, primary: true },
      { to: '/import', labelKey: 'nav.import', icon: FileUp, primary: false },
      { to: '/import/wizard', labelKey: 'nav.importWizard', icon: Sparkles, primary: false },
      { to: '/import/templates', labelKey: 'nav.importTemplates', icon: FileText, primary: false },
    ],
  },
  {
    labelKey: 'nav.section.system',
    items: [
      { to: '/settings', labelKey: 'nav.settings', icon: Settings, primary: false },
    ],
  },
];

// Tutti i prefissi noti, ordinati dal più lungo al più corto: serve a
// risolvere il "match più specifico" ed evitare che voci genitore come
// `/reports` restino accese quando siamo su `/reports/advanced`.
const NAV_PATHS_BY_SPECIFICITY = [...new Set(NAV_ITEMS.map((i) => i.to))].sort(
  (a, b) => b.length - a.length,
);

/**
 * Una voce di navigazione è attiva quando il suo `to` è il **prefisso più
 * specifico** del path corrente. Esempi:
 *   pathname=/reports/advanced → solo `/reports/advanced` è attivo
 *   pathname=/reports          → solo `/reports` è attivo
 *   pathname=/                 → solo `/` è attivo (root non fa match parziale)
 */
export function isNavItemActive(itemPath: string, pathname: string): boolean {
  if (itemPath === '/') return pathname === '/';
  const match = NAV_PATHS_BY_SPECIFICITY.find(
    (p) => p !== '/' && (pathname === p || pathname.startsWith(`${p}/`)),
  );
  return match === itemPath;
}
