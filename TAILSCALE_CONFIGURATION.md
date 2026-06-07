# 🌍 Come abbiamo reso Finance Manager raggiungibile da tutto il mondo (gratis!)

> Guida scritta in modo semplice-semplice, per chiunque — anche per chi pensa che
> "il cloud" sia solo quella cosa bianca nel cielo. ☁️
>
> **Risultato finale:** l'app è raggiungibile da qualsiasi parte del mondo su
> **https://orso-macbook-pro.tail5c15a9.ts.net** — senza pagare un centesimo,
> senza aprire porte sul router, senza comprare domini.

---

## 🧠 Il concetto in 30 secondi

Il problema: l'app gira su un MacBook a casa, dentro Docker. Da fuori casa nessuno la vede.

La soluzione: **Tailscale Funnel**. È come un tunnel magico 🕳️ che parte da
internet ed arriva dritto al Mac:

```
Internet 🌍
   │
   ▼
https://orso-macbook-pro.tail5c15a9.ts.net   ← URL pubblico (HTTPS, certificato incluso!)
   │
   ▼  (tunnel cifrato di Tailscale)
Il MacBook 💻
   │
   ▼
localhost:80  →  nginx (container Docker)
                   ├──→  frontend (React)
                   └──→  backend (NestJS) → Postgres, MinIO, Ollama
```

Tailscale fa da "postino": riceve le richieste dal mondo, le porta al Mac e le
consegna a nginx sulla porta 80. Tutto il traffico esterno è in HTTPS e il
certificato lo gestisce Tailscale da solo. Noi non abbiamo toccato NIENTE di
DNS, router, port forwarding o certificati. Zero. 🎉

**Quanto costa?** Niente. Il piano "Personal" di Tailscale è gratuito per sempre
(fino a 3 utenti e 100 dispositivi) e Funnel è incluso.

---

## 📦 Passo 1 — Installare Tailscale sul Mac

Aprire il terminale e dare:

```bash
brew install --cask tailscale-app
```

⚠️ Chiede la **password di amministratore del Mac** (quella che usi per
sbloccarlo). È normale: installa un'app di sistema.

Questo installa l'app **Tailscale** in `/Applications` con la sua iconcina
nella barra dei menu in alto a destra. 🐹

> Curiosità: il comando da terminale di Tailscale vive qui:
> `/Applications/Tailscale.app/Contents/MacOS/Tailscale`
> Se vuoi scrivere solo `tailscale`, aggiungi un alias alla tua shell:
> ```bash
> alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
> ```

---

## 🔑 Passo 2 — Creare l'account e fare login (gratis)

1. Aprire l'app Tailscale (icona nella barra dei menu → **Log in**)
2. Si apre il browser: registrarsi con Google / GitHub / Microsoft / passkey
3. Confermare l'aggiunta del Mac alla propria rete Tailscale (detta "tailnet")

Niente carta di credito, niente trial che scade. Il piano gratuito basta e avanza.

Per verificare che sia andata:

```bash
tailscale status
# → 100.97.64.77  orso-macbook-pro  tuo-account@  macOS  -
```

Se vedi il nome del Mac e il tuo account: sei dentro. 🥳

---

## 🚇 Passo 3 — Accendere il Funnel (il tunnel verso il mondo)

Un solo comando:

```bash
tailscale funnel --bg 80
```

Tradotto: *"Caro Tailscale, tutto quello che arriva dal mondo sul mio URL
pubblico, giralo alla porta 80 di questo Mac (dove ascolta nginx). E fallo in
background (`--bg`), così resta attivo anche se chiudo il terminale."*

⚠️ **La prima volta** il comando NON parte e stampa un link tipo:

```
Funnel is not enabled on your tailnet.
To enable, visit:
        https://login.tailscale.com/f/funnel?node=XXXXXXXX
```

È solo un consenso una-tantum: aprire il link nel browser, cliccare
**Enable**, e rilanciare il comando. (Abilita anche i certificati HTTPS
automatici, sempre gratis.)

Quando funziona vedi:

```
Success.
Available on the internet:

https://orso-macbook-pro.tail5c15a9.ts.net/
|-- proxy http://127.0.0.1:80
```

🎊 Fatto! L'app è pubblica. Davvero. Provala dal telefono con i dati mobili.

Per controllare lo stato in qualsiasi momento:

```bash
tailscale funnel status
```

---

## 🐳 Passo 4 — Docker e nginx: cosa abbiamo toccato? (Spoiler: niente!)

Bella notizia: **zero modifiche** a `docker-compose.yml` e `nginx/nginx.conf`.

Perché? Il progetto era già fatto bene:

- **nginx** è l'unico punto d'ingresso, pubblicato su `localhost:80`
  (variabile `HTTP_PORT=80` nel file `.env`)
- nginx smista già lui: le richieste `/api` vanno al **backend**, il resto al
  **frontend**
- backend, Postgres, MinIO e Ollama NON espongono porte verso l'esterno: si
  parlano solo tra loro nella rete Docker interna (`fm-net`)

Quindi al Funnel basta dire "spedisci tutto alla porta 80" e il giro completo
funziona da solo. nginx non sa nemmeno di essere famoso in tutto il mondo. 😎

---

## ⚙️ Passo 5 — Le DUE righe cambiate nel codice (file `.env`)

Uniche modifiche di configurazione, entrambe nel file `.env`:

### 1. `COOKIE_SECURE`: da `false` a `true`

```diff
- COOKIE_SECURE=false
+ COOKIE_SECURE=true
```

**Perché:** adesso l'app è raggiungibile in HTTPS dal mondo. Con
`COOKIE_SECURE=true` i biscottini 🍪 di login (i cookie `access_token` e
`refresh_token`) viaggiano SOLO su connessioni cifrate. Se qualcuno
intercettasse il traffico, niente cookie per lui.

### 2. `APP_PUBLIC_URL`: scommentata e valorizzata

```diff
- # APP_PUBLIC_URL=https://finance.example.com
+ APP_PUBLIC_URL=https://orso-macbook-pro.tail5c15a9.ts.net
```

**Perché:** quando l'app spedisce email (es. reset password), i link dentro le
email devono puntare all'URL pubblico, non a `localhost` (che sul telefono di
chi riceve l'email non porterebbe da nessuna parte 🤷).

### E poi: riavvio del backend per fargli leggere i nuovi valori

```bash
docker compose up -d backend
```

> 📝 Nota tecnica per curiosi: `COOKIE_DOMAIN=localhost` nel `.env` è rimasto
> com'era. Il backend lo ignora apposta quando vale "localhost"
> (vedi `backend/src/auth/auth.controller.ts`, metodo `cookieBase()`):
> i cookie restano "host-only" e funzionano su qualunque dominio serva l'app.

---

## ✅ Verifica finale (il momento della verità)

```bash
# Risponde in locale?
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:80/      # → 200 ✅

# Risponde dal mondo?
curl -s -o /dev/null -w '%{http_code}\n' https://orso-macbook-pro.tail5c15a9.ts.net/   # → 200 ✅
```

Doppio 200 = doppia felicità. 🎉🎉

---

## ⚠️ Cose IMPORTANTI da sapere

| Cosa | Spiegazione |
|------|-------------|
| 💻 **Il Mac deve restare acceso** | Il "server" è il MacBook. Mac spento (o senza internet) = sito giù. |
| 🔁 **Sopravvive ai riavvii** | Il Funnel è persistente: al riavvio del Mac riparte da solo, basta che l'app Tailscale si avvii al login (di default lo fa). |
| 🌍 **L'URL è pubblico per CHIUNQUE** | Chi conosce l'URL arriva alla pagina di login. La sicurezza è il login dell'app: usa password robuste, soprattutto per l'admin! |
| 🍪 **Accesso locale** | Usa l'URL pubblico anche da casa. Con `COOKIE_SECURE=true`, il login su `http://localhost` può non funzionare in Safari (Chrome/Firefox invece sì). |
| 🐢 **Limiti di banda** | Funnel ha limiti di banda non dichiarati ma pensati per uso personale: perfetto per questa app, non per ospitarci Netflix. |

---

## 🧰 Comandi utili per il futuro

```bash
# Stato del tunnel
tailscale funnel status

# SPEGNERE il sito pubblico (il tunnel, non l'app)
tailscale funnel --https=443 off

# Riaccenderlo
tailscale funnel --bg 80

# Stato della connessione Tailscale
tailscale status
```

### 🏷️ Vuoi un URL più carino?

L'URL è composto così: `https://<nome-dispositivo>.<nome-tailnet>.ts.net`

- **Nome dispositivo** (`orso-macbook-pro`): si cambia dalla
  [dashboard Tailscale](https://login.tailscale.com/admin/machines) →
  tre puntini sul dispositivo → *Edit machine name*. Cambia SOLO l'URL,
  non il nome del Mac. Esempio: rinominandolo `finance-manager` l'URL diventa
  `https://finance-manager.tail5c15a9.ts.net`
- **Nome tailnet** (`tail5c15a9`): dalla dashboard → **DNS** → *Rename tailnet*
  si può rigenerare con nomi buffi tipo `pango-lin.ts.net` (gratis, ma è
  un'estrazione casuale: rigenera finché non ne esce uno simpatico 🎰)
- Un dominio completamente personalizzato (es. `finance.tuodominio.it`)
  invece NON si fa con ts.net: servirebbe comprare un dominio. Altra storia.

---

## 🆘 Se qualcosa non va

1. **Il sito non risponde da fuori** → `tailscale funnel status` (il tunnel è on?)
   e icona Tailscale nella barra dei menu (sei connesso?)
2. **Il sito non risponde nemmeno in locale** → `docker compose ps`
   (i container sono `Up`?). Se no: `docker compose up -d`
3. **Login che non funziona da fuori** → controlla `COOKIE_SECURE=true` nel
   `.env` e che il backend sia stato riavviato dopo la modifica
4. **Panico generale** → spegni tutto (`tailscale funnel --https=443 off`),
   respira 🧘, riaccendi (`tailscale funnel --bg 80`)

---

*Configurato il 7 giugno 2026 con Tailscale 1.98.5 su macOS.*
