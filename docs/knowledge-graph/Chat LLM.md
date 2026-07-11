# Chat LLM

Chat con LLM **locale** per interrogare i propri dati finanziari. Route `/chat` ([[Frontend]], `features/chat/`), backend `backend/src/llm-chat/`.

- Modello: Ollama `qwen2.5:7b-instruct-q4_K_M`, servito dal container `ollama` ([[Infrastruttura Docker]], auto-pull all'avvio, limite 8 GB RAM)
- Streaming risposta via **SSE** su `POST /chat/sessions/:id/messages` (nginx con buffering disattivato)
- **Tool calling sicuro**: il backend espone al modello tool sui dati (transazioni, saldi, …) iniettando lo `userId` server-side — il modello non può leggere dati di altri utenti ([[Autenticazione e Sicurezza]])
- Persistenza in `ChatSession`/`ChatMessage` ([[Database]])
- Hook frontend: `useChatStream`; rendering risposta con react-markdown (stili `.prose-sm` in `index.css`)

Ollama è usato anche per i suggerimenti di categoria in [[Import CSV-OFX]].
