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
- **Imports** — `POST|GET /imports/batches`, `GET /imports/batches/:id`, `POST .../confirm|cancel`, CRUD `/imports/templates` → [[Import CSV-OFX]]
- **Attachments** — `POST /attachments`, `DELETE /attachments/:id`
- **Backup** — `GET /backup/export`, `POST /backup/restore` (distruttivo)
- **Notifications** — `GET /notifications`, `PATCH /notifications/:id`
- **Health** — `GET /health`
