# Provider LLM OpenCode (Piano)

Piano per aggiungere **OpenCode** (API OpenAI-compatible: Go `https://opencode.ai/zen/go/v1` o Zen `https://opencode.ai/zen/v1`, auth Bearer `OPENCODE_API_KEY`) come **secondo provider LLM selezionabile** accanto a Ollama. La chiave e i modelli sono gestiti dalle Impostazioni (admin), i modelli selezionabili sono quelli effettivamente disponibili per la chiave configurata (`GET /v1/models`). Collegato a [[Chat LLM]], [[Import CSV-OFX]], [[Sync Bancario]], [[Database]], [[Infrastruttura Docker]].

> Rivisto dopo verifica avversariale (agente indipendente, 18 findings): i punti corretti sono integrati qui; coda "Assunzioni verificate / non verificate".

## Requisito di degrado (accettato esplicitamente)

Se il provider attivo è `opencode`, **nessuna chiamata a Ollama** può essere tentata in nessun punto del sistema: niente `ollama.list()`, niente healthcheck, niente badge "Server non raggiungibile", nessun log di warning. Il server Ollama spento con provider OpenCode attivo è uno stato **normale**, non un errore. Viceversa col provider `ollama` il comportamento attuale resta invariato. Ricognizione fatta: i soli punti che toccano Ollama sono `LlmChatService`, `LlmModelsService`, `CategoryAiService` (i costruttori `new Ollama()` non fanno I/O) — tutti coperti.

## Decisioni chiave

1. **API key in DB, cifrata at-rest** — pattern [[Database#SmtpConfig]] / `BankSyncConfig`: campo `opencodeApiKeyEncrypted` sul singleton `LlmConfig`, cifrato con `CryptoService` (AES-256-GCM, nuovo contesto `fm-opencode-v1`). NON in env (coerente con SMTP/BankSync: configurabile a runtime dall'admin, i backup restano sicuri). La chiave non viene mai restituita al client (`hasApiKey: boolean`, stile SMTP). **Guard obbligatorio**: se il decrypt fallisce (rotazione `JWT_ACCESS_SECRET`, backup da altra istanza) → `hasApiKey: false` + log warning, MAI 500: l'endpoint è aperto a tutti gli autenticati e la risoluzione del client di chat non deve rompersi.
2. **Port astratto del client LLM** — precedente: `bank-provider.port.ts`. Interfaccia `LlmClientPort` con due implementazioni (`OllamaClient`, `OpenCodeClient`) e un formato messaggi/chunk **neutro**; ogni client traduce nel proprio wire format. I consumatori (`LlmChatService`, `CategoryAiService`) non conoscono più il provider.
3. **Modelli OpenCode = `GET /v1/models` ∩ catalogo curato per-base-URL** — la lista del gateway include modelli serviti su endpoint diversi da `/chat/completions` (verificato su Go: `gpt-5.6-luna`/`grok-4.5` su `/responses`, `minimax-m3` su `/messages` — e `minimax-m3` **è presente** in `GET /v1/models` di Go: la sola intersezione non basta). Catalogo statico con voce `{ goId?, zenId?, endpoint, displayName, description }` (id diversi tra Go e Zen, es. `ox-alpha-free` vs `x-preview-f-free`): si filtra per il base URL attivo e si tengono solo le voci con `endpoint === '/chat/completions'` **per quel base URL**. Solo l'intersezione risultante è selezionabile.
4. **Stato provider-gated nelle impostazioni** — `GET /settings/llm` calcola il blocco `ollama` SOLO se provider attivo = `ollama`; il blocco `opencode` (con elenco modelli) SOLO se provider = `opencode` **e chiamante admin** (la GET è aperta a tutti: `hasApiKey` sì per tutti, la chiamata esterna a `/v1/models` no). Cache della lista ~5 min + refresh manuale; **invalidata da `setApiKey()`/`clearApiKey()`** (cambio subscription = cambio modelli).
5. **Base URL configurabile via env** — `OPENCODE_BASE_URL` (default Go `/zen/go/v1`; Zen = `/zen/v1`), `OPENCODE_MODEL` (default `kimi-k3`) come fallback d'ambiente, simmetriche a `OLLAMA_BASE_URL`/`OLLAMA_MODEL`. Passate dal compose ma senza `getOrThrow` (assenza tollerata).
6. **Modello per-provider**: colonne separate su `LlmConfig` — `model` (Ollama, oggi) + `opencodeModel String?` (nuova). Cambiare provider NON azzera la scelta dell'altro provider (niente perdita del modello Ollama scelto dall'admin).

## Formato neutro (interni)

```ts
// llm-client.port.ts
type NeutralRole = 'system' | 'user' | 'assistant' | 'tool';
interface NeutralMessage {
  role: NeutralRole;
  content: string | null;
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[]; // solo assistant
  toolCallId?: string; // solo role='tool'
}
interface LlmChunk { contentDelta?: string; toolCalls?: NeutralMessage['toolCalls']; }
interface LlmClientPort {
  chatStream(req: { model: string; messages: NeutralMessage[]; tools: ToolDef[]; temperature?: number; timeoutMs?: number }): AsyncGenerator<LlmChunk>;
  chatJson(req: { model: string; prompt: string; timeoutMs?: number }): Promise<string>;  // categorizzazione
  listModels(): Promise<string[]>;                                                          // id disponibili per la chiave
}
```

- **Contratto di emissione `toolCalls` (obbligatorio)**: emessi **esattamente una volta, nell'ultimo chunk del round**, completi (arguments già concatenati e `JSON.parse`-ati con fallback `{}`). Mai frammenti intermedi né duplicati — il loop esistente (`llm-chat.service.ts:204-217`) fa push a ogni chunk. I chunk con solo `finish_reason`/`usage`/delta vuoto NON emettono toolCalls.
- **Timeout distinti**: `chatJson` → deadline fisso 60s; `chatStream` → deadline ampio (≥600s, coerente con `proxy_read_timeout 600s` di nginx) e riapplicato per round del loop tool. `AbortSignal.timeout` è un deadline fisso, NON un timeout di inattività: non va mai applicato "generico" allo streaming.
- `OllamaClient`: involucro del codice odierno che **preserva** `keep_alive: '30m'` e il timeout 240s tarato su `headersTimeout` di undici (regressione CPU se persi: modello ricaricato a ogni batch) — costanti incapsulate nel client e documentate.
- `OpenCodeClient`: `fetch` nativo + `AbortSignal.timeout` (nessuna nuova dipendenza npm; Node 22 → fetch nativo OK). `POST /chat/completions` con `stream:true`; parser SSE difensivo (`data: {...}` / `data: [DONE]`, più eventi per chunk TCP, payload d'errore). **Tool_calls in streaming a frammenti** (primo chunk con `id`+`function.name`, poi pezzi di `function.arguments` stringa, `""`/`null` sul primo frammento) → accumulo per indice, parse finale. Mapping wire: assistant con tool_calls → `{role:'assistant', content, tool_calls:[{id, type:'function', function:{name, arguments: JSON.stringify(obj)}}]}`; tool → `{role:'tool', tool_call_id, content}` (il campo esce solo dal client opencode). La history persistita in DB filtra già i messaggi `tool` (llm-chat.service.ts:170) → nessun problema di pairing `tool_call_id` sulla history.
- chatJson → `response_format: {type:'json_object'}` (il prompt contiene già "JSON"); **se il modello risponde 400 al flag: retry senza flag + log warning** — non "eventuale", altrimenti la categorizzazione AI potrebbe non funzionare mai senza segnale.
- Errori mappati in italiano: 401 "Chiave API non valida", 429 "Limite raggiunto, riprova tra poco", 404 modello, timeout/rete → `ServiceUnavailableException`.

## Modifiche backend

1. **`backend/prisma/schema.prisma`** — enum `LlmProvider { ollama opencode }`; su `LlmConfig`: `provider LlmProvider @default(ollama)`, `opencodeModel String?`, `opencodeApiKeyEncrypted String?`. `prisma db push --accept-data-loss` all'avvio applica lo schema (colonne nullable con default = nessun data loss). **Attenzione rollback**: riattivare un'immagine vecchia esegue db push con lo schema precedente e **cancella** le nuove colonne — da documentare in [[Deploy e Versioning]] (backup DB prima del rollback; perdita = solo config LLM, accettata e nota).
2. **`backend/src/common/services/crypto.service.ts`** — contesto `fm-opencode-v1`.
3. **`backend/src/llm-chat/llm-config.service.ts`** — `getActiveConfig()` → `{ provider, model, modelSource: 'db'|'env', hasApiKey }` (cache in-process come oggi; invalidata da tutti i setter, dal restore backup e da `setApiKey`/`clearApiKey`); model = `opencodeModel` o `model` a seconda del provider; fallback env `OLLAMA_MODEL`/`OPENCODE_MODEL` (default `kimi-k3`); decrypt chiave in try/catch (vedi decisione 1).
4. **Nuovi file in `backend/src/llm-chat/`** — `llm-client.port.ts`, `clients/ollama-client.ts`, `clients/opencode-client.ts`, `clients/opencode-sse.ts` (parser puro, testabile), `clients/opencode-catalog.ts` (catalogo curato per-base-URL), `llm-client.factory.ts` (sceglie il client dall'`getActiveConfig()`).
5. **`llm-chat.module.ts`** — `LlmClientFactory` negli **exports** (serve a `ImportsModule` → `CategoryAiService`), oltre a `LlmConfigService`.
6. **`llm-chat.service.ts`** — via `new Ollama({... getOrThrow('OLLAMA_BASE_URL') })` dal costruttore (oggi **crasha all'avvio** se la var manca); history in formato neutro, client risolto per-richiesta. Loop tool (6 round), salvataggi e titolo invariati.
7. **`imports/category-ai.service.ts`** — usa la factory: `chatJson` col provider attivo; fallback euristico invariato su qualunque errore (chiave assente/rete/429); niente più `available()` basato su Ollama (diventa `(provider==='ollama' && ollama raggiungibile) || (provider==='opencode' && chiave presente)`).
8. **`llm-models.service.ts` + `llm-settings.controller.ts` + `dto/llm-settings.dto.ts`**:
   - `GET /settings/llm` → `{ provider, activeModel, modelSource, hasApiKey, ollama: {serverOk, installed} | null, opencode: {baseUrl, models, fetchOk, fetchError} | null }` — blocchi calcolati secondo la regola provider-gated della decisione 4.
   - `PUT /settings/llm` (admin, `@Throttle` come SMTP) body `{ provider?, model?, apiKey? }` — semantica apiKey tipo SMTP: `undefined` = invariato, stringa non vuota = imposta, `null` = rimuovi. Validazione chiave: `GET /v1/models` di prova — **401 → rifiuta** con messaggio dedicato; **429/rete → salva comunque con warning** ("non verificata, controlla dopo"; l'admin offline non deve restare bloccato e un 429 non va spacciato per errore di rete). `model` → deve appartenere all'insieme disponibile del provider; `provider` → valida che il modello del provider di destinazione sia coerente (colonne separate, nessun azzeramento).
   - Endpoint Ollama (`catalog`, `pull-status`, `models/pull`, `DELETE models/:name`): restano con guard nel service — `409 ConflictException` "Operazione disponibile solo con provider Ollama". **In più, `setActiveProvider('opencode')` annulla un eventuale pull job detached in corso** (segnato non-attivo e lasciato morire sul suo loop): altrimenti `runPull` continuerebbe a chiamare Ollama per minuti, violando il requisito di degrado.

## Modifiche frontend

1. **`features/settings/llmApi.ts`** — tipi `LlmSettings`/`LlmSettingsInput` nuovi (shape sopra), `updateSettings()`, `removeApiKey()`.
2. **`features/settings/LlmSettingsCard.tsx`** — riscrittura (non "UI invariata": la shape GET cambia, `serverOk`/`installed`/`source` si spostano in `settings.ollama.*`). Segmented control provider ("Ollama (locale)" / "OpenCode (cloud)"); se opencode: input API key password-style con badge "salvata" e placeholder `•••••••• (lascia vuoto per non cambiarla)` (pattern `SmtpSettingsCard`), pulsante "Rimuovi chiave" con `useConfirm`, picker modello da `opencode.models` + "Aggiorna elenco", nota privacy "I dati vengono inviati a un servizio esterno"; se ollama: sezione attuale (catalogo/pull/elimina) ri-plumbata sulla nuova shape, **query `catalog`/`pull-status` con `enabled: provider === 'ollama'`**. Nessun badge "Server non raggiungibile" quando il provider attivo non è Ollama.
3. **`features/chat/ChatPage.tsx`** — badge `ExamplePrompts` dinamico: "Locale · Ollama — I dati restano sul tuo server" vs "Cloud · OpenCode — I dati vengono inviati a un servizio esterno".
4. **`lib/demo/handlers.ts`** — mock estesi: stato provider, chiave (hasApiKey), elenco modelli opencode statico, `demoSelectProvider`/`demoSetApiKey`; invariati i mock del pull Ollama.

## Infrastruttura e documentazione

- **`docker-compose.yml`** — al backend: `OPENCODE_BASE_URL: ${OPENCODE_BASE_URL:-https://opencode.ai/zen/go/v1}`, `OPENCODE_MODEL: ${OPENCODE_MODEL:-kimi-k3}`. Servizio `ollama` con **`profiles: ["ollama"]`**: con la routine di deploy standard (`docker compose up -d`) Ollama NON parte (oggi `restart: unless-stopped` + `up -d` lo riavvierebbe sempre, con auto-pull del modello a ogni avvio: lo stop manuale sarebbe fragile). Chi usa Ollama avvia con `docker compose --profile ollama up -d`. **Cambio di default per gli installati esistenti** → documentato in MANUALE e [[Deploy e Versioning]] (il rollback della sola immagine non tocca il compose: con provider ollama attivo l'app mostra "server non raggiungibile", stato già gestito oggi).
- **`.env.example`** — commento sulle nuove variabili (opzionali) + nota che la chiave API **non** va in env ma si configura dalla UI.
- **`docs/MANUALE.md`** — sezione "Modelli AI (Ollama / OpenCode)": scelta provider, inserimento chiave (opencode.ai/auth), nota privacy, **tabella dei limiti per-modello della subscription** (es. kimi-k3 ≈110 richieste/5h: un import CSV da 100 righe in batch da 8 = 13 richieste, una chat con 2 round tool = 3 richieste — i limiti si raggiungono in fretta; alternative ad alta allowance su `/chat/completions` come `longcat-2.0`/`mimo-v2.5`).
- **Knowledge graph** — aggiornare [[Chat LLM]], [[Database]], [[Import CSV-OFX]], [[Infrastruttura Docker]], [[API]], [[Deploy e Versioning]] (rollback/colonne) + riga in [[Registro Modifiche]]; questa nota linkata dalla hub.

## Test

Non esistono test LLM oggi (solo `auth.e2e-spec.ts`); si aggiungono unit test mirati (jest, `rootDir: src`):
- `opencode-sse.spec.ts` — parser SSE: chunk divisi a metà riga, più `data:` per evento TCP, `[DONE]`, payload di errore, accumulo tool_calls frammentati (indice, name, arguments concatenati, `""`/`null` sul primo frammento), chunk con solo `finish_reason`, `JSON.parse` degli arguments con fallback.
- `opencode-catalog.spec.ts` — filtro per base URL: voce presente in `/v1/models` ma su `/responses` o `/messages` esclusa; id Zen vs Go non confusi; id sconosciuti ignorati; parsing difensivo della shape di `/v1/models` (accetta `{data:[{id}]}` o array puro).
- `llm-config.service.spec.ts` — risoluzione provider/modello per-provider, set/clear chiave, decrypt fallito → `hasApiKey: false` senza eccezioni, invalidazione cache.

Checklist manuale e2e: commutazione provider con Ollama fermo (nessun errore ovunque, chat e categorizzazione OK) · chiave non valida → 401 rifiutata al salvataggio · chiave rimossa → chat con messaggio chiaro, categorizzazione su euristica · rete giù → salvataggio chiave con warning · stream chat con tool call su OpenCode · categorizzazione import e sync bancario con provider OpenCode · pull job in corso annullato al cambio provider · restore backup invalida la cache.

## Fasi e stima

| Fase | Contenuto | Stima |
|---|---|---|
| 0 | **Spike di verifica API** (curl con la chiave reale): shape `GET /v1/models` su Go/Zen, streaming SSE con tool call, `response_format: json_object`, un 401/429 — le assunzioni non documentate vanno chiuse qui | 0,25 gg |
| 1 | Schema Prisma + `CryptoService` + `LlmConfigService` esteso | 0,5 gg |
| 2 | Port + `OllamaClient` (refactor preservando keep_alive/timeout) + factory + swap consumatori + exports modulo | 1 gg |
| 3 | `OpenCodeClient` + parser SSE + catalogo per-base-URL | 0,5 gg |
| 4 | Endpoint settings (GET/PUT + guard + annullo pull) + DTO | 0,5 gg |
| 5 | Frontend (card riscritta, api, demo handlers, badge chat) | 1 gg |
| 6 | Compose (profiles) + env, MANUALE, grafo, test, deploy ([[Deploy e Versioning]]) | 0,5 gg |

Totale **~4,25 giorni** con margine.

## Rischi noti

- **Limiti della subscription Go** (verificati: kimi-k3 110 richieste/5h, 250/settimana, 490/mese): sorvegliare i 429; per volumi alti modello ad alta allowance o Zen (pay-per-use).
- **Privacy**: cambio di modello dati (esterni a un servizio cloud) — reso esplicito in UI e MANUALE.
- **Rotazione `JWT_ACCESS_SECRET`** invalida la chiave OpenCode cifrata (stesso limite già documentato per SMTP/BankSync) → gestito con guard `hasApiKey: false`.
- **Rollback immagine** → db push cancella le nuove colonne (config LLM persa, accettata e documentata in [[Deploy e Versioning]]).

## Esito verifica avversariale — assunzioni

- **Verificate vere**: base URL Go/Zen; endpoint per-modello su Go (kimi-k3 su `/chat/completions`, gpt-5.6-luna/grok-4.5 su `/responses`, minimax-m3 su `/messages`); esistenza `GET /v1/models`; limiti subscription Go; `llm-chat.service.ts:29` crasha all'avvio senza `OLLAMA_BASE_URL`; `backup.service.ts` invalida già la cache; history DB filtra i messaggi `tool` (nessun problema `tool_call_id`); `ChatMessage` senza `toolCallId`; backup esporta `llmConfig` (i nuovi campi viaggiano gratis); `prisma db push` con colonne nullable+default non perde dati; Node 22 fetch nativo; nessuna dipendenza npm nuova necessaria.
- **Non verificabili via doc** (chiuse dalla Fase 0): "stessa chiave" Go/Zen; shape esatta di `GET /v1/models`; formato SSE/tool_calls frammentati del gateway; supporto `tools` e `response_format` su kimi-k3 via gateway.
- **Corretta un'assunzione falsa**: l'intersezione con `/v1/models` non basta a escludere modelli su altri endpoint (minimax-m3 è nella lista Go pur essendo su `/messages`) → catalogo per-base-URL con campo `endpoint`.
