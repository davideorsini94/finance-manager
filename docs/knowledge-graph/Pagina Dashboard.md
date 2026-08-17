# Pagina Dashboard

Route `/` — file `frontend/src/features/dashboard/DashboardPage.tsx`, client API `dashboardApi.ts`, grafici in `features/dashboard/charts/`. Prima schermata dopo il login. Vedi [[Frontend]] per il contesto.

## Struttura

1. **Filtri in alto**: conti (`AccountMultiSelect`), categorie padre (`CategoryMultiSelect`), preset 7g/30g/90g/YTD e date da/a — stato locale, un'unica query `GET reports/dashboard` con quei parametri
2. **Tre card KPI**: Entrate, Uscite, Netto (componente locale `KpiCard`, con `AnimatedNumber` e `SparkLine`)
3. **Andamento patrimonio** (`BalanceArea`) e **card "per categoria"** (`CategoryPieChart` + legenda con importi)
4. **Entrate vs uscite** per giornata (`IncomeExpenseBar`) e **Ultime operazioni** (10 movimenti)

## Comportamenti chiave

- **Card KPI come selettore del flusso (2026-08-17)**: click su **Entrate** o **Uscite** cambia cosa mostra la card "per categoria" (titolo, torta e lista): entrate oppure uscite. Default **uscite** (vista storica). Le due card sono `role="button"` + `aria-pressed` con ring colorato sulla selezionata e un micro-hint testuale ("· vedi dettaglio" / "· in dettaglio"); la card **Netto** non è cliccabile. Nessun refetch al click: il backend manda entrambi gli alberi nella stessa risposta.
- **Contestualizzazione ai filtri**: entrambi gli alberi sono calcolati con gli stessi filtri di conti, periodo e categorie (le categorie padre selezionate vengono espanse ai figli lato backend), quindi cambiare vista non "sfugge" ai filtri.
- **Toggle Padre / Sottocategorie**: appiattisce l'albero scelto — un nodo per categoria padre oppure uno per sottocategoria (etichetta "Padre · Figlio"); vale per entrambi i flussi (`buildCategoryBreakdown`).
- **Scroll assistito su mobile**: su iPhone la card del dettaglio sta sotto la piega, quindi al click su una KPI la pagina la porta in vista, ma **solo se non è già (quasi) visibile** — altrimenti il click sembrerebbe non fare nulla. Lo scroll avviene dentro `<main>` (vedi [[PWA e Mobile]]).
- **Dati sempre freschi**: `staleTime: 0` + `refetchOnMount: 'always'` sulla query, perché totali e saldo cambiano dopo ogni movimento/giroconto.

## Backend

`ReportsService.dashboard()` (`backend/src/reports/reports.service.ts`) ritorna in un solo `Promise.all`: `totals`, `byCategory` (piatto, uscite), `byCategoryTree` (uscite), `byCategoryTreeIncome` (entrate), `daily`, `recent`. I due alberi vengono dallo stesso `categoryBreakdownTree(..., flow)` — `flow` sceglie `type` (`expense`/`income`) e il segno da normalizzare (le uscite sono negative a DB). Dettagli endpoint in [[API]].

## Collegamenti

- [[Pagina Movimenti]] — stesso pattern "card cliccabile come filtro/selettore"
- [[Database]] — importi in centesimi, `BigInt` serializzati come stringa
