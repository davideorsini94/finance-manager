# Tailscale e Accesso

L'app è esposta pubblicamente in HTTPS con **Tailscale Funnel** (piano personal, gratuito). Guida completa: `TAILSCALE_CONFIGURATION.md` alla root del progetto.

- URL pubblico: `https://jarvis.tail5c15a9.ts.net`
- Attivazione: `tailscale funnel --bg 80` → inoltra il traffico pubblico a localhost:80 = nginx ([[Infrastruttura Docker]])
- Zero modifiche allo stack Docker e nessun port-forwarding sul router
- `.env` richiesto: `COOKIE_SECURE=true` (cookie JWT solo su HTTPS, vedi [[Autenticazione e Sicurezza]]) e `APP_PUBLIC_URL=https://jarvis.tail5c15a9.ts.net` (link nelle email di invito/reset)

La terminazione TLS è del funnel: nginx resta in HTTP semplice sulla porta 80.
