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
- **Operazioni distruttive: sempre `useConfirm()`** (`components/shared/confirm.tsx`, provider montato in `AppShell`; `destructive: true` per le azioni che cancellano). Vale per tutto ciò che non è annullabile dalla UI o che tocca i saldi: eliminazioni, azioni massive su selezioni multiple, generazioni in blocco di movimenti (import, ricorrenze), sovrascritture di saldo. Nel progetto **non si usa il `window.confirm()` nativo**. La modale deve dire **quante** righe tocca e **se** l'operazione è reversibile (l'utente ha confermato per errore 73 movimenti bancari, recuperati solo con un ripristino SQL). Audit completo delle 48 operazioni sensibili: voce del 2026-08-16 in [[Registro Modifiche]] (tutte quelle a rischio alto/medio sono coperte da v0.6.0). **Attenzione alle rotte pubbliche** (`/accounts/invite/accept`, `/bank-sync/callback`, login, reset password): stanno **fuori da `AppShell`**, quindi il `ConfirmProvider` non c'è e `useConfirm()` lancia — lì si monta `<ConfirmDialog>` a mano con uno stato locale.
- **Ogni importo a schermo passa da `MoneyAmount`** (`components/shared/MoneyAmount.tsx`): `formatCents` solo dove serve una stringa (formatter Recharts, testo di una modale) → [[Design System]]
- **Entrate/uscite si colorano con `hsl(var(--pos))` / `hsl(var(--neg))`, mai con `emerald-*`/`red-*`**: i colori fissi di Tailwind ignorano il tema → [[Design System]]
- **Pannello ancorato a un bottone: su mobile agganciarlo al viewport, non all'ancora.** `absolute right-0` + `max-w-[calc(100vw-2rem)]` sembra sicuro ma non lo è: il `max-w` misura il viewport, il `right-0` misura il **bottone**, e se il bottone non è a filo schermo il pannello sborda dal lato opposto (notifiche su 390px: `left: -28px`). Pattern: `fixed inset-x-2 top-14` sotto `sm`, ancorato da `sm` in su (`NotificationBell.tsx`).
- **In un Dialog flex, l'elemento che deve cedere ha bisogno di `min-h-0`.** Il default `min-height: auto` impedisce a un flex item di scendere sotto l'altezza del contenuto: il Dialog sfora il viewport e il footer diventa irraggiungibile — sembra "la modale non scrolla", ma in realtà scrolla e basta che il dito cada sulla lista interna per non accorgersene. Serve `min-h-0` sugli **antenati** che devono restringersi, mentre la lista tiene `max-h-*` (altezza preferita) e `min-h-*` (pavimento). Niente `flex-1` sulla lista: la farebbe partire da zero e su schermi alti resterebbe compressa. Caso reale: `CategoryPicker` inline dentro il `CategoryDialog` della coda di revisione.
- **Evidenziare una card selezionata: `outline`, mai `ring`.** Il `ring` di Tailwind è un `box-shadow` e nel tema glass (default) `fm-glass` lo sovrascrive → l'anello sparisce. Pattern: `outline outline-2 outline-offset-2 outline-<colore>` (card conto della [[Pagina Movimenti]], card KPI di [[Pagina Dashboard]] e [[Pagina Report]] — dove l'errore è stato rifatto e corretto in v0.8.2).
- Popover dentro un Dialog Radix: usare `disablePortal` su `PopoverContent` (`components/ui/popover.tsx`) — altrimenti `react-remove-scroll` del Dialog blocca il touch-scroll sui contenuti portati fuori dal suo sottoalbero. Pattern usato da `CategoryPicker`, `IconPicker`, `ColorPicker` (`components/shared/`) → [[PWA e Mobile]]. **Limite**: in un Dialog piccolo il popover inline viene tagliato dall'`overflow-y-auto` di default del `DialogContent` (peggio ancora su mobile a tastiera aperta). In quei casi niente popover: `CategoryPicker` ha la prop `inline` (ricerca+lista nel flusso del Dialog, che va reso `flex flex-col`; la lista si adatta con `min-h-28`/`max-h-72`) — usata dal `CategoryDialog` della coda di revisione. **Anche `ColorPicker` ha `inline`** (dal 2026-08-31) ed è così che va usato dentro `CategoryForm` e `AccountForm`: il popover era già tagliato dall'overflow del Dialog (si perdevano le prime righe di colori senza che si notasse) e con la palette del tema in cima spariva la sezione più importante. Sintomo diagnostico da ricordare: `getBoundingClientRect()` del popover dice che è in posizione, ma a schermo la parte alta non c'è — il rect **ignora il clipping degli antenati**, quindi va cercato chi ha `overflow` diverso da `visible` risalendo la catena.

## Backend

- Un modulo NestJS per dominio; ACL sempre via `AccountPolicyService`; audit su modifiche transazioni
- DTO validati; throttling per endpoint sensibili → [[Autenticazione e Sicurezza]]

## Manutenzione del grafo di conoscenza

Questo vault (`docs/knowledge-graph/`) va **consultato all'inizio di ogni richiesta** e **aggiornato dopo ogni modifica** al progetto: aggiorna le note toccate e aggiungi una riga in [[Registro Modifiche]]. Regola codificata anche in `CLAUDE.md` alla root.
