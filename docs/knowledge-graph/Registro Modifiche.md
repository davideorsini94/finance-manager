# Registro Modifiche

Log cronologico (più recente in alto) delle modifiche al progetto. Una riga per intervento: data, cosa, file principali. Le note di dettaglio vivono nelle pagine collegate.

## 2026-07-11

- **Rilascio v0.2.4**: evidenziazione persistente card conto selezionata (outline + attenuazione delle altre) e dropdown conto sincronizzata con label esplicita ([[Pagina Movimenti]]) — `TransactionsPage.tsx`; copertura striscia nera sotto la BottomNav ([[PWA e Mobile]]) — `BottomNav.tsx`, `index.css`. Workflow [[Deploy e Versioning]] completo, health OK, rollback: `0.2.3`.
- **Repo git ricostruito e push completato**: `.git` era corrotto (solo `config` e oggetti vuoti, senza HEAD/refs) — oggetti rimossi, storia ri-scaricata da GitHub, working tree committato sopra `origin/develop` (commit `e74726f`, 40 file) e pushato. Remote `git@github-personale:davideorsini94/finance-manager.git` con chiave dedicata `~/.ssh/id_ed25519_github_fm` (alias in `~/.ssh/config`). Ripristinati `.gitignore`/`.env.example` persi nella corruzione; aggiunti a `.gitignore` `docker-images-amd64/` e i backup zip.

- **Rilascio v0.2.3** secondo il workflow di [[Deploy e Versioning]]: bump `version` in entrambi i package.json, rebuild backend+frontend, tag `0.2.3`, `docker compose up -d`, export `.tar` in `docker-images-amd64/`. Health check OK (API e frontend HTTP 200). Rollback disponibile: immagini `0.2.2`.

- **Card conti cliccabili in [[Pagina Movimenti]]**: click = filtro per conto (toggle), card selezionata evidenziata, tutte le card restano visibili — `frontend/src/features/transactions/TransactionsPage.tsx`
- **Quick-add mobile propone il conto filtrato**: `defaultAccountId` aggiunto a `quickAddStore`, sincronizzato dalla pagina Movimenti e passato al `GlobalQuickAdd` di `AppShell` — `frontend/src/store/quickAddStore.ts`, `frontend/src/components/layout/AppShell.tsx`
- **Fix viewport iOS (iPhone 16 Pro)** → dettagli in [[PWA e Mobile]]: soppressione auto-zoom input (meta viewport via JS solo iOS), blocco scroll documento + reset automatico del pan (BottomNav shiftata con banda nera), normalizzazione campi data — `frontend/src/lib/ios-viewport.ts` (nuovo), `frontend/src/main.tsx`, `frontend/src/index.css`
- **Creato il grafo di conoscenza** (`docs/knowledge-graph/`) e `CLAUDE.md` con la regola di consultazione/aggiornamento
