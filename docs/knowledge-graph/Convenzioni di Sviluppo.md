# Convenzioni di Sviluppo

Regole e pattern ricorrenti del progetto. Contesto generale in [[Architettura]].

## Lingua e stile

- **UI e commenti in italiano**; identificatori di codice in inglese; i18n IT/EN via i18next
- Commenti che spiegano il *perché* (vincoli, decisioni), non il *cosa*

## Frontend

- Una cartella per feature in `src/features/` con pagina + client API dedicato (`<dominio>Api.ts`)
- Server-state con React Query: dopo le mutazioni invalidare TUTTE le query correlate con `refetchType: 'all'` (dashboard, accounts, budgets, goals…)
- UI-state minimale con Zustand (`uiStore`, `quickAddStore`)
- Form: React Hook Form + Zod
- Componenti UI da shadcn/ui in `components/ui/`; icone lucide-react (pool in `components/shared/icon-pool.tsx`)
- Importi in centesimi ovunque, formattazione con `formatCents` → [[Database]]
- Mobile-first, breakpoint `lg` per desktop; attenzione ai vincoli iOS → [[PWA e Mobile]]
- Modalità demo: handler mock in `src/lib/demo/` — le nuove API vanno replicate lì se devono funzionare in demo
- Popover dentro un Dialog Radix: usare `disablePortal` su `PopoverContent` (`components/ui/popover.tsx`) — altrimenti `react-remove-scroll` del Dialog blocca il touch-scroll sui contenuti portati fuori dal suo sottoalbero. Pattern usato da `CategoryPicker`, `IconPicker`, `ColorPicker` (`components/shared/`) → [[PWA e Mobile]]

## Backend

- Un modulo NestJS per dominio; ACL sempre via `AccountPolicyService`; audit su modifiche transazioni
- DTO validati; throttling per endpoint sensibili → [[Autenticazione e Sicurezza]]

## Manutenzione del grafo di conoscenza

Questo vault (`docs/knowledge-graph/`) va **consultato all'inizio di ogni richiesta** e **aggiornato dopo ogni modifica** al progetto: aggiorna le note toccate e aggiungi una riga in [[Registro Modifiche]]. Regola codificata anche in `CLAUDE.md` alla root.
