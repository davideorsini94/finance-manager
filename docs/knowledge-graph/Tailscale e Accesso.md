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
- **Prova per singolo ingresso** (2026-11-01, più affidabile): `for ip in $(dig +short @1.1.1.1 jarvis.tail5c15a9.ts.net A); do curl -s -m12 -o /dev/null -w "$ip %{http_code}\n" --resolve jarvis.tail5c15a9.ts.net:443:$ip https://jarvis.tail5c15a9.ts.net/api/health; done`. Un ingresso sano risponde 200 anche dal server; uno rotto apre il TCP e poi resta muto sulla TLS (timeout). Un fetch dagli USA può riuscire mentre gli ingressi europei sono rotti
- **Riavvio di tailscaled** (`sudo systemctl restart tailscaled`, password dell'utente): rifà la registrazione sui relay; dopo il riavvio il Funnel sulla 443 può sparire → `tailscale funnel status` e, se manca, `tailscale funnel --bg 80`
- L'iPhone riusa la connessione già aperta: dopo la riparazione serve chiudere l'app/le schede e attivare e disattivare la modalità aereo; con un ingresso ancora rotto può servire più di un tentativo. Sintomi tipici: PWA con login in cache che dà "credenziali non valide", Safari con pagina bianca
- 2026-11-01: dall'Italia (casa e rete mobile) nessuno dei tre ingressi europei (176.58.90.x) rispondeva, dagli USA sì; status Tailscale senza incidenti. Riattivare il Funnel non è bastato; dopo il riavvio di tailscaled 2 ingressi su 3 sono tornati (il .145 ancora muto) e l'app si è riaperta dopo la modalità aereo
- 2026-10-28: segnalato "non raggiungo più il finance manager da fuori"; nei log di tailscaled reset di connessione verso il server di controllo e il DERP di Francoforte (12:30); Funnel riattivato e verificato da fuori alle 14:08
