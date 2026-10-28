# Tailscale e Accesso

L'app è esposta pubblicamente in HTTPS con **Tailscale Funnel** (piano personal, gratuito). Guida completa: `TAILSCALE_CONFIGURATION.md` alla root del progetto.

- URL pubblico: `https://jarvis.tail5c15a9.ts.net`
- Attivazione: `tailscale funnel --bg 80` → inoltra il traffico pubblico a localhost:80 = nginx ([[Infrastruttura Docker]])
- Zero modifiche allo stack Docker e nessun port-forwarding sul router
- `.env` richiesto: `COOKIE_SECURE=true` (cookie JWT solo su HTTPS, vedi [[Autenticazione e Sicurezza]]) e `APP_PUBLIC_URL=https://jarvis.tail5c15a9.ts.net` (link nelle email di invito/reset)

La terminazione TLS è del funnel: nginx resta in HTTP semplice sulla porta 80.

## Se non si raggiunge da fuori

- Da questo server la prova non vale: `curl` verso l'URL pubblico risolve sull'IP della tailnet (100.x) e risponde 200 anche se il Funnel è giù; forzando gli IP pubblici dei relay (`--resolve …:443:185.40.234.x`) la TLS si chiude sempre (il relay non fa da "hairpin" verso lo stesso nodo). Va verificato da una rete esterna (es. smartphone con dati mobili, o un fetch da un servizio esterno)
- Riattivazione senza sudo (l'utente è operatore di tailscaled): `tailscale funnel --https=443 off` e `tailscale funnel --bg 80`; `tailscale funnel status` per controllare. Il Funnel sulla 8443 → 8080 è di un altro progetto
- 2026-10-28: segnalato "non raggiungo più il finance manager da fuori"; nei log di tailscaled reset di connessione verso il server di controllo e il DERP di Francoforte (12:30); Funnel riattivato e verificato da fuori alle 14:08
