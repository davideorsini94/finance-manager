# Pagina Movimenti

Route `/transactions` — file `frontend/src/features/transactions/TransactionsPage.tsx`. La pagina più usata dell'app. Vedi [[Frontend]] per il contesto.

## Struttura

1. **Card riepilogo conti** in alto (scroll orizzontale con snap): una `AccountSummaryCard` per conto con icona, tipo e saldo
2. **Filtri**: ricerca testo, conto, categoria, date da/a — stato locale `filters` (`ListTransactionsParams`), ogni cambio filtro riporta a pagina 1
3. **Lista movimenti** paginata (10/25/50/100 per pagina) con anteprima allegati/edit/delete per riga
4. **`TransactionForm`** (modale) per creazione/modifica

## Comportamenti chiave

- **Card conti cliccabili (2026-07-11)**: click su una card = filtro per quel conto; secondo click sulla stessa = rimuove il filtro. Tutte le card restano visibili anche con filtro attivo (cambiare conto è un solo click). La selezionata è evidenziata con **outline** (NON ring: nel tema glass `fm-glass` sovrascrive il box-shadow e il ring sparirebbe) e le altre sono attenuate (`opacity-50 saturate-50`). Le card sono `<button>` con `aria-pressed`.
- **Dropdown conto con label esplicita**: la `SelectValue` di Radix non risolve il nome dell'opzione se il menu non è mai stato aperto (es. filtro impostato via card) — la label del trigger è quindi renderizzata esplicitamente come children di `SelectValue`.
- **Conto proposto nel form**: in creazione la priorità è 1) conto del filtro attivo, 2) `favoriteAccountId` dell'utente, 3) primo conto (logica in `TransactionForm.tsx`). Il form locale riceve `defaultAccountId={filters.accountId}`.
- **Quick-add mobile (2026-07-11)**: il "+" della `BottomNav` apre la modale globale in `AppShell` (`GlobalQuickAdd`), che NON è il form locale della pagina. Per proporre il conto filtrato anche lì, la pagina sincronizza `filters.accountId` in `quickAddStore.defaultAccountId` (useEffect, azzerato all'unmount). Nota: `components/shared/QuickAddSheet.tsx` è **legacy e non usato** — il flusso reale passa da `TransactionForm`.
- **Anteprima allegati dalla riga (2026-09-01)**: quando `tx.attachments.length > 0` la riga mostra un bottone "occhio" prima di Modifica, che apre `AttachmentPreviewDialog` con **tutti** gli allegati del movimento (navigazione con frecce se sono più di uno). I metadati arrivano già dentro `GET /transactions` (`tx.attachments`), quindi non serve nessuna chiamata in più per decidere se mostrare il bottone. Lo stato del dialog è **locale alla riga**: il dialog chiuso non renderizza nulla e il download del binario parte solo all'apertura, quindi montarne uno per riga non costa. Il badge graffetta col numero resta dov'era. Dettagli del visualizzatore in [[Frontend]] → Allegati.
- **Eliminazione**: i transfer si eliminano in coppia (`removeTransfer`); le invalidazioni React Query usano `refetchType: 'all'` per aggiornare anche dashboard/budgets/goals non montati.

## Collegamenti

- Endpoint e filtri lato server → [[API]] (Transactions)
- Giroconti e modello dati → [[Database]]
- Problemi/fix layout mobile → [[PWA e Mobile]]
