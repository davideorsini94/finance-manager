# Pagina Report

Route `/reports` — file `frontend/src/features/reports/ReportsPage.tsx` (la pagina `/reports/advanced` è separata). Usa il client API `features/dashboard/dashboardApi.ts`. Vedi [[Frontend]] per il contesto.

## Tre modalità (Select in alto) + filtro conti

1. **Riepilogo annuale** (`GET reports/annual`): card KPI, bar chart dei 12 mesi, card **Top categorie**
2. **Riepilogo mensile** (`GET reports/monthly`): card KPI, bar chart giornaliero, card **Top categorie**
3. **Confronto periodi** (`GET reports/compare`): due colonne con totali + torta per categoria, più la card "Delta totali"

## Comportamenti chiave

- **Card KPI come selettore del flusso (2026-08-17)**: come sulla [[Pagina Dashboard]], click su **Entrate**/**Uscite** cambia il verso degli aggregati per categoria. Nell'annuale e nel mensile cambia la card **Top categorie** (titolo "Top categorie · uscite/entrate" e albero mostrato); nel confronto periodi i **totali Entrate/Uscite sono cliccabili** (lì non ci sono card KPI grandi) e cambiano la torta di **entrambe** le colonne, così il confronto resta omogeneo. Default uscite; Netto non cliccabile. Nessun refetch: annual/monthly restituiscono `byCategoryTree` + `byCategoryTreeIncome`, compare `categories` + `categoriesIncome`.
- **Drill-down**: `CategoryTree` → `CategoryRow` espande padre → sottocategorie → singoli movimenti (`GET transactions`). Il `DrillContext` porta periodo, conti **e flusso**: il `type` della query segue il flusso e il `queryKey` lo include (altrimenti uscite ed entrate della stessa categoria condividerebbero la cache). Anche i testi ("Caricamento spese/entrate…", "Nessuna spesa/entrata.") seguono il flusso.
- **Vocabolario condiviso col dashboard**: tipo `Flow`, etichette `FLOW_UI`, props di selezione `flowSelectProps()` e hint `FlowHint` stanno in `frontend/src/features/dashboard/flow.tsx`; lo scroll assistito su mobile è `revealIfOffscreen()` in `frontend/src/lib/utils/reveal.ts`.
- **Nodo "Senza categoria"** senza figli non è drillabile (non è filtrabile per categoria nulla).
- **Modalità demo (v0.8.1)**: l'handler demo di `transactions` rispetta `categoryIds[]`, `accountIds[]` e `type` (prima solo i singolari, quindi il drill-down mostrava movimenti sbagliati) e `reports/compare` ha finalmente un handler — vedi [[Registro Modifiche]].

## Backend

`ReportsController` (`backend/src/reports/reports.controller.ts`) compone i metodi di `ReportsService`: `periodTotals`, `monthlyAggregates`, `categoryBreakdown` e `categoryBreakdownTree` — questi ultimi due prendono un `flow: 'expense' | 'income'` (default `expense`) e vengono chiamati due volte per servire entrambe le viste. Dettagli in [[API]].

## Collegamenti

- [[Pagina Dashboard]] — stessa interazione sulle card KPI
- [[Database]] — importi in centesimi, `BigInt` come stringa
