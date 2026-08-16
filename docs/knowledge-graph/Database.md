# Database

PostgreSQL 16, schema gestito con Prisma: `backend/prisma/schema.prisma`. Migrazioni via `npm run prisma:migrate`, seed admin iniziale via `npm run prisma:seed` (variabili `SEED_ADMIN_*`).

## Modelli e relazioni chiave

- **User** — email, passwordHash (Argon2id), role (admin/user), locale, `favoriteAccountId` (conto proposto di default nei form), `bankSyncTimes` (`String[]`, default `["06:00"]`, colonna `bank_sync_times`): orari `HH:mm` **in ora italiana** a passi di 15' in cui parte il sync bancario automatico, max 4 (tetto PSD2 per gli accessi non presidiati), lista vuota = automatismo disattivato → [[Sync Bancario]]
- **Account** — name, type (`checking`/`credit_card`/`cash`), currency, balanceCents, ownerId, color, icon, archivedAt; per carte: `paymentAccountId` (conto d'appoggio) e `billingDay`
- **AccountMember** — N:N User↔Account con ruolo owner/write/read → [[Condivisione Conti]]
- **AccountInvite** — inviti per conto (token monouso, status pending/accepted/rejected/revoked/expired)
- **Category** — per utente, albero a 2 livelli (`parentId`), eredità colore, isIncome, sortOrder
- **CategoryMemory** — memoria delle categorie scelte a mano nella coda di revisione bancaria: `@@unique([userId, matchKey])`, `matchKey` = chiave normalizzata del movimento (controparte o causale depurata, `buildCategoryMatchKey` in `bank-sync/category-match-key.ts`, max 80 char), `categoryId`, `timesUsed`/`lastUsedAt`. Applicata **prima** dell'LLM in `SyncEngineService.categorizeOwnerQueue`, scritta (upsert) da `BankReviewService` su ogni scelta manuale di categoria (PATCH) e su ogni conferma → [[Sync Bancario]]
- **Transaction** — accountId, userId, amountCents (negativo = uscita), type (income/expense/transfer), categoryId, transactionDate, `transferPairId` (link giroconto), `ccChargeId`, `recurringRuleId`, `importBatchId`, isPending
- **Attachment** — transactionId, minioKey, mimeType, sizeBytes (max 10 MB)
- **RecurringRule** — frequenza daily→yearly, nextRunDate, isActive; anche per giroconti (`toAccountId`)
- **Budget** — unico per (userId, categoryId, month), limitCents
- **Goal** — accountId, targetCents, currentCents, deadline
- **ImportBatch / ImportRow / ImportTemplate** → [[Import CSV-OFX]]
- **ChatSession / ChatMessage** → [[Chat LLM]]
- **RefreshToken** (rotation + family detection), **InviteToken**, **PasswordResetToken** → [[Autenticazione e Sicurezza]]
- **SmtpConfig** — singleton, password cifrata AES-256-GCM
- **LlmConfig** — singleton (`id: "singleton"`), `model` nullable (NULL = usa `OLLAMA_MODEL` d'ambiente) → [[Chat LLM]]
- **BankSyncConfig** — singleton, credenziali Enable Banking (`appId` + chiave privata PEM cifrata AES-256-GCM, contesto dedicato `fm-banksync-v1`); esclusa dal backup come `SmtpConfig`
- **BankConnection** — un consenso PSD2 per utente (`userId`, istituto, `reference` = state anti-CSRF monouso, `status`: pending/linked/expired/suspended/revoked/error, `consentExpiresAt`)
- **BankAccountLink** — mappatura 1:1 conto app ↔ conto banca (`accountId` unique, solo `type=checking`), `syncEnabled`, cursore `lastBookedDate` per il sync incrementale, `lastBalanceCents`/`lastBalanceAt` (Fase 5: ultimo saldo dichiarato dalla banca, per la riconciliazione visiva col saldo dell'`Account`)
- **BankStagedTransaction** — movimento scaricato dalla banca in attesa di revisione (staging, popolato dal motore di sync Fase 3): `dedupHash` unico per link (`@@unique([linkId, dedupHash])`), `amountCents` firmato (BigInt), `status` (`StagedTxStatus`). Fase 4: `suggestedCategoryId`/`suggestedConfidence`/`suggestedType` (proposta LLM + matcher), **`finalCategoryId`** = categoria scelta per la conferma — prefillata col suggerimento ma solo se l'utente non ha già scelto, stesso ruolo di `ImportRow.finalCategoryId`; `matchedStagedId` = pairing **reciproco** dei giroconti (colonna semplice, nessuna FK → va azzerata a mano prima di ignore/delete); `duplicateOfTransactionId` e `transactionId` (movimento creato alla conferma, `SetNull`)
- **BankSyncRun** — una riga per ogni esecuzione del motore di sync (Fase 3): `userId`, `trigger` (`cron`/`manual`/`auto`, solo `manual` consuma la quota giornaliera per-utente), `startedAt`/`finishedAt` (chiuso anche sugli errori), `stats` (Json: conteggi ed errori per link)
- → dettagli modulo in [[Sync Bancario]]
- **AuditLog** — azioni su transazioni (create/update/delete)
- **Notification / NotificationPreference** — `NotificationType` include (Fase 3) `bank_sync_review` (nuovi movimenti bancari in coda) e `bank_sync_consent` (consenso PSD2 in scadenza/scaduto), oltre a `budget_threshold`, `recurring_executed`, `cc_payment_due`, `goal_reached`, `large_transaction`, `account_shared`, `import_ready`, `system`; idempotenza via `dedupKey` (`Notification.data.dedupKey`, finestra 24h in `NotificationsService.create`)

## Convenzioni

- Importi sempre in **centesimi** (`amountCents`, `balanceCents`, `limitCents`, …); formattazione lato [[Frontend]] con `formatCents`
- Soft-delete/archiviazione per i conti (`archivedAt`)
