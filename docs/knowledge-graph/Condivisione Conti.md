# Condivisione Conti

Un conto può essere condiviso con altri utenti con ruoli **owner / write / read**. Backend: `backend/src/sharing/` + `accounts/`; frontend: `features/sharing/` e ShareDialog in `features/accounts/`.

## Meccanica

- Membri: modello `AccountMember` (N:N User↔Account con ruolo) → [[Database]]
- Inviti per conto: `AccountInvite` con token monouso e stati pending/accepted/rejected/revoked/expired; endpoint `POST|GET|PATCH /accounts/:id/invites` → [[API]]
- Accettazione via `/accounts/invite/accept?token=...` ([[Frontend]], `AcceptInvitePage`)
- Ogni accesso ai dati passa da `AccountPolicyService` ([[Autenticazione e Sicurezza]]): si vedono solo conti propri o condivisi
- Notifiche in-app via SSE quando si viene aggiunti/invitati
- Toggle "solo i miei" nella UI (`features/sharing/OnlyMineToggle.tsx`) per filtrare i dati condivisi
