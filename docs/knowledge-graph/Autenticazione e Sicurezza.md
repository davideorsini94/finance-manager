# Autenticazione e Sicurezza

Implementata nel [[Backend]] (`backend/src/auth/`, `backend/src/common/`).

## Autenticazione

- Password con **Argon2id**
- **JWT in cookie httpOnly** (SameSite=Strict, `Secure` in prod via `COOKIE_SECURE=true`): access token 15 min + refresh token 30 gg
- **Refresh rotation con family detection**: il riuso di un refresh token già consumato revoca l'intera famiglia (anti-furto) — modello `RefreshToken` in [[Database]]
- Inviti utente (link monouso con scadenza) e reset password (token SHA-256, TTL 1h) via email ([[Infrastruttura Docker]] → SMTP)

## Autorizzazione

- Ruoli `admin`/`user` (`@Roles`), decorator `@CurrentUser`, rotte pubbliche con `@Public`
- **`AccountPolicyService`**: ACL applicata su ogni endpoint dati — un utente vede solo conti propri o condivisi con lui → [[Condivisione Conti]]
- Tool calling LLM: lo `userId` è iniettato server-side, il modello non può accedere a dati altrui → [[Chat LLM]]

## Hardening

- Throttling granulare: login 10/min, refresh 30/min, accept-invite e change-password 5/min, default 120/min
- Allegati: MIME sniffing reale (libreria `file-type`, header non fidato), max 10 MB, presigned URL TTL 15 min
- SMTP password cifrata at-rest (AES-256-GCM)
- `AuditLog` su create/update/delete di transazioni **e giroconti** (`AuditEntity.transfer`, `backend/src/transfers/transfers.service.ts`)
- HTTPS garantito dal funnel → [[Tailscale e Accesso]]

## Testo esterno non fidato (Fase 0 di [[Sync Bancario (Piano)]])

Causali bancarie e descrizioni dei file importati sono scritte da terzi: se arrivano intatte fino al prompt LLM o al Markdown della chat diventano prompt-injection ed esfiltrazione dati. Catena chiusa così:

- **Sanificazione all'ingestione**: `sanitizeExternalText()` in `backend/src/common/utils/sanitize-text.ts` (control chars → spazio, backtick/`![`/`](` neutralizzati, spazi collassati, cap lunghezza), applicata alle descrizioni in [[Import CSV-OFX]]
- **Prompt**: `CategoryAiService` ripulisce ed escapa ogni descrizione (control chars + `\` e `"`, cap 160 char) prima di interpolarla
- **Chat**: `ReactMarkdown` in `frontend/src/features/chat/ChatPage.tsx` con `img` disabilitato e link resi testo inerte → [[Chat LLM]]
- **CSP + header** in `nginx/nginx.conf` (unico server pubblico): `default-src 'self'`, `frame-ancestors 'none'`, `img-src` con `data:`/`blob:`, `frame-src blob:` (anteprima PDF allegati), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` → [[Infrastruttura Docker]]. **Nota aperta**: `img-src` non include `https:`, quindi i loghi remoti degli istituti bancari ([[Sync Bancario]]) sono bloccati dal browser e ricadono sull'icona di fallback — nessun rischio di sicurezza, solo estetico.

## Sync bancario (Fase 2 di [[Sync Bancario (Piano)]])

- **Read-only by construction**: `EnableBankingClient` implementa solo endpoint di lettura + gestione consenso, base URL e `psu_type` **hardcoded** (non da env/DB) — nessun endpoint di pagamento esiste nel codice, indipendentemente da cosa esporrebbe l'API del provider
- **Segreti**: chiave privata RS256 cifrata AES-256-GCM con **contesto dedicato** `fm-banksync-v1` (`CryptoService`, distinto dal contesto storico SMTP `fm-smtp-v1` — stessa chiave derivata da `JWT_ACCESS_SECRET`, salt diverso); mai restituita da `GET /settings/bank-sync`, mai loggata (i log riportano solo `error.message`, mai l'errore grezzo o la chiave)
- **Callback anti-CSRF**: `BankConnection.reference` è lo "state" random 128-bit, verificato server-side, **monouso** (transizione `pending → linked` fatta con `updateMany` condizionata sullo stato, per resistere a callback concorrenti) e scaduto dopo 15 minuti
- **ACL**: connessioni visibili/gestibili solo dal proprietario (`userId`); i link passano da `AccountPolicyService.assertWrite` sul conto collegato, come le transazioni; solo conti `checking` non archiviati sono collegabili
- Audit su creazione/rimozione di connessioni e link (`AuditEntity.bank_connection`, `bank_account_link`)
