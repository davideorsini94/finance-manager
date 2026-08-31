# Design System

Identità visiva dell'app. Contesto in [[Frontend]]; regole di codice in [[Convenzioni di Sviluppo]].

## Tema "Registro" (default dal 2026-08-31)

Riferimento: la **carta a righe verdi** dei moduli contabili (greenbar). Fondo verde pallidissimo, inchiostro verde-nero, superfici **opache e piatte**, un solo accento (blu penna). Token in `frontend/src/index.css`, blocco `[data-theme='registro']` (+ variante `.dark`).

- `--background 100 14% 92%` (carta) · `--card 90 25% 98%` (foglio) · `--foreground 153 20% 11%` (inchiostro)
- `--primary 205 62% 26%` (blu penna): l'**unico** accento. Verde e rosso sono riservati al DATO (`--pos`/`--neg`), mai alla decorazione — per questo l'accento non è né verde né rosso
- `--radius 0.5rem`; niente vetri e niente blob (le classi `fm-glass`/`fm-bg-decor` sono scoped su `[data-theme='glass']` e restano inerti qui)
- I temi precedenti (`glass`, `fintech`, `linear`, `nordic`, `sunset`) sono ancora selezionabili: restano come rete di sicurezza per un rilascio, poi si tolgono. Migrazione store v3→v4: chi era sul vecchio default `glass` passa a `registro`, chi aveva scelto altro resta dov'è

## Tipografia

**Una faccia sola: Inter** (`@fontsource/inter`, self-hosted — niente font di sistema, altrimenti le colonne di importi ballano da device a device). A cambiare sono peso e corpo, non la famiglia.

Un serif da display (Fraunces) è stato provato su titoli, cifre KPI e titoli del markdown LLM, e **scartato dopo la verifica a vista**: gli importi in Inter sono più netti. Fraunces resta nel bundle solo come opzione del *font dei numeri* (`data-num-font='serif'`), insieme a JetBrains Mono. Non esiste una utility `font-display`.

## La firma: come si scrive il denaro

`frontend/src/components/shared/MoneyAmount.tsx` usa `Intl.NumberFormat.formatToParts()` e non `format()`: l'**intero** resta pieno, **decimali e simbolo di valuta** arretrano (più piccoli e smorzati), tutto allineato sulla stessa linea di base con cifre tabulari. Quattro taglie: `inline`, `row`, `kpi`, `hero` — cambia il rapporto tra intero, decimali e simbolo, non la faccia.

**Regola**: ogni importo mostrato a schermo passa da `MoneyAmount`. `formatCents` resta solo dove serve una **stringa** (formatter dei grafici Recharts, testo di una modale di conferma). Prima di questo giro `MoneyAmount` esisteva ma era usato in un solo file mentre 15 stampavano stringhe nude.

## La struttura: la spina del conto

Ogni riga della [[Pagina Movimenti]] porta un bordo sinistro di 3px col **colore del conto** di appartenenza: su conti condivisi si riconosce di chi è il movimento prima di leggere il testo. Il `Transaction` incorpora solo id/nome/tipo del conto, quindi il colore arriva da una mappa costruita sulla query dei conti.

## Colori: token, non classi Tailwind

Entrate/uscite si colorano con `hsl(var(--pos))` / `hsl(var(--neg))`, **mai** con `emerald-600`/`red-600`: i colori fissi di Tailwind ignorano il tema e nel tema Registro il rosso 500 era più acceso del `--neg`, tanto che una card selezionata sembrava in errore. Vale anche per gli stati di selezione (`FLOW_UI` in `features/dashboard/flow.tsx`), dove la selezione è un **filetto sottile + fondo tenue**: un anello spesso e staccato si legge come un allarme.

## Grafici

Recharts con griglia **solo orizzontale** e tratto continuo tenue (la griglia a puntini su due assi è il tell più riconoscibile del grafico di default); serie dai token `--chart-1..5`, guidate dall'accento. I colori delle **categorie** restano quelli scelti dall'utente a database: sono dati, non decorazione, e nel grafico a torta sono l'elemento più rumoroso rimasto.

## Cosa non è stato fatto (e perché)

- **Nessuna virtualizzazione della lista movimenti**: è paginata a 10-50 righe, non è mai lunga nel DOM. `@tanstack/react-virtual` resta una dipendenza non usata
- **Nessun feedback aptico**: iOS Safari non implementa la Vibration API, e l'app si usa da iPhone
- **Nessuna libreria di grafici nuova**: il grafico "d'autore" con lo scrub col dito è un lavoro a sé, da fare a identità assestata

## Collegamenti

- [[Frontend]] · [[Convenzioni di Sviluppo]] · [[Pagina Dashboard]] · [[Pagina Report]] · [[Pagina Movimenti]] · [[PWA e Mobile]]
