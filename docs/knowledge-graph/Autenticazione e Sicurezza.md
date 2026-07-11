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
- `AuditLog` su create/update/delete delle transazioni
- HTTPS garantito dal funnel → [[Tailscale e Accesso]]
