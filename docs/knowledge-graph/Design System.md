# Design System

Identità visiva dell'app. Contesto in [[Frontend]]; regole di codice in [[Convenzioni di Sviluppo]].

## Tema "Registro" (default dal 2026-08-31)

Riferimento: la **carta a righe verdi** dei moduli contabili (greenbar). Fondo verde pallidissimo, inchiostro verde-nero, superfici **opache e piatte**, un solo accento (blu penna). Token in `frontend/src/index.css`, blocco `[data-theme='registro']` (+ variante `.dark`).

- `--background 100 14% 92%` (carta) · `--card 90 25% 98%` (foglio) · `--foreground 153 20% 11%` (inchiostro)
- `--primary 205 62% 26%` (blu penna): l'**unico** accento. Verde e rosso sono riservati al DATO (`--pos`/`--neg`), mai alla decorazione — per questo l'accento non è né verde né rosso
- `--radius 0.5rem`; card in materiale standard (non vetro) su sfondo ambientale fermo, vetro solo sulla navigazione (vedi *Liquid Glass secondo le linee guida Apple*), niente blob (le classi `fm-glass`/`fm-bg-decor`/`fm-hero-glow` sono scoped su `[data-theme='glass']` e restano inerti qui)
- I temi precedenti (`glass`, `fintech`, `linear`, `nordic`, `sunset`) sono ancora selezionabili: restano come rete di sicurezza per un rilascio, poi si tolgono. Migrazione store v3→v4: chi era sul vecchio default `glass` passa a `registro`, chi aveva scelto altro resta dov'è

## Tipografia

**Una faccia sola: Inter** (`@fontsource/inter`, self-hosted — niente font di sistema, altrimenti le colonne di importi ballano da device a device). A cambiare sono peso e corpo, non la famiglia.

Un serif da display (Fraunces) è stato provato su titoli, cifre KPI e titoli del markdown LLM, e **scartato dopo la verifica a vista**: gli importi in Inter sono più netti. Fraunces resta nel bundle solo come opzione del *font dei numeri* (`data-num-font='serif'`), insieme a JetBrains Mono. Non esiste una utility `font-display`.

## La firma: come si scrive il denaro

`frontend/src/components/shared/MoneyAmount.tsx` usa `Intl.NumberFormat.formatToParts()` e non `format()`: l'**intero** resta pieno, **decimali e simbolo di valuta** arretrano (più piccoli e smorzati), tutto allineato sulla stessa linea di base con cifre tabulari. Quattro taglie: `inline`, `row`, `kpi`, `hero` — cambia il rapporto tra intero, decimali e simbolo, non la faccia.

**Regola**: ogni importo mostrato a schermo passa da `MoneyAmount`. `formatCents` resta solo dove serve una **stringa** (formatter dei grafici Recharts, testo di una modale di conferma). Prima di questo giro `MoneyAmount` esisteva ma era usato in un solo file mentre 15 stampavano stringhe nude.

## La struttura: la spina del conto

Ogni riga della [[Pagina Movimenti]] porta un bordo sinistro di 3px col **colore del conto** di appartenenza: su conti condivisi si riconosce di chi è il movimento prima di leggere il testo. Il `Transaction` incorpora solo id/nome/tipo del conto, quindi il colore arriva da una mappa costruita sulla query dei conti.

## Palette delle categorie

`frontend/src/lib/theme/categoryPalette.ts` — dodici tinte distribuite sul cerchio cromatico ma tenute alla **stessa intensità** (saturazione ~40%, luminosità ~45%): colori da pigmento, non primari da schermo, così convivono con la carta senza vibrare e restano leggibili sul fondo scuro. L'accento dell'interfaccia (blu penna) **non** compare: serve a dire cosa è interattivo, e un dato dello stesso colore lo confonde.

- Il `ColorPicker` la mostra come prima sezione ("Palette del tema"), fissa; sotto restano tutti i 64 colori, scrollabili — nessuno è obbligato a usarla
- **`POST /categories/recolor`** (pulsante "Riallinea al tema" nella pagina Categorie) assegna una tinta a ogni categoria **radice** in ordine alfabetico e la propaga ai figli, cioè lo stesso modello di ereditarietà che vale già quando si cambia il colore di una radice a mano. Con più radici che tinte la palette si ripete, ma due radici adiacenti in elenco non ricevono mai lo stesso colore. Operazione massiva e non annullabile → `useConfirm()` che dice **quante** categorie tocca
- La palette viaggia dal frontend al backend nella richiesta: i token di design vivono nel frontend, il backend valida solo che siano esadecimali

## Colori: token, non classi Tailwind

Dal 2026-10-16 (v0.18.0) il testo di importi ed esiti in tutta l'app usa `--pos`/`--neg` (50 occorrenze `emerald-*`/`red-*`/`rose-*` sostituite in report, proiezioni, impostazioni, inviti, revisione). Restano con colori fissi solo alcuni banner di stato con fondo pieno. Il wizard di import (`ImportWizard.tsx`) era interamente in `slate`/`blue` e ora usa i token.

Entrate/uscite si colorano con `hsl(var(--pos))` / `hsl(var(--neg))`, **mai** con `emerald-600`/`red-600`: i colori fissi di Tailwind ignorano il tema e nel tema Registro il rosso 500 era più acceso del `--neg`, tanto che una card selezionata sembrava in errore. Vale anche per gli stati di selezione (`FLOW_UI` in `features/dashboard/flow.tsx`), dove la selezione è un **filetto sottile + fondo tenue**: un anello spesso e staccato si legge come un allarme.

## Grafici

Budget: barra di avanzamento sui token `--pos` / `--warn` (≥80%) / `--neg` (≥100%), mai `emerald-*`.

Recharts con griglia **solo orizzontale** e tratto continuo tenue (la griglia a puntini su due assi è il tell più riconoscibile del grafico di default); serie dai token `--chart-1..5`, guidate dall'accento. I colori delle **categorie** restano scelti dall'utente a database, ma la palette proposta e il riallineamento li tengono in accordo col tema (sezione sopra).

## Movimento e tocco (2026-10-16)

- **Curve**: `--ease-out` (ingressi e risposte), `--ease-in-out` (spostamenti), `--ease-drawer` (pannelli), in `frontend/src/index.css`. Le easing native di CSS sono troppo deboli
- **Pressione**: `Button` scala a 0.97 su `:active`; per card e righe cliccabili che non sono `Button` c'è `.fm-press` (0.98). Il feedback parte quando il dito si appoggia, non quando si alza. Con `prefers-reduced-motion` non scala
- **Hover solo col mouse**: `future.hoverOnlyWhenSupported` in `tailwind.config.js`. Su iPhone il primo tap lasciava lo stato hover appiccicato
- **Controlli**: niente velo al tap, `touch-action: manipulation`, niente selezione del testo/callout con la pressione lunga (solo su button/role=button/tab, i contenuti restano selezionabili)
- **Ingressi**: `fm-card-in` 360ms, stagger 40ms. Le pagine si aprono decine di volte al giorno
- **Non toccato**: il `maximum-scale=1` solo iOS di [[PWA e Mobile]] resta, anche se la skill mobile-native lo sconsiglia: senza, Safari zoomava sugli input e il pan restava incastrato

## Liquid Glass secondo le linee guida Apple (v0.19.0, 2026-10-19)

Regole prese da tre pagine Apple (Adopting Liquid Glass, HIG Materials, Applying Liquid Glass to custom views) e applicate dopo un'anteprima approvata dall'utente. Utility in `frontend/src/index.css`.

- **Il Liquid Glass sta solo sul livello funzionale** (barre, tab bar, pulsanti flottanti, menu, popover, sheet). **Le card sono livello contenuti → materiale standard**: `[data-theme='registro'] .fm-glass` è `card/0.9`, senza blur, senza riflesso sul bordo, ombra leggera. La v0.18 aveva il vetro anche sulle card: Apple lo esclude esplicitamente ("Don't use Liquid Glass in the content layer")
- **Materiali**: `.fm-material` (regular, pannelli e controlli), `.fm-material-bar` (sidebar desktop, barra azioni della revisione), `.fm-material-thick` (Dialog/sheet, drawer), `.fm-material-nested` (pieno, per un pannello dentro una superficie con `backdrop-filter`). Sempre variante *regular*: l'app non ha foto o video di sfondo che giustifichino la *clear*
- **TopBar** (`TopBar.tsx`): niente striscia piena. A sinistra il cerchio di vetro del menu (`MobileMenu.tsx`), a destra un gruppo di tre azioni su una capsula comune (importi nascosti, notifiche, profilo). Su desktop la ricerca è una capsula di vetro. Il vetro del gruppo sta su uno `<span aria-hidden>` fratello e non sul contenitore: un `backdrop-filter` sull'antenato diventerebbe il containing block del pannello notifiche `fixed` e gli impedirebbe di sfocare la pagina
- **Scroll edge effect** al posto dei fili divisori: `.fm-scroll-edge-top` (compare quando si scorre) e `.fm-scroll-edge-bottom` (dietro la tab bar)
- **Titolo grande**: classe `.fm-large-title` (30px, 700) su tutte le pagine; scorrendo, il nome della sezione compare in piccolo al centro della TopBar (solo mobile/tablet)
- **Tab bar** (`BottomNav.tsx`): capsula con le 4 sezioni + cerchio separato per "Nuovo movimento" (`.fm-fab` = glassProminent, l'unico elemento tinto). Scorrendo in giù si riduce alla sola voce attiva, scorrendo in su torna intera (`tabBarMinimizeBehavior(.onScrollDown)`). Stato da `store/scrollStore.ts`, alimentato dallo scroll di `<main>` in `AppShell.tsx` (si azzera a ogni cambio pagina, che riporta anche in cima)
- **Sheet**: sotto `sm` il `DialogContent` è uno sheet staccato di 8px dai bordi, raggio 2rem, entra dal basso; da `sm` torna modale centrata. Una classe dopo `className` (`max-sm:w-auto max-sm:max-w-none`) neutralizza i `w-full`/`max-w-*` dei call-site pensati per la modale
- **Concentricità**: `--radius` del Registro 0.75rem (controlli più rotondi), `--radius-card` 1.375rem; capsula tab bar 32px con voce attiva a 28px (32 − 4 di padding). Le card con righe a filo (Movimenti, Ultime operazioni, revisione, import, chat) hanno `overflow-hidden` per il nuovo raggio
- **Vetro interattivo**: `.fm-glass-press` (compressione 0.94 + schiarita al tocco)
- **Niente maiuscolo nelle intestazioni**: sezioni della sidebar e del menu mobile, etichette KPI, titoli del ColorPicker
- **Menu profilo** (`UserMenu.tsx` + `AppearanceSettings.tsx`): tema (chiaro/scuro/sistema), lingua, palette (pallini), font dei numeri, sfocatura vetro, dati demo. Sostituisce le icone di tema, lingua e palette nella TopBar: rimossi `PaletteToggle.tsx`, `ThemeToggle.tsx`, `LanguageSwitcher.tsx`
- **Interruttore "Sfocatura vetro"**: preferenza `glassBlur` in `uiStore` (persist v5), `data-glass='on'|'off'` su `<html>`; spento toglie tutti i `backdrop-filter` e rende piene le superfici
- **Sfondo ambientale** fermo su `.fm-shell` (radiali blu penna/salvia/carta del Registro): è livello contenuti, non vetro
- Ripieghi: senza `backdrop-filter`, `prefers-reduced-transparency`, `prefers-contrast: more` → superfici piene; `prefers-reduced-motion` → niente compressione e niente animazioni di ingresso

## Superfici con colore del conto

Card dei conti (pagina Conti e striscia della [[Pagina Movimenti]]): **foglio piatto** con la spina sinistra nel colore del conto e il tassello dell'icona tinto al 12%. Il fondo tinto pieno (fino a v0.17) faceva sembrare ogni conto uno stato e competeva con l'evidenziazione della card selezionata.

## Cosa non è stato fatto (e perché)

- **Nessuna virtualizzazione della lista movimenti**: è paginata a 10-50 righe, non è mai lunga nel DOM. `@tanstack/react-virtual` resta una dipendenza non usata
- **Nessun feedback aptico**: iOS Safari non implementa la Vibration API, e l'app si usa da iPhone
- **Nessuna libreria di grafici nuova**: il grafico "d'autore" con lo scrub col dito è un lavoro a sé, da fare a identità assestata

## Collegamenti

- [[Frontend]] · [[Convenzioni di Sviluppo]] · [[Pagina Dashboard]] · [[Pagina Report]] · [[Pagina Movimenti]] · [[PWA e Mobile]]
