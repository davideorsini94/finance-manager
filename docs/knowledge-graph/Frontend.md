# Frontend

SPA React 19 + Vite + TypeScript in `frontend/`. UI Tailwind + shadcn/ui (Radix), routing TanStack Router, server-state TanStack Query, UI-state Zustand, grafici Recharts, form React Hook Form + Zod, i18n i18next (IT/EN), HTTP client ky.

## Struttura

- `frontend/src/app/router.tsx` — definizione route
- `frontend/src/features/<dominio>/` — una cartella per feature: pagina + `<dominio>Api.ts`
- `frontend/src/components/layout/` — AppShell, Sidebar (desktop), BottomNav (mobile), TopBar, CommandSearch (Cmd+K), NotificationBell, UserMenu
- `frontend/src/components/ui/` — primitive shadcn/ui (button, card, input, select, …)
- `frontend/src/store/` — store Zustand globali
- `frontend/src/lib/` — client API, utils, demo mode, PWA, fix piattaforma
- `frontend/src/index.css` — temi (CSS variables), utility `fm-*`, regole globali iOS (vedi [[PWA e Mobile]])

## Route principali

`/` [[Pagina Dashboard]] · `/accounts` Conti · `/categories` Categorie · `/transactions` [[Pagina Movimenti]] · `/budget` Budget · `/recurring` Ricorrenze · `/goals` Obiettivi · `/reports` (+ `/reports/advanced`) [[Pagina Report]] · `/projections` Proiezioni · `/chat` [[Chat LLM]] · `/import` (+ wizard, templates) [[Import CSV-OFX]] · `/settings` Impostazioni · `/login`, `/accept-invite`, `/reset-password` (pubbliche)

## Store globali (Zustand)

- `store/uiStore.ts` — tema, preferenze UI
- `store/quickAddStore.ts` — apertura della modale globale "Nuovo movimento" (usata dal FAB della BottomNav) **e** `defaultAccountId`: il conto da proporre in creazione, impostato dalla [[Pagina Movimenti]] quando è attivo un filtro per conto. La modale globale vive in `AppShell.tsx` (`GlobalQuickAdd`).

## Pattern

- Mutazioni → `queryClient.invalidateQueries` con `refetchType: 'all'` per aggiornare anche le query inattive (dashboard, budgets, goals…)
- Layout mobile-first, breakpoint `lg` per il layout desktop (Sidebar vs BottomNav)
- Temi multipli via `data-theme` (default / glass / fintech) con utility `fm-glass`, `fm-chrome`, blob animati
- Privacy mode: blur degli importi via `data-privacy='on'`
- Vedi anche [[Convenzioni di Sviluppo]] e [[PWA e Mobile]]
