# Report LLM nella pagina Report — design

Data: 2026-08-31 · Versione target: v0.10.0

## Obiettivo

Nella pagina `/reports` compare una sezione con un **report scritto dall'LLM
attivo** (quello scelto in Impostazioni) sul periodo selezionato. Il report è
salvato a DB per non essere rigenerato ogni volta che si torna sullo stesso
periodo, si genera **da solo** alla prima apertura di un periodo che non ce
l'ha, e può essere **rigenerato a mano** con conferma esplicita (la
rigenerazione sovrascrive quello esistente).

Vincolo forte richiesto: **durante la generazione il pulsante non deve essere
ripremibile**, nemmeno uscendo e rientrando nella pagina, e deve essere
evidente che il lavoro è in corso (animazione di caricamento).

## Decisioni prese

| Domanda | Scelta |
|---|---|
| Modalità coperte | **Annuale + Mensile**. "Confronto periodi" resta senza report |
| Chiave del report | **periodo + conti selezionati** (il testo corrisponde ai numeri a schermo) |
| Generazione automatica | **lazy**: alla prima apertura di un periodo senza report |
| Dati cambiati dopo la generazione | badge **"non aggiornato"**, nessuna rigenerazione automatica |

## Architettura

Job **detached** lato backend con **stato persistito a DB**, polling dal
frontend.

Perché non in memoria come il download modelli di `llm-models.service.ts`: uno
stato in RAM sparisce al riavvio del backend e non è condiviso tra dispositivi,
quindi il pulsante tornerebbe premibile su un lavoro fantasma. Perché non in
streaming SSE come la chat: uscendo dalla pagina lo stream muore e il report è
perso — l'opposto del requisito.

### Modello dati (Prisma)

```
enum LlmReportStatus { generating, ready, error }

model LlmReport {
  id              String
  userId          String
  scope           String   // 'annual' | 'monthly'
  periodKey       String   // '2026' | '2026-07'
  accountsKey     String   // 'all' | sha1 degli accountId ORDINATI
  status          LlmReportStatus
  content         String?  // markdown
  provider        String?  // 'ollama' | 'opencode'
  model           String?
  dataFingerprint String?  // "txCount:incomeCents:expenseCents"
  errorMessage    String?
  startedAt       DateTime
  completedAt     DateTime?

  @@unique([userId, scope, periodKey, accountsKey])
}
```

`accountsKey` è un hash dell'elenco **ordinato**: l'ordine in cui si spuntano i
conti non deve moltiplicare le righe. "Nessun filtro" è il valore letterale
`all`, distinto dall'hash di una selezione che per caso contiene tutti i conti.

### Lock

Il vincolo `@@unique` **è** il lock. La claim è un `updateMany` condizionale
(`where: { ..., status: { not: generating } }`): è atomico lato Postgres, quindi
due click simultanei da due dispositivi non producono due generazioni. Chi perde
riceve **409**.

**Lock scaduto**: un record `generating` con `startedAt` più vecchio di 15
minuti è considerato morto (backend riavviato a metà) e può essere riclaimato;
altrimenti quella cella resterebbe bloccata per sempre. La finestra è più larga
del tetto di una singola chiamata LLM (240s) per non uccidere un job vivo ma
lento.

### Collocazione del modulo

Modulo NestJS **autonomo** `backend/src/llm-reports/`, non una sottocartella di
`reports/`: `LlmChatModule` importa già `ReportsModule` (i tool della chat
leggono i report), quindi far dipendere `ReportsModule` da `LlmChatModule`
creerebbe un ciclo. `LlmReportsModule` importa entrambi e non è importato da
nessuno — nessun ciclo, nessun `forwardRef`. Le rotte restano sotto
`reports/llm` (`@Controller('reports/llm')`).

### Endpoint

- `GET /reports/llm?scope=&year=&month=&accountIds[]=` — sola lettura, nessun
  effetto collaterale. Risposta:
  `{ status: 'missing'|'generating'|'ready'|'error', content?, generatedAt?,
     provider?, model?, stale?, elapsedSeconds?, errorMessage? }`
- `POST /reports/llm/generate` body `{ scope, year, month?, accountIds?, force? }`
  → **202** `{ status: 'generating' }`
  → **409** se una generazione è già in corso
  → **409** se esiste già un report e manca `force: true`

La generazione automatica è innescata dal **frontend** quando il GET risponde
`missing`: il GET resta puro (un GET che scatena lavoro e costi è una trappola
per prefetch, retry e polling).

### Prompt

Costruito da dati **aggregati**, già disponibili in `ReportsService`:

- totali del periodo (`periodTotals`)
- serie mensile (annuale) o giornaliera (mensile)
- alberi categorie uscite **e** entrate (`categoryBreakdownTree`)
- totali del **periodo precedente** (anno/mese prima) per il confronto
- i **15 movimenti più grandi** del periodo, per poter segnalare anomalie

Niente dump di tutte le transazioni: costo in token e superficie privacy.
Chiamata **non in streaming** che rispetta il provider attivo, con lo stesso
schema di `CategoryAiService` (Ollama `chat` con `keep_alive`, oppure
`OpencodeClient.chat` senza `temperature`). Tetti di tempo per singola chiamata:
**240s** su Ollama (sotto i 300s di `headersTimeout` di undici, altrimenti a
scadere è il fetch di Node con un opaco "fetch failed") e **120s** su OpenCode
(già dentro `OpencodeClient.chat`). Sono entrambi ben sotto i 15 minuti del lock
scaduto, così un job vivo non viene mai riclaimato. In caso di fallimento lo
stato diventa `error` con messaggio parlante — **nessun fallback silenzioso**.

Output richiesto: markdown in italiano, sezioni fisse *Sintesi · Andamento ·
Dove sono finiti i soldi · Cosa mi ha colpito · Consigli*.

### Frontend

`features/reports/LlmReportCard.tsx` + `features/reports/reportsLlmApi.ts`.
Card inserita **subito sotto le card KPI** di annuale e mensile: l'animazione si
deve vedere senza scrollare.

Stati:

- **generating** — se esiste un report precedente resta visibile in trasparenza
  (la rigenerazione non lascia la pagina vuota); altrimenti skeleton con
  shimmer. In entrambi i casi `Loader2` che gira, cronometro
  "in generazione da 1m 12s", pulsante **disabilitato**. Polling React Query
  `refetchInterval: 3s` solo mentre è `generating`, più `refetchOnWindowFocus`:
  rientrando nella pagina si ritrova l'animazione, non il pulsante.
- **missing** — parte la generazione automatica, una sola volta per chiave; un
  409 da un'altra tab viene assorbito passando in polling.
- **ready** — markdown con l'hardening già usato in chat (immagini rimosse,
  link resi testo inerte): il report può contenere causali bancarie non fidate.
  `MARKDOWN_COMPONENTS` viene spostato da `ChatPage.tsx` a
  `components/shared/markdown.tsx` per non duplicarlo.
- **error** — messaggio dell'errore + pulsante Riprova.
- **stale** — badge "dati cambiati dopo la generazione" accanto a **Rigenera**.

**Rigenera** passa da `useConfirm()` con `destructive: true`: la modale dice che
il report esistente viene sovrascritto e non è recuperabile (mai
`window.confirm`, da convenzioni di progetto).

Handler demo in `lib/demo/handlers.ts` per entrambi gli endpoint.

## Fuori scope

Report per il "Confronto periodi"; notifica push a generazione finita;
rigenerazione automatica quando i dati cambiano.

## Limite noto

Il `dataFingerprint` (totali + conteggio) non vede una modifica che lascia i
totali identici — per esempio il cambio di categoria di un movimento. In quel
caso il badge "dati cambiati" non si accende.

## Test e verifica

Spec Jest sulla logica pura, senza DB: `accountsKey` stabile all'ordine,
`periodKey`, fingerprint, decisione di riclaim del lock scaduto, costruzione del
prompt. Poi `npm run build` e `lint` su backend e frontend.
