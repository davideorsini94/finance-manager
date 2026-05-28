# Finance Manager — Brief di design UI

> Documento di riferimento per ridisegnare la UI dell'applicazione.
> Da consegnare a un designer (umano o AI) come specifica completa di ciò
> che la webapp deve mostrare e fare. **Non** vincola lo stile estetico:
> definisce il "cosa" e il "perché", lascia libero il "come visivo" entro
> i requisiti di brand, accessibilità e responsive.

---

## 0. TL;DR

Webapp **self-hosted** per gestione contabilità famigliare:
- Multi-utente con autenticazione (login + invito admin)
- Conti correnti / contanti / carte di credito (anche condivisi tra utenti)
- Movimenti (entrate / uscite / giroconti) con allegati (foto e PDF)
- Carte di credito con addebito differito automatico
- Movimenti ricorrenti, budget mensili, obiettivi di risparmio
- Dashboard con grafici filtrabili per periodo
- Reportistica annuale e confronto periodi side-by-side
- Chat con un'AI locale (Ollama) che vede solo i dati dell'utente loggato
- Import CSV/OFX da banca con suggerimento categoria via AI
- Backup completo (DB + allegati) in `.zip`
- PWA installabile su mobile (iOS / Android)
- Lingue IT / EN, tema chiaro/scuro/sistema

Stack tecnico (utile al designer per sapere cosa è "fattibile"):
React 19 + Tailwind + shadcn/ui + Recharts + TanStack Router/Query.

---

## 1. Personalità del prodotto

**Tipo**: dashboard finanziaria personale, **non** uno strumento aziendale.

**Tono di voce**: amichevole, italiano, mai formale-bancario. *"I tuoi
conti", "sto pensando..."*, niente *"Gentile cliente, La informiamo..."*.

**Principi di design**:

1. **Chiarezza prima di tutto** — i numeri sono il contenuto, devono
   essere leggibili a colpo d'occhio (tabular nums, allineamento a destra
   per importi, segno e colore per discriminare entrata/uscita).
2. **Mobile-first reale** — quasi sempre l'utente apre l'app dal telefono
   per registrare al volo una spesa. La dashboard mobile deve dare le 3-4
   info importanti senza scroll inutili.
3. **Operazioni rapide** — registrare un movimento è l'azione più
   frequente: deve essere a 2 tap dalla home.
4. **Coerenza icone+colori** — ogni utente personalizza conti e categorie
   con icona e colore: la UI deve trattarli come entità riconoscibili
   ovunque (lista, dropdown, grafici).
5. **Niente abbellimenti gratuiti** — no gradienti random, no
   illustrazioni cartoon. È uno strumento, non un'app di onboarding di
   una fintech.

**Riferimenti estetici positivi** (per ispirazione, non da copiare):
Linear, Vercel dashboard, Lunch Money, Copilot Money, YNAB (per la
struttura, non per l'estetica grezza).

**Riferimenti negativi**: dashboard bancarie tradizionali (rigide,
piene), app finanziarie zoomerate stile Revolut/N26 (troppo neon).

---

## 2. Sistema di colori

### Palette base (HSL, CSS variables)

Light:
```
--background: 0 0% 100%
--foreground: 222.2 84% 4.9%
--card / --popover: 0 0% 100%
--primary: 221 83% 53%   (blu Linear-style)
--primary-foreground: 210 40% 98%
--secondary: 210 40% 96.1%
--muted: 210 40% 96.1%
--muted-foreground: 215.4 16.3% 46.9%
--destructive: 0 84.2% 60.2%
--border / --input: 214.3 31.8% 91.4%
--ring: 221 83% 53%
--radius: 0.625rem
```

Dark:
```
--background: 222.2 84% 4.9%
--foreground: 210 40% 98%
--card: 222.2 47% 11.2%
--primary: 217 91% 60%
--secondary / --muted: 217.2 32.6% 17.5%
--border: 217.2 32.6% 17.5%
```

Chart palette (per grafici, ordine di assegnazione automatica):
`--chart-1: 221 83% 53%` (blu)
`--chart-2: 142 71% 45%` (verde)
`--chart-3: 38 92% 50%`  (arancio)
`--chart-4: 0 84% 60%`   (rosso)
`--chart-5: 271 91% 65%` (viola)

### Semantica del colore

- **Verde** → entrate, saldo positivo, "completato/successo", budget OK.
- **Rosso** → uscite, saldo negativo, errori, budget sforato.
- **Ambra** → warning (es. budget all'80%, addebito pending CdC).
- **Grigio (muted)** → giroconti (sono interni, non sono né +né-),
  metadata, scadenze passate.
- **Primary blu** → call to action, link, elementi selezionati.

> Il designer DEVE rispettare la convenzione "verde=positivo / rosso=negativo"
> per gli importi monetari, ma può scegliere shade diversi.

### Personalizzazione utente

Ogni **conto** e ogni **categoria** può avere un colore personalizzato
(palette di 16 swatch + custom hex). Il colore viene usato per:
- Pallino/avatar nell'elenco
- Sfondo soft (12% opacità) dietro l'icona
- Eventualmente riga in evidenza nei grafici (dove il dato è raggruppato
  per quella categoria/conto)

---

## 3. Tipografia

Famiglia: **Inter** (caricata via @fontsource).
Pesi: 400 (regular), 500 (medium), 600 (semibold), 700 (bold).

Scale (ricalcata da Tailwind):
- Display KPI:    text-3xl bold, tabular-nums (importi grandi dashboard)
- Page title:     text-2xl semibold tracking-tight
- Card title:     text-base semibold
- Body:           text-sm regular
- Caption/meta:   text-xs muted-foreground
- Mono (codici, hash, password): font-mono

**Importi monetari**: SEMPRE `tabular-nums` per allineamento perfetto
in colonna. Sempre con simbolo `€` a sinistra, formato italiano
(`1.234,56 €`).

---

## 4. Layout & Navigation

### Breakpoints

```
sm: 640px
md: 768px
lg: 1024px   ← qui cambia layout (mobile vs desktop)
xl: 1280px
```

### Desktop (≥ lg)

Layout a 3 zone:
```
┌────────┬───────────────────────────────────┐
│        │  TopBar (h-14, sticky)            │
│Sidebar ├───────────────────────────────────┤
│ w-60   │                                   │
│        │  <main>                           │
│        │    {children con max-w-7xl}       │
│        │                                   │
└────────┴───────────────────────────────────┘
```

**Sidebar**:
- Logo/nome app in alto
- Lista nav con icona + label, stato attivo evidenziato
- Voci: Dashboard, Conti, Movimenti, Report, Chat, Categorie, Budget,
  Ricorrenze, Obiettivi, Importa, Impostazioni

**TopBar**:
- A sinistra: email utente o vuoto su desktop
- A destra: switcher lingua (icona globo), toggle tema (icona sole/luna),
  bottone logout (icona)

### Mobile (< lg)

- **Bottom nav fissa** con 5 voci principali: **Dashboard, Conti,
  Movimenti, Report, Chat**
- Le altre voci (Categorie, Budget, Ricorrenze, Obiettivi, Importa,
  Impostazioni) si raggiungono tramite la TopBar collassata o
  dall'header della pagina corrente
- TopBar mobile: nome app a sinistra, toggle tema/lingua/logout a destra

**FAB suggerito** (non implementato, sarebbe un bonus): bottone "+" in
basso-destra al di sopra della bottom nav per aprire rapidamente
"Nuovo movimento" da qualsiasi schermata.

### PWA

L'app va aggiunta a Home Screen su iOS/Android. Splash screen / icone
necessarie:
- 192x192, 512x512, maskable 512x512
- Tema header `#0f172a`
- Display `standalone`, `start_url: /`

Quando installata si comporta come app nativa (nessuna chrome del
browser visibile).

---

## 5. Componenti UI ricorrenti

Base shadcn/ui già presenti: **Button, Input, Label, Textarea, Card,
Dialog, Popover, Select, Badge, Progress**.

Pattern custom riusati ovunque:

### Card-conto / Card-categoria
```
[ ICON sfondo-tinted ]  Nome conto       [Badge condiviso/membri]
                         tipo conto

  1.234,56 €
  [Modifica] [Condividi] [Archivia]
```

### Riga movimento
```
[icona ⬇/⬆/⇄] Descrizione    [Badge categoria] [📎 N]   +12,34 €
              data · conto                                (verde/rosso)
              [Modifica] [Elimina] (solo desktop)
```

### KPI card (dashboard)
```
[descrizione piccola muted]
[importo grande tabular]
```

### Empty state
- Icona grande muted al centro
- Frase one-liner che spiega cosa fare
- Bottone primary "Crea il primo X"

### Loading state
- Skeleton (rectangle muted con animate-pulse) della stessa altezza/forma
  del contenuto futuro
- Mai spinner che blocca tutta la pagina

### Toast / feedback inline
Per ora: niente toast globali. Feedback inline sotto i form
(`text-emerald-600` per ok, `text-destructive` per errori), chiusura
automatica dopo 3-4s per i success.

### Color/Icon picker
Popover con:
- 16 swatch preset in griglia 8 colonne
- `<input type="color">` nativo per picker libero
- Campo hex con validazione live
- Per le icone: griglia 7 colonne con search in alto, da pool di ~70 icone
  Lucide a tema finanza/casa

---

## 6. Information architecture (sitemap)

```
/login                          (pubblica)
/accept-invite?token=XXX        (pubblica)

/                               Dashboard
/accounts                       Lista conti + creazione + condivisione
/transactions                   Lista movimenti + filtri + creazione
/categories                     CRUD categorie (alberatura 2 livelli)
/reports                        Report annuale o confronto periodi
/budget                         Budget mensili per categoria
/recurring                      Movimenti ricorrenti
/goals                          Obiettivi di risparmio
/import                         Wizard import CSV/OFX
/chat                           Chat con AI locale
/settings                       Profilo, password, tema, lingua,
                                inviti utente (admin), SMTP (admin),
                                backup/restore (admin)
```

Tutte le route tranne `/login` e `/accept-invite` sono protette: senza
sessione redirect a `/login`.

---

## 7. Schermate, una per una

> Per ognuna: scopo, contenuto, interazioni, stati edge.

### 7.1 Login

**Scopo**: punto di ingresso. Form molto semplice.

**Layout**: Card centrata in viewport (max-w-md), bg-background.

**Contenuto**:
- Titolo: "Accedi"
- Sottotitolo: "Entra nel tuo account"
- Campo Email
- Campo Password (con toggle mostra/nascondi e bottone "incolla")
- Errore inline ("Credenziali non valide") in rosso sotto i campi
- Bottone primary full-width "Accedi" (label cambia in "Accesso in
  corso..." quando submitting)

**Stati**:
- Loading durante login
- Errore credenziali

> Il designer può anche aggiungere logo/branding sopra il form.

### 7.2 Accetta invito

**Scopo**: l'utente arriva da link email con `?token=...` e completa la
registrazione impostando nome+password.

**Layout**: come login, Card centrata.

**Contenuto**:
- Titolo: "Completa la registrazione"
- Sottotitolo: "Imposta la tua password per attivare l'account
  ({email-decoded-from-token})"
- Campo Nome completo (opzionale)
- Campo Password (min 8 char)
- Bottone "Crea account"

**Edge states**:
- Token mancante o non valido → messaggio "Invito non valido o scaduto"
  con bottone secondary "Vai al login"
- Token valido ma in fase di validazione → skeleton di caricamento

### 7.3 Dashboard

**Scopo**: vista d'insieme delle finanze nel periodo selezionato.

**Header**:
- Titolo "Dashboard"
- Filtro periodo a destra: 4 preset (7g / 30g / 90g / YTD) come bottoni
  outline + due `<input type="date">` per range custom

**Sezione KPI** (3 card in riga su md, stack su mobile):
1. **Entrate** (verde, importo grande tabular)
2. **Uscite** (rosso)
3. **Netto** (verde se positivo, rosso se negativo)

**Sezione grafici** (griglia 2 colonne lg, 1 colonna mobile):
- **Andamento patrimonio** (area chart) — saldo cumulativo nel periodo
- **Spese per categoria** (donut chart) — colori delle categorie
- **Entrate vs uscite** (bar chart, larghezza piena lg:col-span-2) — per
  giornata, due barre per giorno (verde+rosso)

**Sezione "Ultime operazioni"** (Card):
- Lista 10 movimenti più recenti, con icona/colore conto, descrizione,
  data, importo segnato

**Empty state**:
Se l'utente non ha ancora registrato movimenti: una card grande che
suggerisce "Crea un conto e poi inserisci i tuoi primi movimenti." con
bottoni primary verso `/accounts`.

### 7.4 Conti (`/accounts`)

**Header**: titolo "Conti" + bottone primary "Nuovo conto" a destra.

**Body**: griglia di card (1 col mobile, 2 md, 3 xl).

**Card singola**:
```
[Avatar 40×40 col colore tinto + icona]   Nome conto    [Badge tipo/condiviso]
                                            tipo conto
1.234,56 €  ← importo grande tabular
[Modifica] [Condividi] [Archivia]
```

Tipi conto: corrente / carta di credito / contanti.
Per le carte di credito: badge specifica + indicazione "addebito su X
il giorno N".

**Modale "Nuovo conto"**:
- Nome (text)
- Tipo (Select: Conto corrente / Carta di credito / Contanti)
- Saldo iniziale (number, solo creazione)
- Colore (ColorPicker con palette + hex)
- Icona (IconPicker con search e griglia)
- Solo se tipo = carta di credito:
  - Conto di pagamento (Select fra i conti non-CdC dell'utente)
  - Giorno addebito (number 1-28, default 15)
- Footer: Annulla / Crea

**Modale "Condividi conto"** (solo per il proprietario):
- Lista membri attuali con: nome, ruolo (Select read/write), bottone X
- Sezione "Aggiungi utente": search per email/nome con debounce,
  Select ruolo, click "Aggiungi"
- Ogni azione (aggiungi/modifica/rimuovi) **chiede conferma** in modale
  separata con descrizione esplicita di cosa cambia

**Empty state**: card grande "Nessun conto ancora. Crea il primo per
iniziare a registrare i movimenti."

### 7.5 Movimenti (`/transactions`)

**Header**: titolo + bottone primary "Nuovo movimento".

**Riga filtri** (Card):
- Search per descrizione/note
- Select Conto (Tutti / lista conti)
- Select Categoria
- Date from / Date to

**Lista** (Card che contiene `<ul>`):
Ogni riga è la "Riga movimento" descritta in §5.

Tone colore + icona freccia:
- ⬆ verde: entrata
- ⬇ rosso: uscita
- ⇄ grigio: giroconto

Badge categoria con colore della categoria, badge "Pending" su giallo per
addebiti carta in attesa.

**Modale "Nuovo movimento"** (max-w-xl):
- Tipo: Select (Entrata / Uscita / Giroconto)
- Conto (sorgente per giroconti)
- Importo (€)
- Solo se Giroconto:
  - Conto destinazione
  - Data arrivo (opzionale, default = data movimento)
- Data
- Categoria (CategoryPicker, escluso per giroconti)
- Descrizione
- Note (textarea, escluso per giroconti)
- Sezione Allegati (visibile dopo creazione)
- Footer: Chiudi / Crea o Aggiorna

**Allegati**:
- Dropzone "Trascina file qui o clicca per scegliere · Immagini o PDF, max 10 MB"
- Lista file con icona tipo, nome, dimensione, bottone anteprima (occhio),
  bottone elimina
- Anteprima inline in nuovo Dialog: immagini full-size, PDF in iframe

### 7.6 Categorie (`/categories`)

**Header**: titolo + bottone "Nuova categoria".

**Body**: due colonne (md), entrambe Card:
- **Uscite** (sinistra)
- **Entrate** (destra)

Ogni riga categoria:
```
[avatar tinto con icona] Nome categoria      [Modifica] [Elimina]
```

Le sottocategorie sono indentate sotto la padre (margin-left).

**Modale Nuova/Modifica categoria**:
- Nome
- Tipo: Entrata / Uscita
- Categoria padre (Select, opzionale, filtrato per tipo)
- Colore (ColorPicker)
- Icona (IconPicker)

### 7.7 Report (`/reports`)

**Header**: titolo + Select modalità: "Riepilogo annuale" / "Confronto periodi".

**Modalità Annuale**:
- Input year
- 3 KPI cards (Entrate/Uscite/Netto annuali)
- Bar chart 12 mesi (Entrate vs Uscite affiancate)
- Card "Top categorie": lista con pallino colore, nome, percentuale,
  importo. Allineamento perfetto.

**Modalità Confronto**:
- Due Card affiancate (md grid 2 cols), ognuna con:
  - Titolo "Periodo 1" / "Periodo 2"
  - Due `<input type="date">` per from/to
- Quando entrambi compilati, sotto:
  - Due colonne con KPI + donut chart per ogni periodo
  - Card "Delta totali" che mostra differenza assoluta + % per
    Entrate, Uscite, Netto, con tono verde/rosso

### 7.8 Budget (`/budget`)

**Header**: titolo + selettore mese (`<input type="month">`) + bottone "Nuovo".

**Body**: griglia card (md 2 cols):
Ogni budget = card con:
```
[• colore]  Nome categoria                             [🗑]
145,30 € / 200,00 €
[Progress bar colorata]
73% utilizzato
```

Colore progress:
- 0-79% verde
- 80-99% ambra
- ≥100% rosso

**Modale "Nuovo budget"**:
- Categoria (CategoryPicker, solo uscite)
- Limite mensile (€)
- Footer: Annulla / Crea

### 7.9 Movimenti ricorrenti (`/recurring`)

**Header**: titolo + bottone "Esegui ora" (outline) + bottone "Nuova" (primary).

**Body**: griglia card (md 2 cols).

Card singola:
```
Descrizione                                    [Badge: Attiva/Sospesa]
Conto · frequenza
+1.500,00 € / -45,00 €  (verde o rosso)
Prossima esecuzione: 15 mag 2026
[Sospendi/Riprendi] [Elimina]
```

**Modale "Nuova ricorrenza"** (max-w-xl):
- Tipo (Entrata/Uscita)
- Frequenza (Select: Giornaliera, Settimanale, Quindicinale, Mensile,
  Trimestrale, Annuale)
- Conto, Importo
- Categoria
- Inizio, Fine (opzionale)
- Descrizione

### 7.10 Obiettivi (`/goals`)

**Header**: titolo + bottone "Nuovo".

**Body**: griglia card (md 2 cols, xl 3 cols).

Card singola:
```
[🏆 oro]  Nome obiettivo                  [Badge "Completato" se done]
1.250 € / 3.000 €
[Progress bar]
42%                              Scadenza: 31 ago 2026
Conto: Risparmio (se assegnato)
[Modifica] [Completa] [🗑]
```

**Modale "Nuovo/Modifica obiettivo"**:
- Nome
- Obiettivo (€) / Già accantonato (€)
- Scadenza (date, opzionale)
- Conto di riferimento (Select, opzionale)

### 7.11 Importa (`/import`)

**Layout**: max-w-2xl mx-auto (è un wizard, vuole spazio centrato).

**Step 1 — Upload**:
1. Card "Conto di destinazione" con Select
2. Card "File da importare" con dropzone (CSV/OFX/QFX, max 5MB)
3. Hint informativo sotto: "Dopo il caricamento potrai rivedere e
   confermare ogni movimento prima dell'import."

**Step 2 — Review**:
- Header: bottone "Annulla" + bottone primary "Importa N"
- Tabella scrollabile con righe del file:
  - Checkbox per accept/skip
  - Data formattata
  - Descrizione (con badge "Possibile duplicato" sotto se rilevato)
  - Importo (verde/rosso)
  - Categoria suggerita (CategoryPicker editabile)
- Duplicati di default deselezionati

**Step 3 — Done**:
Card centrata "Import completato" con check verde, bottone "Nuovo
import".

### 7.12 Chat AI (`/chat`)

**Layout**: due colonne grid `[260px_1fr]` su lg, su mobile la sidebar
diventa drawer fullscreen.

**Sidebar**:
- Header con titolo "Conversazioni" + bottone "Nuova"
- Lista sessioni (ordinata per ultima attività): titolo (auto-generato
  dal primo messaggio), bottone elimina (icona cestino) on-hover

**Main**:
- Header: titolo "Chat finanziaria" con icona MessageSquare. Su mobile:
  bottone "Sessioni" che apre il drawer.
- Card grande che riempie lo spazio:
  - Area scrollabile con messaggi (bubble user a destra primary,
    bubble assistant a sinistra secondary)
  - Bubble assistant mentre l'AI sta lavorando: 3 puntini animati +
    "sto pensando…" (mostrare quando isStreaming && nessun token ancora
    ricevuto, es. durante tool calls)
  - I messaggi assistant supportano markdown (bold, liste, codice inline)
- Composer in basso (border-top): textarea 2 righe + bottone Invia
  (icona Send)
- Empty state: 4 example prompts cliccabili in griglia 2x2:
  - "Quanto ho speso questo mese in totale?"
  - "Quali sono le mie 3 categorie con più uscite negli ultimi 30 giorni?"
  - "Confronta le mie spese di questo mese con il mese scorso."
  - "Dammi 3 consigli per ridurre le spese fisse."
  - + badge "Locale · Ollama" + nota "I dati restano sul tuo server."

### 7.13 Impostazioni (`/settings`)

Layout colonna singola max-w-3xl, sequenza di Card:

**1. Profilo**
- Email (read-only, mostra come sottotitolo)
- Nome completo (input editabile)
- Bottone "Salva"

**2. Aspetto**
- Tema: Select (Chiaro / Scuro / Sistema)
- Lingua: Select (Italiano / English)

**3. Cambia password**
- Password attuale
- Nuova password / Conferma (grid 2 cols)
- Avviso: "Dopo il cambio, tutte le sessioni vengono terminate"
- Bottone "Cambia password"

**4. Inviti utenti** (solo admin):
- Form: input email + bottone "Invia invito"
- Box success quando creato: link copiabile + indicazione se email è
  partita o se va copiato a mano
- Lista inviti pendenti con email, scadenza (badge), bottone copia
  link, bottone revoca (con conferma)

**5. Server SMTP** (solo admin):
- Badge "Configurato" / "Non configurato" accanto al titolo
- Banner provider-specifico se host noto (es. Gmail → istruzioni app
  password con link)
- Form:
  - Host / Porta (grid 2 cols + 1)
  - Modalità sicurezza (Select STARTTLS / TLS implicito)
  - Username / Password (PasswordInput con incolla + mostra/nascondi)
  - Mittente (email + nome)
- Bottoni: Salva / Rimuovi
- Sezione "Invia email di test" (solo se configurato): input email +
  bottone test, feedback success/error inline

**6. Backup & Restore** (solo admin):
- Bottone primary "Scarica backup .zip" + descrizione
- Box warning ambra: "Attenzione: il restore è distruttivo"
- Dropzone per restore .zip con conferma esplicita

---

## 8. Stati comuni di sistema

### Loading globale

Quando bootstrappa l'auth: schermo intero con testo muted "Caricamento…"
centrato.

### Disconnessione automatica

Quando il refresh fallisce, redirect immediato a `/login`. Nessun toast
spaventoso, l'utente capisce dal redirect.

### Errori di rete

Inline nel componente che ha provato l'azione (form / mutazione).
Mai un toast globale.

### PWA prompt installazione

Banner discreto in basso (sopra la bottom nav su mobile, in basso-destra
su desktop):
```
[icona download]  Installa Finance Manager come app  [Installa] [×]
```

Solo se `beforeinstallprompt` viene catturato. Dismissable, ricorda la
scelta in localStorage.

---

## 9. Accessibilità

- Tutti i bottoni icon-only hanno `aria-label`
- Form input hanno `<Label htmlFor>` corretti
- Focus ring visibile (`focus-visible:ring-2 ring-ring ring-offset-2`)
- Colore mai unico veicolo di informazione: per importi positivi/negativi
  c'è anche il segno (`+`/`-`) e l'icona (⬆/⬇)
- Contrast ratio AA su tutti i testi
- Dark mode automatico con `prefers-color-scheme` di default
- Touch target ≥ 44px su mobile (i bottoni icon-only su mobile devono
  avere padding sufficiente)

---

## 10. Internazionalizzazione

Tutte le label utente passano da `i18n.t(key)`. Il designer non deve
preoccuparsi delle stringhe specifiche, ma deve sapere:

- Italiano e Inglese sono lunghezze comparabili (no espansioni del 30%
  come tedesco/russo). Niente vincoli particolari.
- Le date si formattano con locale corrente (`date-fns` con `it`/`enUS`).
- I numeri usano sempre formato locale italiano per gli importi (`1.234,56`).
  Lasciare gli importi in italiano anche con UI in inglese (è una scelta
  di prodotto: i conti sono in EUR, l'utente è italiano).

---

## 11. Asset richiesti

Per l'export del nuovo design:

**Icone app/PWA**:
- `favicon.svg` (esistente: gradient blu su sfondo slate-900, monogramma
  "€" stilizzato)
- `pwa-192.png` (192x192)
- `pwa-512.png` (512x512)
- `pwa-512.png` maskable

**Stati di onboarding** (opzionali):
- Empty state per "Nessun conto"
- Empty state per "Nessun movimento"
- Empty state per "Nessun obiettivo"

Si possono fare con un'icona Lucide grande in muted o con illustrazione
custom — entrambe valide.

---

## 12. Cose esplicitamente fuori scope

Per evitare di spendere effort dove non serve:

- **No notifiche push** in questa fase
- **No multi-valuta** — solo EUR
- **No timeline social / commenti** sui movimenti
- **No export PDF dei report** (esiste solo il backup .zip che è una
  cosa diversa)
- **No widget mobile nativi** (non siamo un'app nativa)
- **No "modalità privacy"** che oscura gli importi (sarebbe carino ma
  non priorità)

---

## 13. Inventario completo entità

Per il designer che progetta tabelle/liste, ecco la "forma" dei dati:

### User
`{ id, email, fullName?, role: admin|user, locale, isActive, createdAt }`

### Account
`{ id, name, type: checking|credit_card|cash, balanceCents (BigInt),
  ownerId, paymentAccountId? (solo CdC), billingDay? (solo CdC),
  color? (#hex), icon? (key dal pool), archivedAt?, owner, members[] }`

### AccountMember
`{ accountId, userId, role: read|write, user: { email, fullName } }`

### Category
`{ id, userId, parentId?, name, color?, icon?, isIncome: boolean,
  sortOrder }`

### Transaction
`{ id, accountId, amountCents (signed BigInt), type: income|expense|transfer,
  categoryId?, description?, notes?, transactionDate, transferPairId?,
  ccChargeId?, isPending, attachments: [...] }`

### Attachment
`{ id, filename, mimeType, sizeBytes, createdAt }`

### RecurringRule
`{ id, accountId, categoryId?, amountCents, type, frequency,
  startDate, endDate?, nextRunDate, isActive, account, category }`

### Budget (con calcolo speso)
`{ id, categoryId, month (YYYY-MM-01), limitCents, spentCents,
  category }`

### Goal
`{ id, name, targetCents, currentCents, deadline?, accountId?,
  isCompleted, account? }`

### ChatSession
`{ id, title?, createdAt, updatedAt }`

### ChatMessage
`{ id, sessionId, role: user|assistant|tool|system, content, toolName?,
  createdAt }`

---

## 14. Output atteso dal designer

Per ogni schermata definita in §7:

1. **Mockup desktop** (≥1280px viewport)
2. **Mockup mobile** (375px viewport)
3. **Mockup dark mode** (almeno per Dashboard, Conti, Movimenti, Chat —
   tutto il resto può essere derivato)

Per il sistema:

4. **Style guide** — palette finale, tipografia, scale spacing, radius,
   shadow, breakpoints
5. **Component library** — varianti di Button (default/outline/ghost/destructive,
   3 size), Card, Input/Select, Badge, Progress, Dialog, Popover,
   PasswordInput, ColorPicker, IconPicker
6. **Set di icone consigliato** — Lucide è già nel codebase, si possono
   selezionare le ~70 da usare nel pool conti/categorie

Output formato:
- Figma con frame nominati per schermata e mode
- Eventualmente design tokens esportabili (JSON) per @-replace nelle
  CSS variables esistenti

---

## 15. Vincoli tecnici da rispettare

Cose che il designer deve sapere per non disegnare l'irraggiungibile:

- I componenti vengono da **shadcn/ui** (Radix sotto). Pattern come
  modali, popover, select, dropdown sono già strutturati: non disegnare
  modali con animazioni custom complesse.
- I grafici sono **Recharts**: supporta Area/Bar/Pie, animazioni built-in
  semplici. Non promettere chart heatmap o sankey complessi.
- Le animazioni di transizione tra pagine sono **assenti** (TanStack
  Router): non disegnare flow basati su slide/morph.
- La Tipografia è una sola: **Inter**. Si può aggiungere un secondo font
  per i numeri se davvero serve (es. mono o "Inter Tabular").
- Il dark mode usa `class` strategy (Tailwind), variabili CSS HSL.
  Tutti i componenti devono funzionare in entrambi.

---

## 16. Note finali

Il prodotto ha già una codebase funzionante con UI shadcn/ui di default.
Il designer ha quindi:
- libertà di **rivedere completamente l'estetica**
- vincolo di **mantenere la struttura informativa** descritta sopra
- vincolo di **mantenere la lista di componenti** così che la
  re-implementazione sia un'operazione di re-styling, non una
  re-architettura

Per qualsiasi dubbio sulle interazioni: aprire l'app esistente
(`docker compose up`) e provarla. Tutta la logica funziona.

Buon design!
