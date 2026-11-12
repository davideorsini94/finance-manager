# Pagina Dashboard

Route `/` — file `frontend/src/features/dashboard/DashboardPage.tsx`, client API `dashboardApi.ts`, grafici in `features/dashboard/charts/`. Prima schermata dopo il login. Vedi [[Frontend]] per il contesto.

## Struttura

1. **Periodo e filtri** (v0.23.0): controllo segmentato 7g/30g/90g/Anno (`components/ui/segmented.tsx`) e sotto chip su una riga — conti (`AccountMultiSelect`), categorie padre (`CategoryMultiSelect`), intervallo (`DateRangeChip`, che azzera il preset). Stato locale, query `GET reports/dashboard`
2. **Riepilogo del periodo** (`components/shared/PeriodSummary.tsx`, condiviso con la [[Pagina Report]]): il **Netto** è il numero principale con la variazione sul periodo precedente della stessa durata (seconda query `reports/dashboard` su `previousRange`) e il netto progressivo come linea; Entrate e Uscite in due riquadri con barra di proporzione, cliccabili per il flusso
3. **Andamento patrimonio** (`BalanceArea`) e **card "per categoria"** (ciambella `CategoryPieChart` col totale al centro + legenda con quota e barra)
4. **Entrate vs uscite** per giornata (`IncomeExpenseBar`) e **Ultime operazioni** raggruppate per giorno con la stessa riga della [[Pagina Movimenti]] (`TxRowContent`) e il link "Vedi tutte"

## Comportamenti chiave

- **Riquadri Entrate/Uscite come selettore del flusso (2026-08-17, riquadri dalla v0.23.0)**: click su **Entrate** o **Uscite** cambia cosa mostra la card "per categoria" (titolo, torta e lista): entrate oppure uscite. Default **uscite** (vista storica). Le due card sono `role="button"` + `aria-pressed`, con **filetto colorato** sulla selezionata, senza fondo tinto dalla v0.23.0 (v0.8.2: il primo tentativo usava `ring-2`, invisibile nel tema glass perché `fm-glass` sovrascrive il `box-shadow` — stessa trappola già annotata per le card conto della [[Pagina Movimenti]]) e un micro-hint testuale ("· vedi dettaglio" / "· in dettaglio"); la card **Netto** non è cliccabile. Nessun refetch al click: il backend manda entrambi gli alberi nella stessa risposta.
- **Contestualizzazione ai filtri**: entrambi gli alberi sono calcolati con gli stessi filtri di conti, periodo e categorie (le categorie padre selezionate vengono espanse ai figli lato backend), quindi cambiare vista non "sfugge" ai filtri.
- **Toggle Padre / Sottocategorie**: appiattisce l'albero scelto — un nodo per categoria padre oppure uno per sottocategoria (etichetta "Padre · Figlio"); vale per entrambi i flussi (`buildCategoryBreakdown`).
- **Scroll assistito su mobile**: su iPhone la card del dettaglio sta sotto la piega, quindi al click su una KPI la pagina la porta in vista, ma **solo se non è già (quasi) visibile** — altrimenti il click sembrerebbe non fare nulla. Helper `revealIfOffscreen()` in `frontend/src/lib/utils/reveal.ts`; lo scroll avviene dentro `<main>` (vedi [[PWA e Mobile]]).
- **Vocabolario del flusso condiviso** con la [[Pagina Report]] (che ha la stessa interazione sulle sue card): tipo `Flow`, etichette `FLOW_UI`, props di selezione `flowSelectProps()` e hint `FlowHint` stanno in `frontend/src/features/dashboard/flow.tsx`.
- **Giroconti esclusi** (2026-10-28): totali, torte e grafico non contano le entrate/uscite con categoria "Giroconto" (stesso filtro della [[Pagina Report]]); il saldo cumulativo sì.
- **Grafici (v0.23.0)**: niente linee d'asse né tacche, date brevi ("13 ott", `shortDate`), importi compatti sull'asse Y, linea dello zero tratteggiata quando il saldo la attraversa, punto sull'ultimo valore, cursore a pillola scura (`charts/ChartTooltip.tsx`) che segue dito e mouse
- **Dati sempre freschi**: `staleTime: 0` + `refetchOnMount: 'always'` sulla query, perché totali e saldo cambiano dopo ogni movimento/giroconto.

## Backend

`ReportsService.dashboard()` (`backend/src/reports/reports.service.ts`) ritorna in un solo `Promise.all`: `totals`, `byCategory` (piatto, uscite), `byCategoryTree` (uscite), `byCategoryTreeIncome` (entrate), `daily`, `recent`. I due alberi vengono dallo stesso `categoryBreakdownTree(..., flow)` — `flow` sceglie `type` (`expense`/`income`) e il segno da normalizzare (le uscite sono negative a DB). Dettagli endpoint in [[API]].

## Collegamenti

- [[Pagina Movimenti]] — stesso pattern "card cliccabile come filtro/selettore"
- [[Database]] — importi in centesimi, `BigInt` serializzati come stringa
