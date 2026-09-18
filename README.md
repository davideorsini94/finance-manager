# Finance Manager

> Webapp self-hosted per la **gestione della contabilità famigliare**, multi-utente, mobile-first, con AI locale.

Finance Manager è un'applicazione web completa per tenere sotto controllo entrate, uscite, conti, carte di credito, budget, obiettivi di risparmio e ricorrenze di un nucleo famigliare. Tutto gira in locale (o sul tuo server) tramite Docker, senza dipendere da servizi esterni: i tuoi dati restano tuoi.

## Cosa fa

Finance Manager ti permette di:

- 💳 **Gestire conti correnti, contanti e carte di credito** — con addebito differito automatico al giorno 15 del mese successivo
- 👨‍👩‍👧 **Condividere conti tra utenti** con permessi `read`/`write` granulari (es. conto famiglia tra marito e moglie)
- 🧾 **Registrare movimenti** con allegati (foto scontrini, PDF fatture), categorie ad albero (2 livelli), giroconti tra conti
- 🔁 **Automatizzare ricorrenze** (stipendi, affitti, bollette, anche giroconti) con scheduler giornaliero
- 📊 **Visualizzare dashboard, report annuali e confronti** tra periodi con grafici interattivi (Recharts)
- 🎯 **Tracciare budget mensili per categoria** e **obiettivi di risparmio** con progress bar
- 💬 **Chattare con un LLM** (Ollama locale o OpenCode cloud, a scelta) che ha accesso ai tuoi dati tramite tool calling sicuro (es. "Quanto ho speso in ristoranti questo mese?"), più un report testuale generato dall'AI per ogni periodo nella pagina Report
- 📥 **Importare estratti conto CSV/OFX** con suggerimento automatico di categoria via AI
- 🏦 **Sincronizzare i conti con la banca** (Enable Banking, Open Banking in sola lettura) con coda di revisione per confermare/ignorare i movimenti importati, deduplica e riconoscimento automatico dei giroconti
- 📈 **Proiettare il saldo futuro dei conti** in base a ricorrenze e storico (pagina Previsioni)
- 📦 **Backup & restore full-system** in un singolo `.zip` (DB + allegati MinIO)
- 📱 **Installare come PWA** su mobile (iOS/Android) con bottom-nav, safe-area, dark mode, lingua IT/EN
- 🧪 **Modalità Demo** con dati realistici simulati per esplorare l'app senza toccare il DB reale

Multi-utente con autenticazione **invite-only**, reset password via email, refresh-token rotation con detection furto.

## Come funziona

L'app è una classica architettura a tre livelli + AI locale, orchestrata con `docker-compose`:

```
                        ┌──────────────┐
       (browser/PWA) ──▶│    nginx     │  reverse proxy + TLS-ready
                        └──────┬───────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
        ┌──────────────┐              ┌──────────────┐
        │   frontend   │              │   backend    │
        │  React 19 +  │── REST/SSE ─▶│  NestJS +    │
        │  Vite + TS   │              │   Prisma     │
        └──────────────┘              └──────┬───────┘
                                             │
                ┌────────────────────┬───────┴────────┬────────────────┐
                ▼                    ▼                ▼                ▼
        ┌──────────────┐    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │  PostgreSQL  │    │    MinIO     │  │   Ollama     │  │     SMTP     │
        │   (dati)     │    │  (allegati)  │  │  (LLM locale)│  │   (email)    │
        └──────────────┘    └──────────────┘  └──────────────┘  └──────────────┘
```

**Flusso tipico**:
1. L'utente apre l'app sul browser o come PWA installata → nginx serve il frontend statico
2. Il frontend si autentica via `httpOnly cookie` (access JWT 15min + refresh JWT 30 giorni con rotation)
3. Tutte le chiamate API passano per `nginx → backend`; gli allegati vengono caricati su MinIO con presigned URL
4. Il backend applica ACL (`AccountPolicyService`) su ogni risorsa: un utente vede solo i conti propri o condivisi con lui
5. Il modulo Chat usa Ollama o OpenCode in streaming SSE, con **tool calling** che inietta `userId` server-side (l'LLM non può mai accedere a dati di altri utenti)
6. Cron giornaliero alle 01:00 esegue ricorrenze e addebiti differiti delle carte di credito

### Stack tecnico

| Layer | Tecnologie |
|---|---|
| **Frontend** | React 19, Vite, TypeScript, TailwindCSS, shadcn/ui, TanStack Router/Query, Zustand, Recharts, react-i18next, vite-plugin-pwa |
| **Backend** | NestJS, Prisma ORM, JWT (httpOnly cookie + refresh rotation), Argon2id, BullMQ-style scheduler interno |
| **Database** | PostgreSQL 16 (immagine pinnata via sha256) |
| **Object storage** | MinIO (S3-compatible) per allegati con MIME-sniff e presigned URL |
| **LLM** | Ollama locale (default `qwen2.5:7b-instruct-q4_K_M`, ~4.5 GB) oppure OpenCode cloud (tier Zen/Go, con API key propria) — tool calling sicuro, fallback automatico su Ollama se OpenCode esaurisce la quota |
| **Open Banking** | Enable Banking API (AIS, sola lettura) per il collegamento dei conti bancari |
| **Reverse proxy** | nginx (TLS-ready, config commentata per Let's Encrypt) |
| **Deploy** | docker-compose (prod + override dev per hot reload) |

## Come si avvia

### Prerequisiti

- **Docker** ≥ 24 e **docker-compose** v2
- ~6 GB liberi su disco (~4.5 GB per il modello Ollama + immagini)
- Porta `80` (o quella che imposti in `HTTP_PORT`) libera

### Avvio in 4 comandi

```bash
# 1. Configurazione: copia il file di esempio
cp .env.example .env

# 2. Genera due secret JWT robusti e incollali in .env
#    (sostituisci JWT_ACCESS_SECRET e JWT_REFRESH_SECRET)
openssl rand -hex 32
openssl rand -hex 32

# 3. Avvia tutti i servizi (postgres, minio, ollama, backend, frontend, nginx)
docker compose up -d --build

# 4. Crea l'utente admin iniziale (legge SEED_ADMIN_EMAIL/PASSWORD da .env)
docker compose exec backend npm run prisma:seed
```

Apri **`http://localhost/`** e fai login con le credenziali `SEED_ADMIN_*` definite in `.env`.

> ⏳ Al primo avvio Ollama scarica il modello (qualche minuto). Console MinIO disponibile su `http://localhost:9001`.

> 💡 **APP_PUBLIC_URL**: normalmente non serve impostarla — i link nelle email (invito, reset password) usano automaticamente l'host da cui hai aperto l'app (LAN, dominio, ngrok...). Va impostata in `.env` solo se usi la sincronizzazione bancaria (Enable Banking), che richiede un URL pubblico fisso per il callback OAuth.

### Modalità sviluppo (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Backend su `:${BACKEND_PORT}` con `start:dev`, frontend su `:${FRONTEND_PORT}` con `vite`.

### Test e2e

```bash
docker compose exec backend npm run test:e2e
```

### TLS in produzione

1. Aggiungi i certificati a `./nginx/certs/`
2. Scommenta il blocco `server { listen 443 ssl }` in `nginx/nginx.conf`
3. Monta il volume nel `docker-compose.yml`:
   ```yaml
   nginx:
     volumes:
       - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
       - ./nginx/certs:/etc/nginx/certs:ro
     ports:
       - "443:443"
   ```
4. Imposta `COOKIE_SECURE=true` in `.env`

## Funzionalità complete

| Funzionalità | Status |
|---|---|
| Auth invite-only con refresh rotation + detection furto | ✅ |
| Conti correnti / contanti / carte di credito | ✅ |
| Conti condivisi con permessi `read`/`write` | ✅ |
| Categorie ad albero (max 2 livelli) con eredità del colore dal parent | ✅ |
| Cambio colore della categoria padre → propagazione automatica alle figlie | ✅ |
| 50+ colori predefiniti per categorizzazione differenziata | ✅ |
| Movimenti CRUD con allegati (immagini + PDF, anteprima inline) anche in creazione | ✅ |
| Giroconti tra conti gestiti, con categoria opzionale e date diverse partenza/arrivo | ✅ |
| Carte di credito → addebito differito automatico al giorno 15 mese successivo | ✅ |
| Movimenti ricorrenti (incl. giroconti) — cron giornaliero alle 01:00 + trigger manuale | ✅ |
| Budget mensili per categoria con barre colorate | ✅ |
| Obiettivi di risparmio con progress bar | ✅ |
| Dashboard con KPI + 3 grafici Recharts + filtri periodo | ✅ |
| Report annuali + confronto periodi side-by-side | ✅ |
| Chat LLM (Ollama locale o OpenCode cloud) con SSE streaming + tool calling sicuro | ✅ |
| Report AI per periodo ("Report dell'assistente"), cache in DB e prompt personalizzabile da admin | ✅ |
| Import CSV/OFX con suggerimento categoria via AI (Ollama/OpenCode) | ✅ |
| Sincronizzazione bancaria (Enable Banking) con coda di revisione, deduplica e match automatico dei giroconti | ✅ |
| Proiezioni di saldo futuro per conto, basate su ricorrenze e storico | ✅ |
| Backup & Restore full system (DB + MinIO) in `.zip` | ✅ |
| PWA installabile + manifest + service worker | ✅ |
| Mobile-first con bottom nav + safe-area iOS (notch) + dark mode + i18n IT/EN | ✅ |
| Tema "Glass" con componenti animati (AnimatedNumber, SparkLine, StaggerList, Reveal) | ✅ |
| Modalità Demo: dati realistici simulati, zero impatto sul DB (toggle in Impostazioni) | ✅ |
| Reset password via email (link monouso, scadenza 1h) | ✅ |
| Conferme modali su tutte le operazioni distruttive (delete movimento/conto/categoria/allegato) | ✅ |
| Tooltip Recharts leggibili in dark mode | ✅ |
| Audit log su transazioni | ✅ |
| Test e2e auth happy-path | ✅ |
| nginx TLS-ready (config commentata in `nginx/nginx.conf`) | ✅ |
| Immagini Docker pinnate con sha256 digest (postgres / minio / ollama / nginx) | ✅ |

## Struttura del progetto

```
finance-manager/
├── docker-compose.yml          # produzione
├── docker-compose.dev.yml      # override hot-reload
├── .env.example
├── nginx/nginx.conf            # reverse proxy + TLS-ready (config commentata)
├── ollama/entrypoint.sh        # auto-pull del modello
├── backend/                    # NestJS
│   ├── prisma/
│   │   ├── schema.prisma       # 30 modelli + enums + indici
│   │   └── seed.ts
│   ├── src/
│   │   ├── auth/               # login, refresh rotation, invite, change-password, reset-password
│   │   ├── users/              # /me, /users (search), deactivate
│   │   ├── accounts/           # CRUD + ACL via AccountPolicyService
│   │   ├── sharing/            # inviti membri conto + propagazione categorie condivise
│   │   ├── categories/         # CRUD per-utente, sottocategorie con eredità colore
│   │   ├── credit-cards/       # billing date + scheduler addebiti
│   │   ├── transactions/       # CRUD + filtri + audit log
│   │   ├── transfers/          # giroconti come 2 record linkati (+ categoria opzionale)
│   │   ├── attachments/        # MinIO + presigned + MIME sniff
│   │   ├── recurring/          # CRUD + cron @1AM (incl. ricorrenze giroconto)
│   │   ├── budgets/            # CRUD + spent aggregation
│   │   ├── goals/              # CRUD obiettivi
│   │   ├── reports/            # totals/categorie/serie giornaliera/compare
│   │   ├── llm-chat/           # sessions + SSE + tools sicuri (date/accounts/categories nel system prompt); provider Ollama/OpenCode
│   │   ├── llm-reports/        # report AI per periodo, cache + lock + fallback
│   │   ├── imports/            # CSV/OFX + suggerimento categoria AI + confirm
│   │   ├── bank-sync/          # Enable Banking (Open Banking AIS) + coda di revisione movimenti
│   │   ├── backup/             # export/restore full ZIP
│   │   ├── notifications/      # SSE notifiche in-app (condivisioni, ecc.)
│   │   ├── mail/               # SMTP + template email
│   │   ├── health/             # /health
│   │   ├── prisma/
│   │   ├── minio/
│   │   └── common/
│   │       ├── guards/         # JwtAuthGuard, RolesGuard
│   │       ├── decorators/     # @Public, @Roles, @CurrentUser
│   │       └── services/       # AccountPolicyService, AuditService
│   └── test/                   # e2e jest config + auth.e2e-spec.ts
└── frontend/                   # React + Vite
    └── src/
        ├── app/                # router + providers
        ├── components/{ui,layout,shared}
        ├── features/
        │   ├── auth/           # LoginPage, InviteAcceptPage
        │   ├── dashboard/      # DashboardPage + 3 charts (Area/Bar/Pie)
        │   ├── accounts/       # AccountsPage, Form, ShareDialog
        │   ├── transactions/   # TransactionsPage, Form, attachmentsApi
        │   ├── categories/     # CategoriesPage + tree view
        │   ├── budget/         # BudgetPage con barre colorate
        │   ├── recurring/      # RecurringPage + scheduler trigger
        │   ├── goals/          # GoalsPage con progress
        │   ├── reports/        # ReportsPage (annual + compare)
        │   ├── chat/           # ChatPage + useChatStream (SSE)
        │   ├── import/         # ImportPage wizard
        │   ├── bank-review/    # coda di revisione dei movimenti sincronizzati dalla banca
        │   ├── projections/    # ProjectionsPage: previsione saldo per conto
        │   ├── notifications/  # NotificationsProvider + preferenze notifiche
        │   ├── sharing/        # accettazione inviti + gestione membri conto
        │   └── settings/       # SettingsPage (profilo + password + tema + lingua + backup, provider LLM, credenziali banca)
        ├── hooks/              # usePWAInstall
        ├── lib/{api,i18n,auth,utils}
        ├── store/              # Zustand UI state
        └── types/
```

## Autenticazione & sicurezza

- **Argon2id** per l'hash delle password
- **Access token** (JWT, 15 min) + **refresh token** (JWT, 30 giorni) entrambi in cookie **httpOnly**, `SameSite=Strict`, `Secure` in produzione
- **Refresh rotation**: ogni `/auth/refresh` revoca il vecchio token ed emette uno nuovo della stessa "family". Il riuso di un token revocato → revoca tutta la family (detection furto)
- Solo gli **admin** possono creare inviti (`POST /auth/invite`)
- Il cambio password (`POST /auth/change-password`) revoca tutti i refresh token attivi → re-login forzato ovunque
- **Throttler granulare**: login 10/min, refresh 30/min, accept-invite/change-password 5/min, default 120/min
- **ACL conti** via `AccountPolicyService` su tutti gli endpoint dati
- **Tool calling LLM** con `userId` iniettato server-side (mai dall'LLM) → isolamento dati garantito
- **Allegati**: MIME sniff con `file-type` (no fiducia nell'header del browser), size max 10 MB, presigned URL TTL 15 min
- **Credenziali cifrate at-rest** (AES-256-GCM): password SMTP, chiave privata Enable Banking, API key OpenCode — mai esposte in chiaro dopo il salvataggio
- **Audit log** su create/update/delete delle transazioni
- nginx TLS-ready (esempio Let's Encrypt commentato in `nginx/nginx.conf`)

## Backup & Restore

Dalle Impostazioni (solo admin):

- **Scarica backup `.zip`** → archivio con `manifest.json`, `data/<table>.json` per ogni tabella (BigInt come stringhe), `blobs/<minioKey>` per ogni allegato
- **Restore** → caricamento di un `.zip` generato dall'export. **⚠️ Distruttivo**: cancella tutti i dati esistenti (utenti compresi) prima di ripristinare. Tutte le sessioni vengono invalidate

```bash
# Esempio backup via CLI (solo admin loggato, con cookie salvati)
curl -b cookies.txt http://localhost/api/backup/export -o backup.zip

# Restore
curl -b cookies.txt -F file=@backup.zip http://localhost/api/backup/restore
```

## Smoke test end-to-end

1. `docker compose up -d --build && docker compose exec backend npm run prisma:seed`
2. Login admin → crea conto corrente, conto carta credito (con conto pagamento e billing day=15), categorie + sottocategorie (verifica eredità colore dal padre)
3. Inserisci entrate/uscite/giroconti (con categoria opzionale sui giroconti) → vedi grafici Dashboard e saldi popolarsi
4. Carica un allegato (foto + PDF) sia in fase di creazione che in modifica → anteprima inline funzionante
5. Spendi sulla carta di credito → vedi l'addebito pending al giorno 15 del mese successivo sul conto pagamento
6. Crea ricorrenza mensile (anche di tipo giroconto) e premi "Esegui ora" → genera la transazione; verifica che il cron @1AM la gestisca automaticamente la notte
7. Imposta budget categoria → barra avanzamento si aggiorna
8. Chat: "Quanto ho speso questo mese?" → l'LLM (con data corrente + accounts + categorie nel prompt) chiama il tool e risponde con dati reali
9. Import CSV → AI suggerisce categorie → conferma → vedi i movimenti
10. Settings → "Modalità Demo" ON → naviga con dati simulati senza intaccare il DB; OFF per tornare ai tuoi dati
11. Logout → "Password dimenticata?" → ricevi email reset → imposta nuova password
12. Settings → "Scarica backup .zip" → riavvia → "Restore" → tutto torna come prima
13. PWA: apri da mobile → "Aggiungi a Home" → app installabile, bottom nav, safe-area iOS rispettata

## Licenza

Progetto self-hosted per uso personale/famigliare. Adatta a piacere.
