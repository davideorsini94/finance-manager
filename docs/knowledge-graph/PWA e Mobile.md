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

4. **Striscia nera residua sotto la BottomNav** (barra stabile ma sopra l'home indicator): se il layout viewport standalone termina sopra l'home indicator (config del viewport "fotografata" da iOS all'installazione della PWA), resta una fascia scoperta. Mitigazione CSS: `.fm-bottomnav::after` in `index.css` estende lo sfondo della barra 3rem oltre il bordo inferiore. Se la fascia è disegnata dal sistema FUORI dalla webview, il CSS non può coprirla: la soluzione è **rimuovere e reinstallare la PWA** dalla home screen (iOS ri-legge viewport-fit/status-bar all'installazione).
5. **BottomNav "incollata" al fondo visibile (v0.2.5)**: gli elementi `position: fixed` sono ancorati al *layout* viewport, ma su iOS standalone il *visual* viewport può restare pannato/accorciato dopo tastiera o riapertura → barra sospesa sopra il fondo (e con lo scroll bloccato non era più sistemabile trascinando; `scrollTo(0,0)` non aiuta perché lo scroll è già 0). Fix in `ios-viewport.ts`: misura `visualViewport.offsetTop + height − innerHeight` e compensa con `translateY` sulla `.fm-bottomnav` (rimosso quando l'offset è 0; sospeso durante l'editing per non interferire con la tastiera). Listener su resize/scroll del visualViewport, pageshow, orientationchange, focusout, visibilitychange + nudge `scrollTo(0,1)→(0,0)` all'avvio.
