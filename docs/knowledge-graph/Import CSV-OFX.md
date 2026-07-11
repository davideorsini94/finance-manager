# Import CSV-OFX

Importazione di estratti conto CSV/OFX con suggerimenti AI. Frontend: `features/import/` (ImportPage, ImportWizard, ImportTemplatesPage). Backend: `backend/src/imports/`.

## Flusso

1. `POST /imports/batches` — upload del file: parsing righe + suggerimenti categoria da Ollama ([[Chat LLM]] per il modello)
2. Revisione righe nel wizard (mappatura colonne, conto di destinazione, categorie proposte)
3. `POST /imports/batches/:id/confirm` — crea le Transaction (marcate con `importBatchId`) — oppure `cancel`
4. **Template** riutilizzabili per mappature ricorrenti: CRUD `/imports/templates`

Modelli dati: `ImportBatch`, `ImportRow`, `ImportTemplate` ([[Database]]). Endpoint completi in [[API]].
