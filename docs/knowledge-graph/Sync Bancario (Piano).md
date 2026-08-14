---
tags: [piano, feature]
---

# Sync Bancario (Piano)

Piano per collegare i conti di Finance Manager ai conti bancari reali via **Enable Banking** (PSD2, consenso solo AIS/sola lettura), con import automatico dei movimenti, **categorizzazione automatica via LLM (Ollama)** e **rilevamento giroconti**. Collegato a [[Finance Manager]], [[Backend]], [[Database]], [[Import CSV-OFX]], [[Chat LLM]].

**Stato**: **implementato per intero (Fasi 0-5) il 2026-08-13** → dettagli reali in [[Sync Bancario]]. Questo documento resta come riferimento storico del piano originale (validato il 2026-08-13 da panel multi-agente con 5 lenti: sicurezza, aderenza codebase, modello dati, API provider, UX/PWA + verifica adversariale; provider cambiato da GoCardless a **Enable Banking** su indicazione utente — GoCardless non accetta nuove registrazioni da lug 2025, Enable Banking ha registrazione self-service e **uso personale gratuito in "restricted mode"** collegando i propri conti, senza contratto commerciale). Il contenuto sotto (fasi, rischi aperti) descrive le intenzioni di progettazione, non necessariamente l'implementazione finale in ogni dettaglio: per il comportamento reale fare sempre riferimento a [[Sync Bancario]].

**Decisioni utente**: provider Enable Banking · banche: Intesa Sanpaolo, Fineco, Revolut, Banco Desio, Fideuram · LLM solo Ollama locale con gestione modelli · coda di revisione (no auto-post) · app resta pubblica via Tailscale Funnel.

**Prerequisito Fase 2** (a carico utente, gratuito): sign-in su enablebanking.com → registrare un'applicazione nel Control Panel (genera la **chiave privata RS256 .pem** + application ID) → attivazione produzione in restricted mode collegando i propri conti. Fasi 0–1 sono indipendenti dal provider.

## Architettura del flusso

```
Provider (Enable Banking) ──cron 06:00 + "Sincronizza ora"──▶ BankStagedTransaction (staging)
                                                        │
                          ┌─────────────────────────────┼──────────────────────┐
                          ▼                             ▼                      ▼
                    dedup (dedupHash +         categorizzazione LLM      transfer-matcher
                    fuzzy vs Transaction)      (CategoryAiService)       (giroconti accoppiati)
                          │                             │                      │
                          └────────────▶ Coda di revisione (UI) ◀─────────────┘
                                               │ conferma
                          ┌────────────────────┴────────────────────┐
                          ▼                                         ▼
              semantica TransactionsService.create      TransfersService.create
              (income/expense + saldo)                  (2 gambe transferPairId + saldi)
```

Riuso: `backend/src/imports/category-ai.service.ts` (batch Ollama, con estensioni §2), `backend/src/transfers/transfers.service.ts`, pattern `SmtpConfig` + `crypto.service.ts` (AES-256-GCM), cron stile `recurring.service.ts` (incluso `runNow`), notifiche SSE.

## 1. Schema Prisma (nuovi modelli — validato)

Convenzioni obbligatorie: `@@map`/`@map` snake_case, `@db.Uuid`, `@db.Timestamptz()`, BigInt per i centesimi, **relazioni bilaterali** (back-relation su `User`, `Account`, `Category`, `Transaction`) e **`onDelete` espliciti** (il default `Restrict` sulle relazioni required romperebbe `BackupService.restoreFromZip`/wipe).

```prisma
model BankSyncConfig {  // singleton, pattern SmtpConfig
  id                  String   @id @default("singleton")
  appId               String?  @map("app_id")                 // application ID Enable Banking
  privateKeyEncrypted String?  @map("private_key_encrypted")  // chiave PEM RS256, cifrata AES-256-GCM
  updatedBy           String?  @map("updated_by") @db.Uuid
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  @@map("bank_sync_config")
}

model LlmConfig {       // singleton: modello Ollama attivo (null → env OLLAMA_MODEL)
  id        String   @id @default("singleton")
  model     String?
  updatedBy String?  @map("updated_by") @db.Uuid
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  @@map("llm_config")
}

enum BankConnectionStatus { pending linked expired suspended revoked error }

model BankConnection {
  id               String   @id @default(uuid()) @db.Uuid
  userId           String   @map("user_id") @db.Uuid
  institutionId    String   @map("institution_id")
  institutionName  String   @map("institution_name")
  institutionLogo  String?  @map("institution_logo")
  provider         String   @default("enablebanking")
  providerConsentId String? @unique @map("provider_consent_id") // session_id Enable Banking (dopo scambio del code)
  reference        String   @unique            // "state" anti-CSRF: random 128-bit, monouso, scade 15 min
  status           BankConnectionStatus @default(pending)
  consentExpiresAt DateTime? @map("consent_expires_at") @db.Timestamptz()
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  user  User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  links BankAccountLink[]
  @@index([userId])
  @@map("bank_connections")
}

model BankAccountLink {
  id                String   @id @default(uuid()) @db.Uuid
  connectionId      String   @map("connection_id") @db.Uuid
  accountId         String   @unique @map("account_id") @db.Uuid   // 1 conto app = 1 conto banca; solo type=checking in v1
  providerAccountId String   @map("provider_account_id")
  iban              String?
  ownerName         String?  @map("owner_name")
  currency          String   @default("EUR")
  syncEnabled       Boolean  @default(true) @map("sync_enabled")
  lastSyncAt        DateTime? @map("last_sync_at") @db.Timestamptz()
  lastBookedDate    DateTime? @map("last_booked_date") @db.Date    // cursore incrementale
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz()
  connection BankConnection          @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  account    Account                 @relation(fields: [accountId], references: [id], onDelete: Cascade)
  staged     BankStagedTransaction[]
  @@unique([connectionId, providerAccountId])
  @@map("bank_account_links")
}

enum StagedTxStatus { pending_review confirmed ignored duplicate error }

model BankStagedTransaction {
  id                       String    @id @default(uuid()) @db.Uuid
  linkId                   String    @map("link_id") @db.Uuid
  providerTxId             String?   @map("provider_tx_id")   // entry_reference Enable Banking: OPZIONALE nell'API
  dedupHash                String    @map("dedup_hash")       // internalTransactionId ∥ hash(providerTxId) ∥ hash(campi normalizzati)
  bookingDate              DateTime? @map("booking_date") @db.Date   // opzionale nello spec Berlin Group
  valueDate                DateTime? @map("value_date") @db.Date
  effectiveDate            DateTime  @map("effective_date") @db.Date // bookingDate ?? valueDate — sempre valorizzata
  amountCents              BigInt    @map("amount_cents")            // firmato; parsing da stringa decimale SENZA float
  currency                 String
  description              String?   // SANIFICATA all'ingestione (vedi §5)
  counterparty             String?   // idem
  rawJson                  Json      @map("raw_json")
  status                   StagedTxStatus @default(pending_review)
  suggestedCategoryId      String?   @map("suggested_category_id") @db.Uuid
  suggestedConfidence      Float?    @map("suggested_confidence")
  suggestedType            TransactionType? @map("suggested_type")
  matchedStagedId          String?   @map("matched_staged_id") @db.Uuid  // pairing reciproco; azzerare prima delle delete (pattern transferPairId)
  duplicateOfTransactionId String?   @map("duplicate_of_transaction_id") @db.Uuid
  transactionId            String?   @map("transaction_id") @db.Uuid
  createdAt                DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  link              BankAccountLink @relation(fields: [linkId], references: [id], onDelete: Cascade)
  suggestedCategory Category?    @relation("BankStagedSuggested", fields: [suggestedCategoryId], references: [id], onDelete: SetNull)
  duplicateOf       Transaction? @relation("BankStagedDuplicate", fields: [duplicateOfTransactionId], references: [id], onDelete: SetNull)
  transaction       Transaction? @relation("BankStagedCreated", fields: [transactionId], references: [id], onDelete: SetNull)
  @@unique([linkId, dedupHash])
  @@index([status, effectiveDate])
  @@map("bank_staged_transactions")
}
```

Estensioni a modelli esistenti:
- **`Transaction.bankTxId String? @map("bank_tx_id")`** + `@@index([accountId, bankTxId])` → **dedup durabile**: alla conferma la Transaction memorizza il `dedupHash`; il sync deduplica contro staged E Transaction. Sopravvive a delete di link/connessioni e a re-collegamenti.
- Back-relations: `User.bankConnections`, `Account.bankLink`, `Category` (2 relazioni named), `Transaction` (2 relazioni named).
- `NotificationType` + `bank_sync_review`, `bank_sync_consent`. File da aggiornare (lista completa, pena build rotta): `notifications.types.ts` (NOTIFICATION_TYPES, DEFAULT_PREFS, union NotificationData), frontend `useNotifications.ts`, **`NotificationBell.tsx` (2 mappe esaustive `Record<NotificationType,…>`: ICONS, TYPE_HUE)**, `NotificationsPreferences.tsx` (TYPE_LABELS).
- `AuditEntity` + `bank_connection`, `bank_account_link`, `transfer` (Fase 0) — `AuditLog.entityId` è String, ok.
- **`BackupService`**: aggiungere le nuove tabelle a `TABLES` (export/wipe/restore) e i campi BigInt al registro di serializzazione.

Deploy: `prisma db push` gira nel CMD del container **prima** del boot — lo schema deve validare (relazioni bilaterali!); le modifiche sono additive, nessuna perdita dati.

## 2. Backend — modulo `backend/src/bank-sync/`

**`BankProviderPort`** (interfaccia): `listInstitutions(country)`, `startConsent(institution, redirectUrl, state)`, `exchangeCallback(codeOrRef, state)`, `getConsentStatus(id)`, `listConsentAccounts(id)`, `getAccountDetails(id)`, `fetchTransactions(id, dateFrom?)`, `revokeConsent(id)`. Prima implementazione `EnableBankingProvider` (una `GoCardlessProvider` resta possibile in futuro dietro la stessa interfaccia).

**`enable-banking.client.ts`** — base URL **costante** `https://api.enablebanking.com` (non da env). Autenticazione: **JWT RS256 firmato con la chiave privata dell'app** (da `BankSyncConfig`: `appId` = kid, chiave PEM decifrata on-demand e mai loggata), `iss: enablebanking.com`, `aud: api.enablebanking.com`, `exp` ≤ 3600s — token generati al volo, **mai persistiti**. Endpoint di sola lettura + gestione consenso:
- `GET /aspsps?country=IT` (cache 24h) — lista banche con nome, logo, `maximum_consent_validity`, metodi auth, `psu_types`; gli id istituto vengono SEMPRE da qui
- `POST /auth` — avvia il consenso: `{aspsp: {name, country}, redirect_url: ${APP_PUBLIC_URL}/bank-sync/callback, state, access: {valid_until ≤ maximum_consent_validity della banca}, psu_type: "personal"}` → URL di autorizzazione della banca. Consenso **solo AIS**, nessuna richiesta di scope pagamenti
- Callback: la banca redirige con `code` + `state` → `POST /sessions {code}` scambia il code (breve vita) → `session_id` + lista account uid; salvati su `BankConnection.providerConsentId` e come candidati per il mapping
- `GET /sessions/{id}` (stato consenso), `DELETE /sessions/{id}` (revoca)
- `GET /accounts/{uid}/details`, `/balances`, `/transactions?date_from=` con **paginazione via `continuation_key`** (loop fino a esaurimento)
- **Importi**: `transaction_amount.amount` è una **stringa decimale** + `credit_debit_indicator` (`CRDT`/`DBIT`) → segno derivato dall'indicator, conversione a centesimi via parsing stringa (mai float). Solo `status = BOOK`
- Rate limit: nessun contatore per-scope documentato → gestire **429 con backoff**, cron 1/die + quota manuale per-utente in DB (le banche applicano comunque il limite PSD2 di ~4 accessi non presidiati/giorno)

**Ciclo di vita consenso**: stato da `GET /sessions/{id}` + `valid_until` locale → mappare su `BankConnectionStatus` (`expired`/`revoked`/`error`). Nota Italia (docs Enable Banking): molte banche ammettono **un solo consenso attivo per TPP per utente** — un nuovo consenso invalida il precedente (ok per il nostro flusso di rinnovo). Il `code` del callback ha vita breve: lo scambio in `POST /sessions` avviene subito nel callback pubblico (vedi endpoint), non al rientro nella PWA.

**`bank-sync.service.ts`** — CRUD connessioni/link. Flusso: istituto → agreement+requisition → consenso sul sito banca → **callback pubblica** → dall'app: `finalize` scarica conti → mapping su `Account` (solo `type=checking` in v1; carte di credito e contanti bloccati alla creazione del link — l'interazione con `generateChargeForCcTx` è rimandata a v2) → valuta del conto banca deve combaciare con `Account.currency` (v1 EUR-only: transazioni in altra valuta → staged `error` con contatore visibile).

**ACL**: connessioni visibili/gestibili solo dal proprietario (`userId`). Coda di revisione: staged visibili/confermabili da chi ha **write sul conto collegato** (`AccountPolicyService.assertWrite`, come le transazioni); le categorie proposte/assegnate sono **dell'utente che conferma** (le Category sono per-utente); `CategoryAiService` va chiamato **raggruppando le righe per utente-revisore** (oggi assume un'unica lista categorie per batch).

**`sync-engine.service.ts`** — `@Cron` 06:00 + `POST /bank-sync/sync` manuale con **quota per-utente persistita in DB** (niente `@Throttle` da solo: dietro il Funnel `req.ip` è spoofabile via X-Forwarded-For). Per link attivo:
1. `date_from = lastBookedDate - 7gg` (overlap; primo sync: indietro fin dove la banca consente), solo `status = BOOK`, paginazione `continuation_key` fino a esaurimento
2. normalizzazione: importo stringa + `credit_debit_indicator` → centesimi firmati, `effectiveDate = booking_date ?? value_date`, descrizione da `remittance_information[]` (join) + creditor/debtor name, **sanificazione** (§5)
3. `dedupHash` = `entry_reference` se presente, altrimenti hash(effectiveDate|amount|descrizione normalizzata|posizione progressiva) — collision-safe sui bonifici gemelli stesso giorno
4. dedup: `@@unique(linkId, dedupHash)` + `Transaction.bankTxId` + euristica **fuzzy con finestra ±3 giorni** su data+importo+descrizione contro Transaction manuali (il match esatto sulla data di `ImportsService` non basta: la data contabile banca ≠ data inserita a mano) → `duplicate`
5. categorizzazione batch ≤30 per utente-proprietario + transfer-matcher
6. notifica `bank_sync_review` con `dedupKey` giornaliero e `href` alla pagina di revisione

**`transfer-matcher.service.ts`** — su staged `pending_review` dell'utente: coppie su **conti diversi**, importi opposti, stessa valuta, `effectiveDate` entro ±3 giorni; bonus keyword ("giroconto", "bonifico") e IBAN/intestatario propri (da `/details/` degli altri link). Coppia → `suggestedType: transfer` + `matchedStagedId` reciproco (integrità: azzerare i pair prima di delete/ignore, pattern `transferPairId`). Ambiguità → nessun match automatico. Match contro `Transaction type=transfer` esistenti → `duplicate`. Una sola banca collegata → conversione manuale in revisione.

**Conferma** — `POST /bank-sync/review/confirm {ids[]}`: per riga `assertWrite` + `assertCategoryOwned`; singole → Transaction con semantica `TransactionsService.create` (**saldo aggiornato**, `bankTxId`, audit); coppie → una `TransfersService.create` (+ `bankTxId` su entrambe le gambe). `PATCH /bank-sync/review/:id` per categoria/tipo/ignora/accoppia/spaia.

**Consenso** — cron scadenze: notifica a -7gg e a scadenza (`expired`). **Rinnovo = nuovo EUA + nuova requisition** (niente reconfirmation per le banche IT) con **ri-mappatura automatica dei conti via IBAN** (fallback manuale). I link e lo storico restano.

**Endpoint** (JWT; DTO class-validator; delete 204):
- Admin: `GET|PUT|DELETE /settings/bank-sync` (GET → solo `hasCredentials`), `POST /settings/bank-sync/test`
- `GET /bank-sync/institutions` · `POST|GET /bank-sync/connections` · `GET /bank-sync/connections/:id` (refresh stato remoto — è l'endpoint su cui la UI fa polling post-consenso) · `POST /bank-sync/connections/:id/finalize` · `POST /bank-sync/connections/:id/renew` · `DELETE /bank-sync/connections/:id`
- `POST /bank-sync/links` · `PATCH|DELETE /bank-sync/links/:id`
- `POST /bank-sync/sync` · `POST /bank-sync/links/:id/sync` (quota DB per-utente)
- `GET /bank-sync/review` · `PATCH /bank-sync/review/:id` · `POST /bank-sync/review/confirm`
- Callback: route **frontend pubblica** `/bank-sync/callback` (fuori da `protectedRoute` — su iOS atterra in Safari NON autenticato). La pagina invia subito `{code, state}` all'endpoint backend **pubblico** `POST /bank-sync/callback` (decorato `@Public()`), che valida lo `state` (monouso, scadenza 15 min, connessione `pending` dell'utente che l'ha generato) e scambia il code in `session_id`; poi mostra "Autorizzazione completata — torna all'app Finance Manager". Il mapping conti avviene dall'app, che fa polling su `GET /bank-sync/connections/:id`.

## 3. Backend — gestione modelli Ollama (`settings/llm`)

- `GET /settings/llm` — modello attivo (`LlmConfig.model ?? env`), stato server, installati (`ollama.list()`).
- `GET /settings/llm/catalog` — catalogo **curato statico** (Ollama non ha API pubblica della library): tag, dimensione, RAM richiesta, descrizione IT, badge "oltre il limite 8g". Prima lista: `qwen2.5:7b-instruct-q4_K_M` (attuale), `llama3.1:8b-instruct-q4_K_M`, `mistral:7b-instruct-v0.3-q4_K_M`, `gemma2:9b-instruct-q4_K_M`, `qwen2.5:3b-instruct`, `phi3.5:3.8b`.
- `POST /settings/llm/models/pull` — **job server-side detached** (il download prosegue anche se l'utente chiude la PWA — su iPhone la pagina muore spesso); progresso via `GET /settings/llm/pull-status` in polling. **Il nome modello è validato contro il catalogo** (allowlist: mai passare stringhe arbitrarie a `ollama.pull`). Un pull alla volta.
- `DELETE /settings/llm/models/:name` (solo installati, non l'attivo) · `PUT /settings/llm` (selezione → `LlmConfig`).
- `LlmConfigService` cache-ato (invalidazione su PUT) letto da `LlmChatService` e `CategoryAiService`. Pull/delete/select admin-only; GET per tutti.

## 4. Frontend

- **Impostazioni** (`SettingsPage.tsx`): `BankConnectionsCard` **visibile a tutti gli utenti** (ognuno gestisce i propri collegamenti); le **credenziali** GoCardless in una sotto-card separata **admin-only** (pattern `SmtpSettingsCard`). `LlmSettingsCard` (admin: attivo, installati, catalogo con download+progress da polling, delete, avvisi RAM).
- **Wizard collegamento**: ricerca istituto (logo, lista da `GET institutions`) → apertura link consenso → al ritorno in app, card in polling su stato connessione → mapping conti (IBAN → Account esistente o nuovo).
- **Pagina revisione** (`/bank-review`, nav sezione Strumenti): righe per conto/data, categoria proposta editabile inline, coppie giroconto unite con `ArrowLeftRight`, multi-selezione con **barra azioni fissa in basso** (sopra la BottomNav, safe-area iOS — pattern nuovo, non esiste bulk nel repo), "Conferma tutto". Conteggio pending mostrato **nella campanella** (notifica con `href` — da aggiungere alla `NotificationRow`) e come chip in cima alla pagina Movimenti; niente badge sulla nav (il modello `NavItem` non lo supporta e su mobile non si vede).
- **ky**: le chiamate lunghe (sync, confirm bulk) con `timeout` esteso per-call (default ky = 10s).
- Convenzioni: `bankSyncApi.ts`/`llmApi.ts`, invalidazioni `refetchType:'all'`, **handler demo-mode** per OGNI nuovo endpoint in `frontend/src/lib/demo/handlers.ts` (in demo tutte le richieste sono cortocircuitate: endpoint senza handler = feature rotta in demo), i18n IT/EN (nuovi namespace da aggiungere a entrambi i file).

## 5. Sicurezza (requisito: sola lettura, nessun pagamento possibile)

**Invariante provider-side** (vale anche a server completamente compromesso): il consenso firmato in banca è **solo AIS** (informativo); qualsiasi pagamento richiederebbe un consenso PIS separato con **SCA bancaria per operazione**. L'API Enable Banking include endpoint di pagamento *per i clienti con contratto PIS*: il nostro account resta in **restricted mode personale senza alcun contratto** (i pagamenti non sono attivabili), l'app richiede solo scope AIS e il client non implementa alcun endpoint dispositivo. **2FA attiva** sul portale Enable Banking e procedura di rotazione chiave documentata (rigenerare la chiave app e reinserirla nelle impostazioni).

**Hardening applicativo**:
- Client read-only by construction: solo endpoint lettura+consenso; base URL e scope **costanti hardcoded**; parametri di path sempre encodati.
- Segreti: AES-256-GCM at-rest con **salt dedicato** (`fm-banksync-v1`); nota: la chiave deriva da `JWT_ACCESS_SECRET` → ruotarlo invalida i segreti cifrati (documentare: dopo rotazione, reinserire credenziali). Mai restituiti dalle API, mai nel frontend; token GoCardless solo in memoria.
- Callback anti-CSRF: `reference` random per requisition, verificato server-side; finalize solo dalla sessione autenticata del proprietario.
- Quota sync per-utente **in DB** (l'IP-based throttling è aggirabile: `trust proxy` + Funnel).
- Audit (`AuditLog` con nuovi `AuditEntity`): collegamenti creati/revocati, credenziali modificate, conferme bulk.
- **Dati bancari = testo di terzi NON fidato** (chiunque può bonificarti 0,01€ con causale ostile). Catena da chiudere in **Fase 0** (indipendente dal sync, la chat è già esposta oggi ai dati import CSV):
  1. sanificazione all'ingestione (strip CR/LF e caratteri di controllo, cap ~140 char, neutralizzazione sintassi Markdown/URL) per `description`/`counterparty` staged e `Transaction.description` alla conferma;
  2. hardening `ChatPage.tsx`: ReactMarkdown con `img` disabilitato e link resi testo inerte;
  3. **CSP in nginx**: `default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'` + `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (attenzione a `style-src 'unsafe-inline'` per gli stili inline React e a non rompere SSE);
  4. escaping newline/control chars nel prompt di `CategoryAiService` (oggi escapa solo `"`).
- Worst case compromissione: lettura dati (privacy) + record app sporcabili → **Backup esteso alle nuove tabelle** (§1) li rende ripristinabili. Nessun canale verso denaro reale.

## 6. Fasi

| Fase | Contenuto | Size |
|---|---|---|
| 0 | Fix preesistenti + sicurezza immediata: saldo in `ImportsService.confirm`; tipo categoria derivato dal segno (non `isIncome`) nel prompt AI; escaping control-chars nel prompt; audit giroconti (`AuditEntity.transfer`); **CSP nginx + hardening ReactMarkdown + helper sanificazione descrizioni** | M |
| 1 | Impostazioni LLM/Ollama: `LlmConfig`, list/catalog/pull-job/select + `LlmSettingsCard` | M |
| 2 | Fondamenta bank-sync: schema completo, credenziali cifrate (appId+chiave PEM), `BankProviderPort`+`EnableBankingProvider`, aspsps, collegamento+callback pubblica+scambio code+mapping | L |
| 3 | Sync engine: cron+manuale con quota DB, staging, dedupHash+fuzzy, backoff su 429, notifiche | M |
| 4 | Categorizzazione per-utente + transfer-matcher + pagina revisione (bulk mobile) + conferma con saldi/bankTxId | L |
| 5 | Rinnovo consenso con ri-mappatura IBAN, riconciliazione saldo banca↔app, demo handlers, i18n, MANUALE.md + note vault | M |

Test E2E senza banca reale: sandbox `SANDBOXFINANCE_SFIN0000`.

## 7. Rischi / verifiche aperte

- **Enable Banking restricted mode**: gratuito per i propri conti, ma limiti operativi non documentati pubblicamente — verificare nel Control Panel alla registrazione. La produzione "pubblica" richiederebbe contratto (non ci serve).
- Copertura istituti da confermare alla prima chiamata `GET /aspsps?country=IT`: **Intesa confermata** (docs market IT); **Banco Desio aggiunto gen 2026 ma dichiarato per conti business** — verificare i conti personali; **Fineco, Fideuram, Revolut da verificare**. Istituti assenti → per quel conto resta l'import CSV (migliorato da Fase 0).
- Vincolo Italia: un solo consenso attivo per TPP per utente presso molte banche (un nuovo consenso invalida il precedente) — coerente col flusso di rinnovo, ma da comunicare in UI.
- Il rinnovo consenso richiede SCA dell'utente ogni ~90 giorni (durata effettiva da `maximum_consent_validity` per banca).
- Qualità 7B locale: già in produzione per l'import CSV; threshold <0.4 → categoria vuota. Fase 1 consente upgrade modello.
- v1: solo conti `checking`, solo valuta del conto (EUR); carte di credito e FX in v2.
