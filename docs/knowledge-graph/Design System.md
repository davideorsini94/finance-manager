# Design System

Identità visiva dell'app. Contesto in [[Frontend]]; regole di codice in [[Convenzioni di Sviluppo]].

## Tema "Registro" (default dal 2026-08-31)

Riferimento: la **carta a righe verdi** dei moduli contabili (greenbar). Fondo verde pallidissimo, inchiostro verde-nero, superfici **opache e piatte**, un solo accento (blu penna). Token in `frontend/src/index.css`, blocco `[data-theme='registro']` (+ variante `.dark`).

- `--background 100 14% 92%` (carta) · `--card 90 25% 98%` (foglio) · `--foreground 153 20% 11%` (inchiostro)
- `--primary 205 62% 26%` (blu penna): l'**unico** accento. Verde e rosso sono riservati al DATO (`--pos`/`--neg`), mai alla decorazione — per questo l'accento non è né verde né rosso
- `--radius 0.5rem`; card di vetro tenue su sfondo ambientale fermo (vedi *Materiali in vetro*), niente blob (le classi `fm-glass`/`fm-bg-decor`/`fm-hero-glow` sono scoped su `[data-theme='glass']` e restano inerti qui)
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

## Materiali in vetro (2026-10-16)

Effetto vetro alla Apple, **solo sul livello di navigazione** che galleggia sopra i contenuti. Le card con gli importi restano fogli pieni: un numero su un fondo che cambia si legge peggio. Utility in `frontend/src/index.css`, colori dai token del tema (funzionano in tutti i temi):

- `.fm-material`: pannelli piccoli (select, popover, tab bar, banner). Blur 24px + saturazione, spigolo chiaro in alto, ombra tinta
- `.fm-material-bar`: barre agganciate a un bordo (TopBar, barra azioni di [[Sync Bancario]]), senza ombra
- `.fm-material-thick`: superfici grandi e modali (Dialog, drawer del menu mobile), più opache e più sfocate. Lo scrim del Dialog passa da `black/60` a `black/40` + blur 2px
- `.fm-material-nested`: **pieno**, per pannelli dentro una superficie che ha già `backdrop-filter` (pannello notifiche nella TopBar). Il genitore diventa la "backdrop root": il figlio non può sfocare la pagina e resterebbe trasparente, col testo di sotto leggibile attraverso. I popover Radix sono in portal e non hanno il problema
- **Tab bar mobile** (`BottomNav.tsx`): capsula flottante staccata dai bordi, voce attiva con `.fm-tab-lens` (lente tenue, non colore pieno), FAB `.fm-fab` con riflesso e ombra del suo colore. Il colore sta sempre su uno strato pieno, mai sul vetro. Il `<nav>` esterno resta fixed e trasparente, perché è lui che `ios-viewport.ts` sposta; il `::after` anti-banda ora ha il colore della pagina, non della barra
- **TopBar dentro lo scroller** (`AppShell.tsx`): è `sticky` dentro `<main>`, così il contenuto le scorre sotto (fuori dallo scroller il vetro non avrebbe niente da sfocare). `<main>` ha `scroll-padding-top` per non nascondere sotto la barra le card portate in vista
- Ripieghi: senza `backdrop-filter`, con `prefers-reduced-transparency` o con `prefers-contrast: more` la superficie torna piena

- **Interruttore "Sfocatura vetro"** nel menu temi (`PaletteToggle.tsx`, switch `role=switch`), default **attivo**. Preferenza `glassBlur` in `uiStore` (persist v5, la migrazione da v4 la mette a `true`), pubblicata come `data-glass='on'|'off'` su `<html>` da `applyUIChrome`. Con `off` spariscono tutti i `backdrop-filter` e le superfici tornano piene (un vetro trasparente senza blur farebbe leggere il contenuto di sotto); lo sfondo ambientale resta. Il "Reset" del menu riporta a Registro + sfocatura attiva (prima riportava al vecchio default `glass`)

### Vetro anche sulle card (2026-10-16, su richiesta)

Esteso il vetro ai componenti dei contenuti, solo nel tema Registro:

- **Sfondo ambientale** su `.fm-shell` (il contenitore di `AppShell`, che non scorre): tre radiali fermi nelle tinte del tema (blu penna in alto a destra, salvia in basso a sinistra, carta al centro), con variante scura. Senza qualcosa dietro, una card traslucida sembra solo sbiadita. Niente animazione: un'oscillazione lenta a tutto schermo costa batteria e dà fastidio
- **`[data-theme='registro'] .fm-glass`** (la `Card` ce l'ha di default): fondo `card/0.6`, blur 18px, spigolo chiaro, ombra tinta d'inchiostro. Più opaca e meno sfocata del materiale di navigazione, perché sopra ci sono gli importi
- **`.fm-glass-field`** su `Input`, `Textarea`, trigger del `Select` e `Button` outline: traslucidi, così non sembrano mattonelle piene sul vetro
- **Sidebar desktop**: `fm-material-bar` invece di `bg-card`
- **Selezione KPI** (`FLOW_UI` in `flow.tsx`): il fondo tenue ha `!` perché il vetro della card (specificità 0,2,0) lo coprirebbe
- Ripieghi come sopra (niente `backdrop-filter`, `prefers-reduced-transparency`)

## Superfici con colore del conto

Card dei conti (pagina Conti e striscia della [[Pagina Movimenti]]): **foglio piatto** con la spina sinistra nel colore del conto e il tassello dell'icona tinto al 12%. Il fondo tinto pieno (fino a v0.17) faceva sembrare ogni conto uno stato e competeva con l'evidenziazione della card selezionata.

## Cosa non è stato fatto (e perché)

- **Nessuna virtualizzazione della lista movimenti**: è paginata a 10-50 righe, non è mai lunga nel DOM. `@tanstack/react-virtual` resta una dipendenza non usata
- **Nessun feedback aptico**: iOS Safari non implementa la Vibration API, e l'app si usa da iPhone
- **Nessuna libreria di grafici nuova**: il grafico "d'autore" con lo scrub col dito è un lavoro a sé, da fare a identità assestata

## Collegamenti

- [[Frontend]] · [[Convenzioni di Sviluppo]] · [[Pagina Dashboard]] · [[Pagina Report]] · [[Pagina Movimenti]] · [[PWA e Mobile]]
