# Chat LLM

Chat con LLM per interrogare i propri dati finanziari. Route `/chat` ([[Frontend]], `features/chat/`), backend `backend/src/llm-chat/`.

## Provider (2, mutuamente esclusivi)

1. **Ollama (locale)** — default, servito dal container `ollama` ([[Infrastruttura Docker]], auto-pull all'avvio, limite 8 GB RAM)
2. **OpenCode (cloud)** — OpenCode Zen/Go (`opencode.ai/zen/v1` e `opencode.ai/zen/go/v1`, API OpenAI-compatible, endpoint universale `chat/completions` per tutti i modelli). Serve una **API key** dell'utente, cifrata at-rest (contesto `fm-opencode-v1` in `CryptoService`). Con questo provider **Ollama non viene mai contattato** (spento/irraggiungibile non manda in errore chat né categorizzazione).

### Provider e modello attivi configurabili a runtime
Scelta admin in Impostazioni (`frontend/src/features/settings/LlmSettingsCard.tsx` + `llmApi.ts`, backend `backend/src/llm-chat/{llm-settings.controller,llm-models.service,llm-config.service}.ts`), persistita sul singleton `LlmConfig` (DB, [[Database]]). `LlmConfigService.getActiveConfig()` è chiamato a ogni richiesta (chat e categorizzazione import) e cachato in-process, invalidato da ogni `set*` e dal restore backup.

- **Ollama**: `model` a NULL → fallback su `OLLAMA_MODEL` d'ambiente; selezione solo tra modelli installati, download dal catalogo statico allowlist (`llm-catalog.ts`, 6 tag, `ollama.pull` come job detached con polling `GET /settings/llm/pull-status`).
- **OpenCode**: al salvataggio della chiave (`PUT /settings/llm/opencode/key`) il backend la **prova su entrambe le tier** (`opencode.client.ts#probeTier`, micro-chiamata a `chat/completions`) e memorizza `opencodeTier` — così **i modelli mostrati corrispondono alla tipologia di chiave** (Zen o Go). L'elenco è letto a runtime da `GET /models` della tier (pubblico) ed arricchito con **costo** ($/1M token in/out) e **qualità** (giudizio curato) dalla mappa statica `opencode-catalog.ts`; i modelli fuori mappa sono comunque elencati senza prezzo. Selezione modello admin-only, validata contro la mappa (allowlist). Endpoint: `GET /settings/llm/opencode/models`, `PUT /settings/llm/opencode/model`, `POST /settings/llm/opencode/test`, `DELETE /settings/llm/opencode/key`.

#### `GET /models` non dice quali modelli funzionano
Il gateway elenca anche modelli che poi **non sa servire** con la chiave data: 500 "Internal server error", 503 "Endpoint is unavailable", 400 "Unsupported model", 403 (opt-in richiesto). Sceglierne uno lasciava la chat muta a ogni messaggio. Due difese:
- `OpencodeClient.probeModel(tier, key, model)` — micro-chiamata da 1 token; `LlmModelsService.selectOpencodeModel()` la usa e **rifiuta il salvataggio con 400** se il gateway non serve il modello, così l'errore si vede quando l'admin sceglie e non a ogni chat
- `gatewayError()` in `opencode.client.ts` — l'errore mostrato all'utente **nomina il modello** e dice cosa fare, invece del nudo "Internal server error"

Stato verificato il 2026-08-24 sulla tier **Go**: 23 modelli su 30 funzionanti (tool calling incluso); non serviti `gpt-5.6-luna`, `minimax-m2.7` (500), `grok-4.5` (503), `hy3-preview`, `mimo-v2-pro`, `mimo-v2-omni` (400), `muse-spark-1.2-contributor` (403 opt-in). Modello consigliato dal catalogo e in uso: `deepseek-v4-flash`.

### Chat
- Streaming risposta via **SSE** su `POST /chat/sessions/:id/messages` (nginx con buffering disattivato). Gli eventi possono trasportare anche **stato di lavoro** (`ChatStreamEvent`: `{status:'tool', tool}` emesso prima di ogni tool call) così la UI mostra "sto consultando le tue transazioni…" invece di un puntino statico
- **Watchdog anti-appeso**: lo stream OpenCode viene abortito se non produce NESSUNA riga per 120s **o non produce output reale** (contenuto/tool/ragionamento) per 120s (i delta vuoti non contano: copre i modelli reasoning che "pensano" all'infinito), con tetto assoluto di 8 min per chiamata e errore parlante "OpenCode non ha risposto in tempo (Ns senza una risposta)". C'è anche un fallback non-SSE (se il gateway risponde con un singolo JSON) e la **rilevamento risposta vuota** in `llm-chat.service.ts` (nessun token generato → errore visibile, non silenzio). Client-side c'è un backstop a 130s. Il `reasoning_content` dei modelli reasoning viene inoltrato come `status:'thinking'` (throttlato a 2s) così la UI mostra "sto ragionando…"
- **Tool calling sicuro**: il backend espone al modello tool sui dati (transazioni, saldi, …) iniettando lo `userId` server-side — il modello non può leggere dati di altri utenti ([[Autenticazione e Sicurezza]])
- Loop tool-calling unico per entrambi i provider (`llm-chat.service.ts`): storia in formato neutro `ChatTurn`, convertita per-provider a ogni round (`toOllamaMessage`/`toOpenAiMessage`); per OpenCode i delta incrementali dei tool call (index + arguments spezzati) vengono accumulati. Per OpenCode **non si passa `temperature`** (alcuni modelli reasoning la rifiutano). Configurazione di stream Ollama: temperature 0.2, num_ctx 8192
- Persistenza in `ChatSession`/`ChatMessage` ([[Database]])
- **L'errore non va cancellato a stream finito.** `ChatPage#onSend` chiamava `stream.reset()` dopo `await stream.send(...)` e `reset()` azzerava anche `error`: il banner d'errore veniva cancellato nello stesso istante in cui era impostato → chat muta, sintomo "scrivo e non risponde, non capisco se va in errore". Ora a stream finito si chiama `clearPending()` (svuota solo `pending`/`working`); il `reset()` completo è legato al **cambio conversazione** (`useEffect` su `activeId`), così un errore non resta appeso sotto un'altra chat. Questo era il vero motivo dei "blocchi" che v0.9.1 e v0.9.3 avevano provato a curare con i watchdog: il backend rispondeva con `event: error` in meno di un secondo.
- Hook frontend: `useChatStream` (espone `pending`, `isStreaming`, `error`, `working` — stato "sto pensando… / sto consultando…" con cronometro); rendering risposta con react-markdown (stili `.prose-sm` in `index.css`) — **hardened**: immagini rimosse e link resi testo inerte (`MARKDOWN_COMPONENTS` in `ChatPage.tsx`), perché la risposta può contenere testo di terzi letto dai dati → [[Autenticazione e Sicurezza]]

## Riserva locale: se OpenCode cade, risponde Ollama (dal 2026-08-31)

Regole in `backend/src/llm-chat/llm-fallback.ts` (puro, 9 test):

- **Quando si ripiega**: timeout/rete, 5xx, 429/402 (limite raggiunto), 400 "modello non servito", 403 opt-in, più `EmptyLlmResponseError` (il provider risponde ma non produce testo — fallimento noto dei modelli reasoning su questo gateway). **Non** si ripiega sugli errori nostri (400 di validazione, 404, bug): ripiegare lì nasconderebbe il difetto e farebbe girare tutto su Ollama senza che nessuno se ne accorga.
- **Cooldown 15 minuti** (`QUOTA_COOLDOWN_MS`): dopo un errore di quota `LlmConfigService.noteOpencodeQuotaExhausted()` fa restituire direttamente la config Ollama a `getActiveConfig()`. Un credito esaurito non si ricarica in tre secondi: senza cooldown ogni richiesta pagherebbe una chiamata lenta destinata a fallire. Il cooldown è applicato **sopra** la cache in-process (non dentro il valore cachato, altrimenti resterebbe congelato) e viene azzerato da ogni `set*` delle impostazioni: cambiare provider/chiave/modello è un intervento esplicito dell'admin, che deve poter riprovare subito.
- **Riserva risolta da `LlmConfigService.getFallbackConfig()`**: modello Ollama scelto dall'admin, altrimenti `OLLAMA_MODEL`; `null` se `OLLAMA_BASE_URL` manca → nessuna riserva e l'errore del cloud arriva all'utente.
- **Chat**: il fallback avviene **dentro il loop dei round** e solo se quel round non ha ancora emesso testo (`LlmChatService#fallbackFor`) — ricominciare a metà mostrerebbe due risposte cucite insieme. La `history` è in formato neutro `ChatTurn` e viene riconvertita per provider, quindi rifare il round costa niente. Il frontend riceve `{status:'fallback', model}` e mostra la nota "ha risposto il modello locale". La nota è **live**: non persistiamo il modello per messaggio, quindi ricaricando la conversazione sparisce.
- **Report** ([[Pagina Report]]): salva a DB provider e modello **effettivi**, quindi la card dice sempre chi ha scritto e marca "(riserva)" quando non è il provider configurato. Se falliscono entrambi, il messaggio d'errore li nomina tutti e due.
- **Categorizzazione** ([[Import CSV-OFX]], coda di [[Sync Bancario]]): prima la riserva Ollama, poi l'euristica. Nessuna UI dove dirlo, resta nei log.

Il provider attivo ha tre consumatori: la chat, `CategoryAiService` e il **report LLM** della [[Pagina Report]] (`backend/src/llm-reports/`, chiamata non in streaming come la categorizzazione).

Ollama è usato anche per i suggerimenti di categoria in [[Import CSV-OFX]] (e nella coda di revisione di [[Sync Bancario]]) via `CategoryAiService`, che ora rispetta il provider attivo (OpenCode in JSON mode, fallback euristico se il provider non risponde).
