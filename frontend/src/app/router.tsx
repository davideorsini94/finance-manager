import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { InviteAcceptPage } from '@/features/auth/InviteAcceptPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import { BudgetPage } from '@/features/budget/BudgetPage';
import { RecurringPage } from '@/features/recurring/RecurringPage';
import { GoalsPage } from '@/features/goals/GoalsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { AdvancedReports } from '@/features/reports/AdvancedReports';
import { ProjectionsPage } from '@/features/projections/ProjectionsPage';
import { ChatPage } from '@/features/chat/ChatPage';
import { ImportPage } from '@/features/import/ImportPage';
import { ImportWizard } from '@/features/import/ImportWizard';
import { ImportTemplatesPage } from '@/features/import/ImportTemplatesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { BankReviewPage } from '@/features/bank-review/BankReviewPage';
import { BankCallbackPage } from '@/features/settings/BankCallbackPage';
import { AcceptInvitePage } from '@/features/sharing/AcceptInvitePage';
import { useAuth } from '@/features/auth/useAuth';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accept-invite',
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: InviteAcceptPage,
});

const accountInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts/invite/accept',
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: AcceptInvitePage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});

// Ritorno dal consenso bancario: rotta PUBBLICA. Su iOS il redirect della
// banca atterra in Safari fuori dalla PWA, senza sessione autenticata.
const bankCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bank-sync/callback',
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' ? search.code : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: BankCallbackPage,
});

const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  beforeLoad: () => {
    const { status } = useAuth.getState();
    if (status === 'unauthenticated') throw redirect({ to: '/login' });
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const dashboardRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/',
  component: DashboardPage,
});

const accountsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/accounts',
  component: AccountsPage,
});

const categoriesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/categories',
  component: CategoriesPage,
});

const transactionsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/transactions',
  component: TransactionsPage,
});

const budgetRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/budget',
  component: BudgetPage,
});

const recurringRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/recurring',
  component: RecurringPage,
});

const goalsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/goals',
  component: GoalsPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/reports',
  component: ReportsPage,
});

const advancedReportsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/reports/advanced',
  component: AdvancedReports,
});

const projectionsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/projections',
  component: ProjectionsPage,
});

const chatRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/chat',
  component: ChatPage,
});

const importRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/import',
  component: ImportPage,
});

const importWizardRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/import/wizard',
  component: ImportWizard,
});

const importTemplatesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/import/templates',
  component: ImportTemplatesPage,
});

// Coda di revisione dei movimenti importati dalla banca (Fase 4).
const bankReviewRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/bank-review',
  component: BankReviewPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  inviteRoute,
  accountInviteRoute,
  resetPasswordRoute,
  bankCallbackRoute,
  protectedRoute.addChildren([
    dashboardRoute,
    accountsRoute,
    categoriesRoute,
    transactionsRoute,
    budgetRoute,
    recurringRoute,
    goalsRoute,
    reportsRoute,
    advancedReportsRoute,
    projectionsRoute,
    chatRoute,
    importRoute,
    importWizardRoute,
    importTemplatesRoute,
    bankReviewRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
