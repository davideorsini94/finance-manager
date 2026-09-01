# Frontend

SPA React 19 + Vite + TypeScript in `frontend/`. UI Tailwind + shadcn/ui (Radix), routing TanStack Router, server-state TanStack Query, UI-state Zustand, grafici Recharts, form React Hook Form + Zod, i18n i18next (IT/EN), HTTP client ky.

## Struttura

- `frontend/src/app/router.tsx` — definizione route
- `frontend/src/features/<dominio>/` — una cartella per feature: pagina + `<dominio>Api.ts`
- `frontend/src/components/layout/` — AppShell, Sidebar (desktop), BottomNav (mobile), TopBar, CommandSearch (Cmd+K), NotificationBell, UserMenu
- `frontend/src/components/ui/` — primitive shadcn/ui (button, card, input, select, …)
- `frontend/src/store/` — store Zustand globali
- `frontend/src/lib/` — client API, utils, demo mode, PWA, fix piattaforma
- `frontend/src/index.css` — temi (CSS variables), utility `fm-*`, regole globali iOS (vedi [[PWA e Mobile]])

## Route principali

`/` [[Pagina Dashboard]] · `/accounts` Conti · `/categories` Categorie · `/transactions` [[Pagina Movimenti]] · `/budget` Budget · `/recurring` Ricorrenze · `/goals` Obiettivi · `/reports` (+ `/reports/advanced`) [[Pagina Report]] · `/projections` Proiezioni · `/chat` [[Chat LLM]] · `/import` (+ wizard, templates) [[Import CSV-OFX]] · `/settings` Impostazioni · `/login`, `/accept-invite`, `/reset-password` (pubbliche)

## Store globali (Zustand)

- `store/uiStore.ts` — tema, preferenze UI
- `store/quickAddStore.ts` — apertura della modale globale "Nuovo movimento" (usata dal FAB della BottomNav) **e** `defaultAccountId`: il conto da proporre in creazione, impostato dalla [[Pagina Movimenti]] quando è attivo un filtro per conto. La modale globale vive in `AppShell.tsx` (`GlobalQuickAdd`).

## Allegati (upload e anteprima)

- `components/shared/AttachmentUploader.tsx` — dropzone + lista allegati dentro il form movimento (`transactions/:id/attachments`)
- `components/shared/AttachmentPreviewDialog.tsx` — **il** visualizzatore: riceve una lista di `AttachmentSummary` e naviga tra loro (frecce + contatore "N di M"), con bottone **Download** in testata e link "Apri in nuova scheda". Usato sia dalla riga della [[Pagina Movimenti]] sia da `InlinePreview`
- `components/shared/InlinePreview.tsx` — wrapper sottile: solo il bottone "occhio" che apre il dialog su un singolo allegato (riga dell'uploader)
- `components/shared/PdfPreview.tsx` — rendering PDF su **canvas** con `react-pdf`/pdf.js, tutte le pagine impilate. Riceve un **`Blob`** (non una URL, vedi sotto). Caricato in `React.lazy` → chunk separato (~374 kB), pdfjs non entra nel bundle principale

Punti da non rompere:

- **Il binario si scarica con `fetch` → `Blob` → `blob:` URL**, non si passa la URL dell'API a `<img>`/`<iframe>`: le presigned di MinIO puntano all'hostname interno docker (vedi [[Backend]]). Safari a volte non popola `blob.type`, quindi il MIME viene riforzato dal `Content-Type` della risposta.
- **A pdf.js si passa il `Blob`, mai il `blob:` URL** (v0.15.1). react-pdf con una stringa la gira a pdf.js come `url`; pdf.js per gli schemi diversi da http(s) usa XHR, e quella richiesta ricade sotto `connect-src` della CSP di nginx, che è `'self'` e non comprende `blob:` → richiesta bloccata, `status` 0, "Unexpected server response (0) while retrieving PDF". Con un `Blob` react-pdf legge in memoria (FileReader → ArrayBuffer) e pdf.js non fa richieste. Il `blob:` URL resta, ma solo per `<img>`, download e "apri in nuova scheda" (coperti da `img-src blob:`). Si vede **solo dietro nginx**: in `vite dev` non c'è CSP.
- **Niente `<iframe src="blob:…">` per i PDF**: dentro la PWA standalone su iOS (WebKit + service worker) resta bianco — è il motivo per cui esiste `PdfPreview`. Vedi [[PWA e Mobile]].
- **Il worker di pdf.js è importato con `?worker&url`**, non `?url`: così Vite emette un file `.js`. Con `.mjs` nginx 1.27 non ha la voce in `mime.types` e lo servirebbe come `application/octet-stream` → il browser rifiuta di avviare il Worker (rotto solo in produzione). Il worker resta same-origin, quindi la CSP `default-src 'self'` va bene così com'è.
- `react-pdf` è in `optimizeDeps.include` (`vite.config.ts`): essendo importato solo in lazy, altrimenti Vite lo pre-bundla in una seconda passata con una copia di React diversa → "Invalid hook call" in dev.

## Pattern

- Mutazioni → `queryClient.invalidateQueries` con `refetchType: 'all'` per aggiornare anche le query inattive (dashboard, budgets, goals…)
- Layout mobile-first, breakpoint `lg` per il layout desktop (Sidebar vs BottomNav)
- Temi multipli via `data-theme` (default / glass / fintech) con utility `fm-glass`, `fm-chrome`, blob animati
- Privacy mode: blur degli importi via `data-privacy='on'`
- Vedi anche [[Convenzioni di Sviluppo]] e [[PWA e Mobile]]
