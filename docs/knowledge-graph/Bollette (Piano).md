# Bollette (Piano)

Piano del 2026-10-22 per la sezione Bollette e la rimozione dell'import CSV/OFX. Implementazione in [[Bollette]].

## Obiettivo

1. **Rimuovere** l'import di estratti conto (CSV/OFX, wizard, template): mai usato
2. **Nuova sezione Bollette**, indipendente dai movimenti bancari: luce, gas, acqua; consumi e costi nel tempo; upload del PDF con estrazione dati via LLM; inserimento manuale; bollette con 1, 2 o 3 servizi

## Decisioni

- **Indipendenza**: nessuna relazione con `Transaction`/`Account`/`Category`. Le bollette sono per utente (`userId`), come la chat
- **Modello dati**: `UtilityBill` (testata: fornitore, numero, emissione, scadenza, periodo, totale, PDF opzionale, stato) + `UtilityBillLine` (una riga per servizio, `@@unique([billId, utility])`: consumo, unità fissa per servizio, costo della quota, periodo proprio opzionale, codice POD/PDR, lettura stimata). Così una bolletta luce+gas è una testata con due righe
- **Unità fisse**: luce kWh, gas Smc, acqua m³. Le unità lette dal PDF si convertono (MWh→kWh, litri→m³, mc/m3→Smc per il gas); se non sono riconosciute il consumo si scarta e va inserito a mano
- **Stati**: `extracting` → `review` (LLM ha letto, da verificare) o `failed` (niente testo / LLM fallito) → `confirmed`. Le analisi contano **solo** le confermate: un dato letto male non deve finire nei grafici senza che l'utente lo abbia visto. Una `extracting` più vecchia di 10 minuti è considerata morta (backend riavviato) e mostrata come `failed`
- **Estrazione**: testo del PDF con `pdf-parse` (niente OCR: un PDF scansionato finisce in `failed` con messaggio esplicito e si compila a mano), troncato a 20.000 caratteri, ripulito dai caratteri di controllo; prompt JSON **sempre prima a OpenCode** (chiave e modello configurati in Impostazioni, anche se il provider attivo della chat fosse Ollama: scelta esplicita dell'utente) e, **se OpenCode non va per qualunque motivo** (nessuna chiave, errore, timeout, cooldown di quota, risposta vuota o JSON illeggibile), riprova su **Ollama**; risposta **sempre validata e normalizzata** da una funzione pura testata (numeri all'italiana, date, unità, servizi duplicati o vuoti). Il testo del PDF è di terzi: il modello non ha tool e l'output è solo dati validati
- **Analisi lato frontend**, funzione pura `features/bills/analytics.ts`: ripartizione di consumi e costi sui mesi in proporzione ai giorni del periodo, serie mensili, anno su anno, prezzo unitario per bolletta, totali annuali, storico fornitori, periodi sovrapposti. Lato client perché i volumi sono piccoli (decine di bollette) e così la modalità demo funziona con la stessa logica. Test con `node --test` (Node 24 esegue TypeScript), in `frontend/tests/`
- **PDF**: MinIO, chiave `utility-bills/<userId>/<uuid>.pdf`, MIME verificato con `file-type`, max 10 MB, lettura in stream via `GET /utility-bills/:id/file`, anteprima con `PdfPreview` (Blob, mai `blob:` URL a pdf.js). Inclusi nel backup
- **Import**: via modulo `imports/`, modelli `ImportBatch/ImportRow/ImportTemplate`, `Transaction.importBatchId`, pagine e voci di menu. `CategoryAiService` serve ancora al sync bancario: si sposta in `bank-sync/`. Il valore `import_ready` dell'enum `NotificationType` **resta** a DB (rimuoverlo con `db push` fallirebbe se esistono righe), sparisce dalla UI
- **Grafica**: Liquid Glass come il resto ([[Design System]]): contenuti in materiale standard, colore per servizio come dato (luce ambra, gas blu, acqua ciano, token `--util-*` con variante scura), glifi e grafici su misura

## API

`GET /utility-bills` · `GET /utility-bills/:id` · `POST /utility-bills/upload` (multipart, avvia l'estrazione) · `POST /utility-bills` (manuale) · `PUT /utility-bills/:id` (salva e conferma) · `POST /utility-bills/:id/extract` (rilegge il PDF) · `DELETE /utility-bills/:id` · `GET /utility-bills/:id/file`

## Rischi verificati prima di partire

- `db push --accept-data-loss` all'avvio: elimina le tabelle import e la colonna `import_batch_id` → **backup DB prima del deploy**
- Nuova dipendenza `pdf-parse` (CommonJS, compatibile con Nest): import da `pdf-parse/lib/pdf-parse.js` per evitare il codice di debug dell'entry point che legge un file di test
- `file-type` è ESM-only: si riusa il caricamento `new Function` di `attachments.service.ts`
- Demo: handler per tutte le rotte `utility-bills` con dati realistici (luce+gas in un'unica bolletta, cambio fornitore, acqua trimestrale)
