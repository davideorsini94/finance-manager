# Backend

API NestJS + Prisma in `backend/`. Espone REST sotto `/api/` (prefisso aggiunto da nginx, vedi [[Infrastruttura Docker]]) più stream SSE per chat e notifiche.

## Moduli (`backend/src/`)

| Modulo | Responsabilità |
|---|---|
| `auth/` | login, refresh rotation, inviti utente, cambio/reset password → [[Autenticazione e Sicurezza]] |
| `users/` | profilo `/me`, ricerca utenti, `favoriteAccountId` |
| `accounts/` | CRUD conti + ACL (`AccountPolicyService`) |
| `sharing/` | inviti/membri per conto → [[Condivisione Conti]] |
| `categories/` | albero categorie 2 livelli, eredità colore, riordino |
| `credit-cards/` | carte con `billingDay` e addebito differito sul conto d'appoggio |
| `transactions/` | CRUD movimenti + filtri + audit |
| `transfers/` | giroconti = 2 Transaction linkate via `transferPairId` |
| `attachments/` | upload su MinIO, MIME sniff, lettura in stream via `GET attachments/:id/content` (è la rotta che usa il frontend, vedi [[Frontend]] → Allegati). `GET attachments/:id/presigned` (TTL 15 min) esiste ancora ma è **legacy e non usata**: la URL firmata punta all'hostname interno `minio:9000`, irraggiungibile dal browser |
| `recurring/` | ricorrenze con cron giornaliero @1AM |
| `budgets/`, `goals/` | budget mensili per categoria, obiettivi con progress |
| `reports/` | dashboard, mensile, annuale, custom, confronto |
| `llm-chat/` | sessioni chat + SSE streaming + tool calling → [[Chat LLM]] |
| `llm-reports/` | report testuale del periodo scritto dall'LLM, job detached con lock a DB → [[Pagina Report]]. Modulo **a sé** e non sotto `reports/`: `LlmChatModule` importa già `ReportsModule`, quindi la dipendenza inversa creerebbe un ciclo |
| `imports/` | CSV/OFX + suggerimenti Ollama → [[Import CSV-OFX]] |
| `backup/` | export/restore ZIP completo (DB + MinIO) |
| `notifications/`, `mail/` | notifiche in-app SSE, SMTP (config cifrata AES-256-GCM) |
| `common/` | guards, decorators (`@CurrentUser`, `@Roles`, `@Public`), `AccountPolicyService`, `AuditService` |

## Job schedulati

- **@1:00** esecuzione ricorrenze attive (`nextRunDate <= oggi`)
- Addebiti carta di credito al giorno `billingDay` del mese successivo

## Note operative

- Il CMD di produzione esegue `prisma db push --accept-data-loss` all'avvio (vedi [[Deploy e Versioning]])
- Endpoint completi in [[API]]; schema dati in [[Database]]
