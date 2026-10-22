# Bollette

Sezione per luce, gas e acqua: consumi e costi nel tempo, **divisi per abitazione**, lettura automatica del PDF con l'LLM, inserimento a mano. Route `/bills` (ingresso: caricamento, bollette da verificare, abitazioni) e `/bills/$householdId` (statistiche di un'abitazione; `none` = bollette senza abitazione), sezione "Casa" del menu. **Indipendente dai movimenti bancari**: nessuna relazione con conti, movimenti o categorie; una bolletta pagata dal conto non entra qui e una bolletta caricata qui non crea movimenti. Piano originale in [[Bollette (Piano)]].

## Dati ([[Database]])

- `UtilityBill`: per utente (`userId`), fornitore, numero, emissione, scadenza, periodo, totale in centesimi (può essere negativo: bolletta a credito), note, stato (`UtilityBillStatus`: `extracting` / `review` / `failed` / `confirmed`), PDF su MinIO (`fileKey` = `utility-bills/<userId>/<uuid>.pdf`), errore e modello della lettura
- `UtilityBillLine`: una riga per servizio (`UtilityKind`: `electricity` / `gas` / `water`, `@@unique([billId, utility])`), consumo nell'unità fissa (kWh, Smc, m³), quota di costo, periodo proprio opzionale (sempre come coppia), POD/PDR/codice utenza, lettura stimata. Una bolletta luce+gas = una testata con due righe; gestiti 1, 2 o 3 servizi
- Contano nelle analisi **solo le `confirmed`**: un dato letto male non va nei grafici finché l'utente non l'ha visto

## Lettura del PDF (`backend/src/utility-bills/`)

1. `POST /utility-bills/upload` (multipart, max 10 MB, firma `%PDF-` + `file-type`) salva il PDF e crea la bolletta in `extracting`; risponde subito
2. La lettura gira in background in una **coda in-process con 2 lavori alla volta** (`JobQueue`); al massimo 10 bollette in lettura per utente, oltre → `429`
3. Testo del PDF con `pdf-parse` 1.1.1 (pdf.js 1.10) **dentro un `worker_threads`** (`pdf-text.ts`): heap massimo 256 MB, `terminate()` dopo 30 s, `isEvalSupported = false` (CVE-2018-5158 / CVE-2024-4367). Nel thread principale un PDF costruito apposta bloccherebbe l'event loop dell'intero backend. Solo le prime 8 pagine. Un PDF senza testo (scansione) → `failed` con invito a compilare a mano: niente OCR
4. **Prima OpenCode, poi Ollama** (`bill-extractor.service.ts`), su richiesta esplicita dell'utente: OpenCode con chiave e modello delle Impostazioni **anche se il provider attivo della chat è Ollama** (`LlmConfigService.getOpencodeConfig()`, `null` se manca qualcosa o se OpenCode è in cooldown per quota); Ollama per **qualunque** problema di OpenCode, compresi risposta vuota e JSON da cui non si ricava niente. Ollama riceve 12.000 caratteri e `num_ctx` 8192 (CPU), OpenCode 20.000. Sessione OpenCode `utility-bill-<id>`
5. La risposta passa **sempre** da `normalizeExtraction` (`bill-extraction.ts`, puro, 50 test): numeri all'italiana, date in vari formati (rifiutate quelle inesistenti), unità convertite (MWh→kWh, litri→m³; gas in kWh scartato), servizi duplicati o sconosciuti scartati, importi oltre 100.000 € rifiutati, un solo servizio senza costo prende il totale. Il testo del PDF è di terzi: il prompt dice di ignorare istruzioni contenute nel documento, il modello non ha tool e l'output è solo dati validati
6. Il risultato si scrive solo se la bolletta è ancora nella **stessa** lettura (`updateMany` su `status = extracting` e `extractionStartedAt` uguale): cancellata o riletta nel frattempo → risultato buttato. Una `extracting` più vecchia di 12 minuti è considerata morta (backend riavviato) e mostrata come `failed`
7. `POST /:id/extract` (rilettura) è permessa solo da `review`/`failed`, con passaggio a `extracting` **condizionato** allo stato (niente sovrascrittura di una conferma fatta da un'altra scheda, niente doppia lettura pagata)

8. **Periodo dalle quote fisse** (v0.21.1, `findBilledPeriod` / `correctedPeriod` in `bill-extraction.ts`): il mese fatturato si ricava dalle righe "€/cliente/mese" e "€/kW/mese" (escluse le rettifiche "(R)" e i mesi stornati con quantità negativa; solo mesi interi e consecutivi). Corregge il periodo letto dal modello quando manca, è sfasato o più lungo; non lo allarga mai (conguagli tipo Accendi che rifatturano mesi già pagati). Caso reale: la fattura NeN del 01/10 (rettifiche di agosto + quote di settembre) era letta 01/08–30/09 e metà importo finiva su agosto (Castel Maggiore, agosto 2026 a 105 € invece di 70). Le bollette già caricate si correggono una volta al ripasso d'avvio (`periodCheckedAt`, scrittura condizionata al periodo invariato); con un solo servizio la riga torna a usare il periodo della bolletta

Provato sul gateway reale con tre PDF (luce+gas, acqua, scansione) e con OpenCode simulato giù: esiti in [[Registro Modifiche]].

## API ([[API]])

`GET /utility-bills` · `GET /:id` · `POST /` (a mano, nasce `confirmed`) · `POST /upload` · `POST /:id/extract` · `PUT /:id` (salva e conferma) · `DELETE /:id` (cancella anche il PDF) · `GET /:id/file` (PDF in stream). Upload e rilettura: 10/min. Ogni accesso filtra per `userId` (404 per le bollette altrui). Validazione: periodo obbligatorio, 1..3 servizi distinti, per ognuno consumo o costo, date reali (`parseBillDate`), `estimated` booleano vero (niente conversione implicita della stringa "false").

## Frontend (`frontend/src/features/bills/`)

- `BillsPage.tsx`: bollette "Da verificare" in cima (in lettura con polling ogni 2,5 s, da verificare, non lette). Una lettura non riuscita ha due pulsanti nella riga, **Riprova** (`POST /:id/extract` senza aprire il form, l'errore della rilettura compare sotto la riga) e **Compila**; su smartphone stanno su una seconda riga perché affiancati troncavano il titolo. Nel form, l'avviso di lettura fallita ha il pulsante **Riprova la lettura** in evidenza (v0.20.1); selettore Panoramica / Luce / Gas / Acqua; panoramica con una card per servizio e la spesa mensile impilata; dettaglio per servizio con statistiche, consumi o spesa mese per mese o anno su anno, prezzo per unità con i cambi di fornitore, tabella anno per anno, storico fornitori, avviso di periodi sovrapposti (dalla v0.21.2 solo se **entrambe** hanno un consumo: un acconto stornato da un conguaglio — es. Hera acqua — tiene il costo e lascia vuoto il consumo, perché il conguaglio porta il consumo reale dell'intero periodo ed è al netto degli acconti); elenco per anno con "possibile doppione"
- `BillForm.tsx` (React Hook Form + Zod, sheet su mobile): servizi come interruttori colorati, sezione per servizio con consumo, costo, POD/PDR, lettura stimata, periodo diverso. Numeri all'italiana con `numbers.ts` ("1.234" = milleduecentotrentaquattro, "1,5" e "1.5" decimali, centesimi senza errore binario); i numeri si validano **solo per i servizi attivi**; stessi limiti del backend
- `analytics.ts`, puro: ogni bolletta è **ripartita sui mesi in proporzione ai giorni**; un mese senza bollette è vuoto, non zero. La finestra "12 mesi" finisce all'**ultimo mese completamente coperto** (un mese coperto a metà falserebbe il confronto); variazioni solo se entrambe le finestre sono coperte all'85%; prezzo unitario solo dalle righe con consumo **e** costo; totale della panoramica su una finestra **comune** a tutti i servizi (`combinedLast12`)
- Test: `cd frontend && npm test` (`node --test`, Node 24 esegue TypeScript da solo), file `frontend/tests/bills-analytics.test.mts`, 19 test
- Grafica ([[Design System]]): colori dei servizi come dati, token `--util-electricity` (ambra), `--util-gas` (blu indaco), `--util-water` (verde acqua) con variante scura; `UtilityGlyph` (tassello col colore del servizio, luce dall'alto), card con alone e icona in filigrana del servizio, grafici Recharts nel colore del servizio. Contenuti in materiale standard, vetro solo sulla navigazione. Prezzi unitari con `money-blur-target` per la modalità privacy
- PDF: `AttachmentPreviewDialog` con la nuova prop `contentUrl` (→ `GET /utility-bills/:id/file`, in demo `/demo/bolletta-demo.pdf`)
- Demo: `frontend/src/lib/demo/bills.ts`, due anni di luce+gas bimestrali con cambio fornitore (Edison → Enel), acqua trimestrale, ultima bolletta da verificare; sempre relativi a oggi

## Abitazioni (v0.21.0)

- Modello `Household` (per utente: nome, indirizzo), `UtilityBill.householdId` (SetNull) e `UtilityBill.supplyAddress` (indirizzo di fornitura letto; `''` = cercato e non trovato)
- **Si creano da sole** (`households.service.ts`): dopo ogni lettura del PDF la bolletta va (1) nell'abitazione di un'altra bolletta con lo **stesso POD/PDR/codice utenza**, altrimenti (2) in quella con un **indirizzo equivalente**, altrimenti (3) in una nuova, se l'indirizzo ha un civico. Un'assegnazione alla volta per utente (lock in memoria), così due letture parallele dello stesso indirizzo non creano doppioni
- **Confronto degli indirizzi** (`household-address.ts`, puro, testato sulle varianti reali): civico uguale, CAP uguale se presente su entrambi (altrimenti città), tipo di via uguale, parole della via dell'uno contenute nell'altro. "VIA NILDE IOTTI 11", "Via Nilde Iotti 11 42015 Correggio RE" e "VIA IOTTI N. 11 - 42015 Correggio RE" sono la stessa casa
- **Indirizzo di fornitura**: chiesto all'LLM (`supplyAddress`, non quello di fatturazione né la sede del fornitore), con ripiego `findSupplyAddress(text)` senza LLM: vince la riga con "fornitura", poi l'indirizzo che si ripete; le righe di fatturazione o sede contano meno
- **Bollette già caricate**: all'avvio (`onApplicationBootstrap`, dopo 15 s) il PDF delle bollette senza abitazione si rilegge una volta per ricavare l'indirizzo; poi si assegnano
- Gestione: `GET /households`, `PATCH /households/:id` (nome), `POST /households/:id/merge` (unisce due abitazioni: stesso indirizzo scritto troppo diverso), `DELETE /households/:id` (solo se vuota). Nel form della bolletta il campo "Abitazione" (esistente, nessuna o nuova da indirizzo, riconosciuta se esiste già)
- Il caricamento (PDF o a mano) sta **fuori** dalle abitazioni, nell'ingresso; dentro l'abitazione si consultano statistiche e bollette

## Abitazioni condivise (v0.22.0)

Richiesta dell'utente: condividere le abitazioni con altri account (la compagna) inserendo la mail, così entrambi vedono e caricano le bollette.
- Modello `HouseholdMember` (`household_members`, chiave `householdId+userId`, cascade): il proprietario resta `Household.userId`
- `POST /households/:id/members` `{email}` (solo proprietario; l'account deve esistere ed essere attivo, email senza maiuscole/spazi; idempotente) → notifica in-app `system` con link `/bills/<id>` (`NotificationBell` ora segue `data.href` interno). `DELETE /households/:id/members/:userId`: il proprietario toglie chiunque, un membro solo se stesso
- **Accesso alle bollette** (`HouseholdsService.billAccessWhere`): quelle delle abitazioni proprie o condivise, più le proprie senza abitazione. Vale per elenco, dettaglio, PDF, salvataggio, rilettura ed eliminazione. Chi esce (o viene tolto) non vede più nemmeno le bollette che aveva caricato lì: restano al proprietario
- Riconoscimento delle bollette nuove (POD/PDR e indirizzo) su **tutte le abitazioni accessibili**: una bolletta caricata dal membro finisce nella casa condivisa; se non corrisponde a niente si crea un'abitazione del membro
- Solo il proprietario rinomina, unisce (solo tra abitazioni proprie; bollette di tutti e membri passano alla destinazione) ed elimina; per gli altri `403`
- `UtilityBillView.addedById`: nelle abitazioni condivise l'elenco mostra "aggiunta da …"; `HouseholdView` ha `role`, `owner`, `members`
- UI: card e testata con "Condivisa con … / Condivisa da …", sezione **Condivisione** nella finestra Gestisci (aggiungi per email, togli, esci); la demo ha la casa di Roma condivisa
- Verificato con un test d'integrazione su un Postgres usa e getta (6 scenari: visibilità, errori, case-insensitive, riconoscimento POD/indirizzo, permessi, uscita, unione)

## Materia prima (v0.21.0)

- Per luce e gas `UtilityBillLine.energyUnitPrice` (€/kWh, €/Smc) e `energyCostCents`: la voce "spesa per la vendita di energia elettrica / gas naturale" (bollette recenti, es. "0,177488 €/kWh + 31,17 €") o "spesa per la materia energia / gas" (meno recenti). Non rete, oneri, imposte né l'indice all'ingrosso (PUN, PSV, PSBIL)
- Letta dall'LLM, con ripiego `findEnergyPrices(text)` (regex sulla riga di riepilogo, tollera etichette attaccate ai numeri) e limiti di plausibilità (luce 0,01–2 €/kWh, gas 0,05–5 €/Smc). Le bollette già caricate la ricavano all'avvio rileggendo il PDF una volta (`energyParsedAt`), solo nelle righe che non l'hanno
- Nel dettaglio di luce e gas: seconda linea tratteggiata "Materia prima" nel grafico del prezzo per unità e statistica "Materia prima media" (pesata sui consumi, nella finestra dei 12 mesi). Campi "Materia prima" e "Spesa materia prima" nel form

## Panoramica dell'abitazione (v0.21.0)

- Elenco delle bollette **paginato** (10 per pagina, la pagina riparte dalla prima cambiando servizio)
- "Spesa mensile" filtrabile: ultimi 24 mesi oppure un anno, con la spesa dell'anno precedente come linea tratteggiata
- Scheda "**Anno per anno**": spesa per servizio e totale per anno (grafico impilato e tabella), variazione solo tra anni coperti per intero da tutti i servizi (`yearlySummary`)
- Il totale "ultimi 12 mesi" parte dal primo mese coperto se lo storico è più corto (prima diceva "ott 25 – set 26" con dati solo da marzo)

## Backup

Tabelle `household`, `utilityBill` e `utilityBillLine` nel backup (in quest'ordine), PDF in `blobs/utility-bills/...` ripristinati come `application/pdf` → [[Backend]].
