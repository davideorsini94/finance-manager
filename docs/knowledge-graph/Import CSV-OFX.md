# Import CSV-OFX

**Rimosso in v0.20.0 (2026-10-22)**: l'utente non lo usava. Eliminati modulo `backend/src/imports/`, pagine `frontend/src/features/import/`, rotte `/import`, `/import/wizard`, `/import/templates`, modelli `ImportBatch`/`ImportRow`/`ImportTemplate`, colonna `Transaction.importBatchId`, dipendenze `papaparse` e `ofx-js`. Al primo avvio della v0.20.0 `prisma db push --accept-data-loss` ha cancellato le tabelle `import_*` (backup DB fatto prima, vedi [[Deploy e Versioning]]).

Cosa resta:
- `CategoryAiService`, nato qui, serve ancora alla coda di revisione del [[Sync Bancario]]: spostato in `backend/src/bank-sync/category-ai.service.ts`
- il valore `import_ready` di `NotificationType` resta nell'enum del DB (toglierlo con `db push` fallirebbe se esistono righe); sparito dalla UI, le eventuali notifiche vecchie mostrano l'icona generica
- il ripristino di un backup fatto prima della v0.20.0 ignora i dati dell'import e scarta `transaction.importBatchId` (`REMOVED_FIELDS` in `backup.service.ts`)

Al suo posto, per i documenti da leggere con l'LLM, c'è la sezione [[Bollette]].
