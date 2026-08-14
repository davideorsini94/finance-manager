# API

Tutte le rotte sono servite dal [[Backend]] e proxate da nginx sotto `/api/` (es. `/api/health` → backend `/health`). Autenticazione via cookie httpOnly → [[Autenticazione e Sicurezza]].

## Mappa endpoint per dominio

- **Auth** — `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `/auth/invite` (admin), `GET /auth/invites`, `DELETE /auth/invites/:id`, `GET /auth/invite/validate/:token`, `POST /auth/accept-invite`, `POST /auth/forgot-password`, `GET /auth/reset-password/validate/:token`, `POST /auth/reset-password`
- **Users** — `GET /users/me`, `GET /users` (search), `PATCH /users/:id`
- **Accounts** — CRUD `/accounts`; membri: `POST|PATCH|DELETE /accounts/:id/members[/:userId]`
- **Sharing** — `POST|GET|PATCH /accounts/:id/invites[/:inviteId]` → [[Condivisione Conti]]
- **Categories** — CRUD `/categories`, `GET /categories/aggregate`, `PATCH /categories/reorder`
- **Transactions** — CRUD `/transactions`; list con filtri `accountId`, `categoryId`, `type`, `from`/`to`, `search`, paginazione `page`/`limit` → usati dalla [[Pagina Movimenti]]
- **Transfers** — CRUD `/transfers` (creano/eliminano coppie di Transaction)
- **Credit cards** — `POST|GET|PATCH /credit-cards`
- **Recurring** — CRUD `/recurring` + `POST /recurring/run-now`
- **Budgets / Goals** — CRUD `/budgets`, `/goals`
- **Reports** — `GET /reports/dashboard|monthly|annual|custom|compare` + `/reports/advanced/...`
- **Chat** — `GET|POST /chat/sessions`, `GET|DELETE /chat/sessions/:id`, `POST /chat/sessions/:id/messages` (SSE streaming) → [[Chat LLM]]
- **Settings LLM** — `GET /settings/llm` (attivo/installati, tutti gli utenti), `GET /settings/llm/catalog`, `GET /settings/llm/pull-status`, `POST /settings/llm/models/pull`, `DELETE /settings/llm/models/:name`, `PUT /settings/llm` (queste ultime tre admin-only) → [[Chat LLM]]
- **Settings Sync bancario** (admin) — `GET|PUT|DELETE /settings/bank-sync` (GET → solo `hasCredentials`+ID mascherato, PEM mai restituita), `POST /settings/bank-sync/test`
- **Sync bancario** — `GET /bank-sync/institutions?country=IT`, `POST|GET /bank-sync/connections`, `GET /bank-sync/connections/:id` (stato locale, polling UI), `GET /bank-sync/connections/:id/accounts`, `DELETE /bank-sync/connections/:id`, `POST /bank-sync/links`, `PATCH|DELETE /bank-sync/links/:id`, `POST /bank-sync/callback` (**pubblica**, scambio consenso); **Fase 3**: `POST /bank-sync/sync` → `{ results: SyncResult[], quotaRemaining }` (tutti i link dell'utente), `POST /bank-sync/links/:id/sync` → `{ result: SyncResult, quotaRemaining }` (un link; entrambe quota 4/utente/giorno solo trigger manuale, `429` italiano se esaurita, timeout FE 60s), `GET /bank-sync/review/count` → `{ count }` (coda di revisione sui conti scrivibili). **Fase 4** (coda di revisione, ACL = write sul conto collegato): `GET /bank-sync/review?status=pending_review|duplicate|ignored` (default `pending_review`) → `{ items: ReviewItem[], total }` ordinati per `effectiveDate` desc — `ReviewItem` espone `accountName`/`accountColor`, `amountCents` **stringa** firmata (convenzione BigInt→string), `suggestedType`/`suggestedConfidence`/`suggestedCategoryId`, `finalCategory`, `pair` (altra gamba del giroconto) e `duplicateOf`; `PATCH /bank-sync/review/:id` body `{ categoryId?, type?, pairWithStagedId?, ignore?, restore? }` → `{ item }` (combinazioni incoerenti → `400` italiano); `POST /bank-sync/review/confirm` body `{ ids: uuid[] }` (1..200) → `{ confirmed, transfers, skipped, errors: [{ id, message }] }` (errori isolati per riga, mai `500`). **Fase 5**: `POST /bank-sync/connections/:id/renew` → `{ connectionId, authUrl }` (rigenera l'autorizzazione su una connessione `expired`/`suspended`/`revoked`/`error`; al ritorno dal callback i link vengono ri-mappati per IBAN); `link` di `GET /bank-sync/connections` espone anche `lastSyncAt` (Fase 2) e `lastBalanceCents`/`lastBalanceAt` (Fase 5, riconciliazione saldi). → [[Sync Bancario]]
- **Imports** — `POST|GET /imports/batches`, `GET /imports/batches/:id`, `POST .../confirm|cancel`, CRUD `/imports/templates` → [[Import CSV-OFX]]
- **Attachments** — `POST /attachments`, `DELETE /attachments/:id`
- **Backup** — `GET /backup/export`, `POST /backup/restore` (distruttivo)
- **Notifications** — `GET /notifications`, `PATCH /notifications/:id`
- **Health** — `GET /health`
