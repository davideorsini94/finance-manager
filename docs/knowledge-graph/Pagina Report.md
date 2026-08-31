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

## Report LLM (dal 2026-08-31)

Sotto le card KPI di **annuale** e **mensile** c'è la card "Report dell'assistente": un'analisi testuale del periodo scritta dal modello attivo in Impostazioni ([[Chat LLM]]).

- File: `frontend/src/features/reports/LlmReportCard.tsx` + `reportsLlmApi.ts`; backend `backend/src/llm-reports/` (modulo autonomo, vedi [[Backend]]); modello `LlmReport` in [[Database]]; endpoint in [[API]].
- **Salvato per periodo + conti selezionati** (`accountsKey` = `all` o sha1 degli id ordinati): tornando sullo stesso periodo il testo è già lì, nessuna nuova chiamata al modello.
- **Generazione automatica** alla prima apertura di un periodo che non ha ancora un report; **manuale** col pulsante Genera/Rigenera. La rigenerazione sovrascrive ed è irreversibile → modale `useConfirm()` con `destructive: true`.
- **Il lock sta a DB, non in memoria**: durante la generazione il pulsante è disabilitato anche uscendo e rientrando nella pagina, da qualunque dispositivo. La claim è un `updateMany` condizionale sulla riga unica; chi perde riceve 409 (assorbito dalla UI, che si mette in polling). Una riga `generating` più vecchia di 15 minuti è considerata morta e riclaimabile: è il caso del backend riavviato a metà.
- **Mentre genera**: skeleton pulsante + `Loader2` + cronometro ("Sto scrivendo il report… 1m 12s"); se un report precedente esiste resta visibile in trasparenza invece di lasciare il vuoto. Polling React Query a 3s **solo** in stato `generating`, più `refetchOnWindowFocus`.
- **Badge "dati cambiati"**: `dataFingerprint` (totali + numero movimenti alla generazione) confrontato a ogni lettura. Limite noto: una modifica che lascia i totali identici (es. il cambio di categoria di un movimento) non lo accende.
- **Markdown hardening condiviso con la chat**: `components/shared/markdown.tsx` (immagini rimosse, link resi testo inerte) — il report può citare causali bancarie, cioè testo di terzi → [[Autenticazione e Sicurezza]].
- **L'apertura del prompt è configurabile** in Impostazioni → Modello AI (campo "Prompt dei report di periodo", admin-only): decide taglio, tono e sezioni. Dati e regole di formato restano sempre → [[Chat LLM]]
- Il prompt riceve **solo aggregati** (totali, serie, alberi categorie, totali del periodo precedente) più i 15 movimenti di uscita più grandi, mai tutte le transazioni né gli id interni.
- **Chi ha scritto il report** è sempre in chiaro sotto al titolo ("Generato il … · OpenCode · deepseek-v4-flash"), con il marchio **(riserva)** quando ha risposto il modello locale al posto del provider configurato — il confronto usa `llmApi.get()`, senza colonne aggiuntive a DB. Regole del ripiego in [[Chat LLM]].
- Il "Confronto periodi" **non** ha report LLM (date arbitrarie: un report salvato non verrebbe quasi mai riusato).

## Backend

`ReportsController` (`backend/src/reports/reports.controller.ts`) compone i metodi di `ReportsService`: `periodTotals`, `monthlyAggregates`, `categoryBreakdown` e `categoryBreakdownTree` — questi ultimi due prendono un `flow: 'expense' | 'income'` (default `expense`) e vengono chiamati due volte per servire entrambe le viste. Dettagli in [[API]].

## Collegamenti

- [[Pagina Dashboard]] — stessa interazione sulle card KPI
- [[Database]] — importi in centesimi, `BigInt` come stringa
