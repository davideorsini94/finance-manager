# Chat LLM

Chat con LLM per interrogare i propri dati finanziari. Route `/chat` ([[Frontend]], `features/chat/`), backend `backend/src/llm-chat/`.

## Provider (2, mutuamente esclusivi)

1. **Ollama (locale)** — default, servito dal container `ollama` ([[Infrastruttura Docker]], auto-pull all'avvio, limite 8 GB RAM)
2. **OpenCode (cloud)** — OpenCode Zen/Go (`opencode.ai/zen/v1` e `opencode.ai/zen/go/v1`, API OpenAI-compatible, endpoint universale `chat/completions` per tutti i modelli). Serve una **API key** dell'utente, cifrata at-rest (contesto `fm-opencode-v1` in `CryptoService`). Con questo provider **Ollama non viene mai contattato** (spento/irraggiungibile non manda in errore chat né categorizzazione).

### Provider e modello attivi configurabili a runtime
Scelta admin in Impostazioni (`frontend/src/features/settings/LlmSettingsCard.tsx` + `llmApi.ts`, backend `backend/src/llm-chat/{llm-settings.controller,llm-models.service,llm-config.service}.ts`), persistita sul singleton `LlmConfig` (DB, [[Database]]). `LlmConfigService.getActiveConfig()` è chiamato a ogni richiesta (chat e categorizzazione import) e cachato in-process, invalidato da ogni `set*` e dal restore backup.

- **Ollama**: `model` a NULL → fallback su `OLLAMA_MODEL` d'ambiente; selezione solo tra modelli installati, download dal catalogo statico allowlist (`llm-catalog.ts`, 6 tag, `ollama.pull` come job detached con polling `GET /settings/llm/pull-status`).
- **OpenCode**: al salvataggio della chiave (`PUT /settings/llm/opencode/key`) il backend la **prova su entrambe le tier** (`opencode.client.ts#probeTier`, micro-chiamata a `chat/completions`) e memorizza `opencodeTier` — così **i modelli mostrati corrispondono alla tipologia di chiave** (Zen o Go). L'elenco è letto a runtime da `GET /models` della tier (pubblico) ed arricchito con **costo** ($/1M token in/out) e **qualità** (giudizio curato) dalla mappa statica `opencode-catalog.ts`; i modelli fuori mappa sono comunque elencati senza prezzo. Selezione modello admin-only, validata contro la mappa (allowlist). Endpoint: `GET /settings/llm/opencode/models`, `PUT /settings/llm/opencode/model`, `POST /settings/llm/opencode/test`, `DELETE /settings/llm/opencode/key`.

### Chat
- Streaming risposta via **SSE** su `POST /chat/sessions/:id/messages` (nginx con buffering disattivato)
- **Tool calling sicuro**: il backend espone al modello tool sui dati (transazioni, saldi, …) iniettando lo `userId` server-side — il modello non può leggere dati di altri utenti ([[Autenticazione e Sicurezza]])
- Loop tool-calling unico per entrambi i provider (`llm-chat.service.ts`): storia in formato neutro `ChatTurn`, convertita per-provider a ogni round (`toOllamaMessage`/`toOpenAiMessage`); per OpenCode i delta incrementali dei tool call (index + arguments spezzati) vengono accumulati. Configurazione di stream: temperature 0.2, num_ctx 8192 (solo Ollama)
- Persistenza in `ChatSession`/`ChatMessage` ([[Database]])
- Hook frontend: `useChatStream`; rendering risposta con react-markdown (stili `.prose-sm` in `index.css`) — **hardened**: immagini rimosse e link resi testo inerte (`MARKDOWN_COMPONENTS` in `ChatPage.tsx`), perché la risposta può contenere testo di terzi letto dai dati → [[Autenticazione e Sicurezza]]

Ollama è usato anche per i suggerimenti di categoria in [[Import CSV-OFX]] (e nella coda di revisione di [[Sync Bancario]]) via `CategoryAiService`, che ora rispetta il provider attivo (OpenCode in JSON mode, fallback euristico se il provider non risponde).
