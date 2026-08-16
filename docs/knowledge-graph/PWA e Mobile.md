# PWA e Mobile

L'app è **mobile-first** e installabile come PWA (usata soprattutto da iPhone in modalità standalone). Vedi anche [[Frontend]].

## PWA

- `vite-plugin-pwa` (`frontend/vite.config.ts`), `registerType: 'prompt'`: cache degli asset, **niente cache delle API** (ci pensa React Query); banner `SWUpdateBanner` per lo skipWaiting esplicito
- `frontend/public/manifest.json` — icone 192/512 + maskable
- Registrazione SW gestita dal plugin (NON registrare manualmente: creava doppi eventi `sw-update-available`)
- `frontend/src/lib/sw-cache-cleanup.ts` — pulizia cache API di vecchi SW

## Layout mobile

- `AppShell`: tutto lo scroll avviene **dentro `<main>`** (overflow-y-auto); il documento non scrolla mai
- `BottomNav` (solo `<lg`): 4 voci + bottone centrale "+" che apre la modale globale "Nuovo movimento" via `quickAddStore` (vedi [[Pagina Movimenti]] per il conto proposto)
- Safe-area iOS: variabili CSS `--safe-top/bottom/left/right` da `env(safe-area-inset-*)`; `viewport-fit=cover` in `index.html`

## Fix specifici iOS (2026-07-11)

Problemi osservati su iPhone 16 Pro (PWA standalone) e relativi rimedi:

1. **Auto-zoom sul focus degli input** (font < 16px ⇒ Safari zooma; lo zoom/pan a volte resta attivo: campi che "si sovrappongono", layout rotto) → `frontend/src/lib/ios-viewport.ts` imposta `maximum-scale=1` nel meta viewport **solo su iOS** (il pinch-zoom utente resta possibile; su Android lo stesso attributo lo bloccherebbe, per questo è via JS).
2. **BottomNav shiftata in alto con banda nera sotto** all'apertura dell'app (documento rimasto "pannato" dopo tastiera/riapertura; si sistemava trascinando con un dito) → doppio rimedio: `html, body { overflow: hidden; overscroll-behavior: none; }` in `index.css` + reset `window.scrollTo(0,0)` in `ios-viewport.ts` su focusout/pageshow/visibilitychange/resize del visualViewport (mai durante l'editing di un campo, per non nascondere l'input dietro la tastiera).
3. **Campi data iOS**: larghezza minima intrinseca (overflow/overlap in flex e grid) e testo centrato → normalizzati in `index.css` con `min-width: 0`, `-webkit-appearance: none` e `::-webkit-date-and-time-value { text-align: left }`.

`initIosViewportFix()` è chiamato in `frontend/src/main.tsx`.

## Consenso bancario: atterraggio fuori app su iOS

Il consenso PSD2 di [[Sync Bancario]] segue lo stesso vincolo standalone: la banca reindirizza l'utente su `/bank-sync/callback`, che su iPhone **apre in Safari**, non nella PWA installata (il flusso OAuth-like non può restare dentro la webview standalone). La pagina pubblica scambia subito `code`+`state` col backend e mostra un messaggio statico ("torna all'app"), **senza redirect automatico** verso la PWA (iOS non offre un modo affidabile per farlo). Il rientro nell'app è manuale; il wizard (`BankLinkWizard.tsx`) copre l'assenza di un evento di ritorno facendo **polling** su `GET bank-sync/connections/:id` ogni 2s finché lo stato non è più `pending`.

## Barra azioni fissa (`fm-actionbar`)

Pattern introdotto dalla pagina "Da confermare" di [[Sync Bancario]] per la selezione multipla (prima non esisteva un bulk-action bar nel repo): una barra `position: fixed` ancorata sopra la `fm-bottomnav`, agganciata al *visual viewport* dallo stesso glue di `lib/ios-viewport.ts` che compensa il pan residuo della BottomNav (punto 5 sopra) — stessa classe di problema (iOS standalone, tastiera/pan), stessa soluzione (`translateY` sul visual viewport invece che sul layout viewport). Rispetta le safe-area iOS come la BottomNav.

4. **Striscia nera residua sotto la BottomNav** (barra stabile ma sopra l'home indicator): se il layout viewport standalone termina sopra l'home indicator (config del viewport "fotografata" da iOS all'installazione della PWA), resta una fascia scoperta. Mitigazione CSS: `.fm-bottomnav::after` in `index.css` estende lo sfondo della barra 3rem oltre il bordo inferiore. Se la fascia è disegnata dal sistema FUORI dalla webview, il CSS non può coprirla: la soluzione è **rimuovere e reinstallare la PWA** dalla home screen (iOS ri-legge viewport-fit/status-bar all'installazione).
5. **BottomNav "incollata" al fondo visibile (v0.2.5)**: gli elementi `position: fixed` sono ancorati al *layout* viewport, ma su iOS standalone il *visual* viewport può restare pannato/accorciato dopo tastiera o riapertura → barra sospesa sopra il fondo (e con lo scroll bloccato non era più sistemabile trascinando; `scrollTo(0,0)` non aiuta perché lo scroll è già 0). Fix in `ios-viewport.ts`: misura `visualViewport.offsetTop + height − innerHeight` e compensa con `translateY` sulla `.fm-bottomnav` (rimosso quando l'offset è 0; sospeso durante l'editing per non interferire con la tastiera). Listener su resize/scroll del visualViewport, pageshow, orientationchange, focusout, visibilitychange + nudge `scrollTo(0,1)→(0,0)` all'avvio. Ripassate anche a 150ms/600ms/1800ms dall'avvio (oltre a quella immediata via `requestAnimationFrame`) per accorciare la finestra in cui la banda è visibile al cold start.

## Banda nera in basso — bug viewport iOS 26 e workaround (2026-08-16, risolto)

L'utente (iPhone 16 Pro) rivedeva la banda nera sotto la BottomNav: **presente dall'avvio** e **non risolta dal reinstallo** della PWA → esclusi il bug tastiera WebKit (viewport che resta ristretto dopo la prima tastiera, noto su iOS 17/18/26) e il letterbox "fotografato" all'installazione (punto 4 sotto). Config verificata corretta (`viewport-fit=cover` statico in `index.html`, `black-translucent`, manifest `standalone`; nota: il manifest effettivo è `manifest.webmanifest` generato da vite-plugin-pwa, NON `public/manifest.json`).

**Diagnosi** (numeri dalla card "Diagnostica schermo", v0.4.2, `ViewportDiagnosticsCard.tsx`): screen 402×874, `window.inner` 812, `100dvh/svh` 812 ma `100lvh` **874**, safe-area 62/34 → iOS 26 in standalone calcola i viewport small/dynamic sottraendo dal FONDO l'altezza della status bar (Δ 62px = safe-area-top), pur senza chrome dinamico; la banda è quindi DENTRO la webview e recuperabile.

**Il bug è BISTABILE**: dopo un rilancio il layout viewport può risanarsi (`inner`/`dvh` tornano 874) mentre **`svh` resta stantio a 812**. La prima versione del workaround (v0.4.3) misurava il delta come `svh−lvh` e in quello stato sovracorreggeva di 62px, spingendo la BottomNav sotto il fondo (icone tagliate). Il delta va misurato con **`dvh−lvh`** (v0.4.4): `dvh` segue il layout viewport live, quindi vale −62px nello stato bugged e **0px quando iOS è sano** — corretto in entrambi. Effetto collaterale accettato: a tastiera aperta `dvh` cala e il fix cresce, spingendo le barre fisse fuori schermo (durante l'editing sono comunque coperte).

**Workaround (v0.4.4)**: variabile CSS `--fm-lvh-fix: calc(100dvh - 100lvh)` definita solo in `@media (display-mode: standalone)` (0px su Android/desktop/browser e su iOS sani — verificato). Applicata a: shell `html/body/#root` (`height: calc(100dvh - var(--fm-lvh-fix))`, `index.css`), `bottom` di `.fm-bottomnav` (`BottomNav.tsx`) e `.fm-actionbar` (`BankReviewPage.tsx`, entrambe le varianti base e `lg:`), altezza di backdrop+drawer del `MobileMenu.tsx` e del `DialogOverlay` (`components/ui/dialog.tsx`). La card diagnostica mostra anche `#root effettivo` e il valore corrente del fix. **Da rimuovere quando Apple corregge il calcolo** (tenere d'occhio le release notes Safari/iOS 26.x).

## Fix ulteriori (2026-08-16)

- **Picker categorie inline nel dialog "Categoria" della coda di revisione (v0.4.1)**: il popover `disablePortal` di `CategoryPicker` dentro il piccolo `CategoryDialog` veniva tagliato dall'`overflow-y-auto` del `DialogContent` (introdotto in v0.4.0) — su iPhone con tastiera aperta il dialog si riduceva con il viewport (`max-h-[calc(100dvh-2rem)]`) e la lista risultava "tagliata e minuscola". Fix: prop `inline` su `CategoryPicker` (niente Popover: ricerca+lista nel flusso del Dialog reso `flex flex-col`; lista `min-h-28`/`max-h-72` che si adatta allo spazio, oltre il minimo scrolla il Dialog). Il rischio era stato annotato come "da controllare a vista" nella voce v0.4.0 qui sotto — confermato e risolto per questo dialog; `CategoryForm`/`AccountForm`/`TransactionForm` restano sul pattern popover (dialog alti, meno esposti).

- **Touch-scroll nei Popover dentro Dialog**: `IconPicker`/`ColorPicker` (`components/shared/`) non scrollavano su touch perché il loro `PopoverContent` era portato fuori dal sottoalbero del Dialog (bloccato da `react-remove-scroll`, stesso problema già risolto in `CategoryPicker`). Fix: `disablePortal` su tutti e tre → pattern documentato in [[Convenzioni di Sviluppo]].
- **`--fm-vv-offset`**: l'offset del visual viewport calcolato in `ios-viewport.ts` (punto 5 sopra) viene ora pubblicato anche come variabile CSS globale su `<html>` (azzerata quando l'offset è nullo o durante l'editing, stessa condizione del `translateY`). Usata da `MobileMenu.tsx` per aggiungere `calc(var(--safe-bottom) + var(--fm-vv-offset, 0px))` al padding-bottom del drawer, così l'ultima voce di navigazione (Impostazioni) non resta nascosta sotto la zona scoperta dal pan residuo.
- **Drawer mobile in portal** (`MobileMenu.tsx`): backdrop e `<aside>` sono renderizzati con `createPortal(document.body)`. Senza portal vivevano dentro la TopBar (`sticky z-20`), che come stacking context intrappolava i loro `z-40/z-50`: la BottomNav (`z-30`, contesto radice) copriva le ultime voci del menu. Regola generale: qualunque overlay full-screen dichiarato dentro TopBar/altre superfici con z-index va portato su `body`.
- **Banda nera residua più alta**: `.fm-bottomnav::after` (punto 4 sopra) esteso da 3rem a 6rem per coprire aree scoperte più ampie.
- **`theme-color` dinamico**: il meta `theme-color` (`index.html`) era statico; ora `applyTheme`/`applyUIChrome` (`store/uiStore.ts`, chiamate da `ThemeBootstrap` in `app/providers.tsx`) rileggono `--background` via `getComputedStyle` dopo ogni cambio di classe `dark`/`data-theme` e aggiornano (o creano) il meta tag, così la barra di stato segue dark/light e i colorTheme.
