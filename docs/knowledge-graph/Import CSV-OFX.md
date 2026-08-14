# Import CSV-OFX

Importazione di estratti conto CSV/OFX con suggerimenti AI. Frontend: `features/import/` (ImportPage, ImportWizard, ImportTemplatesPage). Backend: `backend/src/imports/`.

## Flusso

1. `POST /imports/batches` — upload del file: parsing righe + suggerimenti categoria da Ollama ([[Chat LLM]] per il modello)
2. Revisione righe nel wizard (mappatura colonne, conto di destinazione, categorie proposte)
3. `POST /imports/batches/:id/confirm` — crea le Transaction (marcate con `importBatchId`) e **aggiorna il saldo del conto** con la somma firmata delle righe importate (un solo `increment` in coda al ciclo) — oppure `cancel`
4. **Template** riutilizzabili per mappature ricorrenti: CRUD `/imports/templates`

## Note

- Le descrizioni lette dal file sono **sanificate all'ingestione** con `sanitizeExternalText()` → [[Autenticazione e Sicurezza]]
- Prompt di `CategoryAiService`: le categorie sono elencate per nome (+ nome del padre) **senza tipo** — `Category.isIncome` è legacy e vale sempre false; entrata/uscita si deduce dal segno dell'importo della riga
- Limite noto: su conto carta di credito l'import non genera gli addebiti futuri (lo fa solo `TransactionsService.create`)

Modelli dati: `ImportBatch`, `ImportRow`, `ImportTemplate` ([[Database]]). Endpoint completi in [[API]].
