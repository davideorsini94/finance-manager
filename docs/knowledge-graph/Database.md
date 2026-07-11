# Database

PostgreSQL 16, schema gestito con Prisma: `backend/prisma/schema.prisma`. Migrazioni via `npm run prisma:migrate`, seed admin iniziale via `npm run prisma:seed` (variabili `SEED_ADMIN_*`).

## Modelli e relazioni chiave

- **User** — email, passwordHash (Argon2id), role (admin/user), locale, `favoriteAccountId` (conto proposto di default nei form)
- **Account** — name, type (`checking`/`credit_card`/`cash`), currency, balanceCents, ownerId, color, icon, archivedAt; per carte: `paymentAccountId` (conto d'appoggio) e `billingDay`
- **AccountMember** — N:N User↔Account con ruolo owner/write/read → [[Condivisione Conti]]
- **AccountInvite** — inviti per conto (token monouso, status pending/accepted/rejected/revoked/expired)
- **Category** — per utente, albero a 2 livelli (`parentId`), eredità colore, isIncome, sortOrder
- **Transaction** — accountId, userId, amountCents (negativo = uscita), type (income/expense/transfer), categoryId, transactionDate, `transferPairId` (link giroconto), `ccChargeId`, `recurringRuleId`, `importBatchId`, isPending
- **Attachment** — transactionId, minioKey, mimeType, sizeBytes (max 10 MB)
- **RecurringRule** — frequenza daily→yearly, nextRunDate, isActive; anche per giroconti (`toAccountId`)
- **Budget** — unico per (userId, categoryId, month), limitCents
- **Goal** — accountId, targetCents, currentCents, deadline
- **ImportBatch / ImportRow / ImportTemplate** → [[Import CSV-OFX]]
- **ChatSession / ChatMessage** → [[Chat LLM]]
- **RefreshToken** (rotation + family detection), **InviteToken**, **PasswordResetToken** → [[Autenticazione e Sicurezza]]
- **SmtpConfig** — singleton, password cifrata AES-256-GCM
- **AuditLog** — azioni su transazioni (create/update/delete)
- **Notification / NotificationPreference**

## Convenzioni

- Importi sempre in **centesimi** (`amountCents`, `balanceCents`, `limitCents`, …); formattazione lato [[Frontend]] con `formatCents`
- Soft-delete/archiviazione per i conti (`archivedAt`)
