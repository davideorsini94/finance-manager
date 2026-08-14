# Chat LLM

Chat con LLM **locale** per interrogare i propri dati finanziari. Route `/chat` ([[Frontend]], `features/chat/`), backend `backend/src/llm-chat/`.

- Modello: Ollama `qwen2.5:7b-instruct-q4_K_M` di default, servito dal container `ollama` ([[Infrastruttura Docker]], auto-pull all'avvio, limite 8 GB RAM)
- **Modello attivo configurabile a runtime** dall'admin in Impostazioni (`frontend/src/features/settings/LlmSettingsCard.tsx` + `llmApi.ts`, backend `backend/src/llm-chat/{llm-settings.controller,llm-models.service,llm-config.service,llm-catalog}.ts`): scelta persistita sul singleton `LlmConfig` (DB), fallback su `OLLAMA_MODEL` d'ambiente se non impostato. `LlmConfigService.getActiveModel()` è chiamato a ogni richiesta (chat e categorizzazione import) e cachato in-process, invalidato da `setActiveModel()` e dal restore backup
  - Catalogo statico di 6 modelli scaricabili (allowlist per `ollama.pull`, in `llm-catalog.ts`), download come job detached lato server con polling (`GET /settings/llm/pull-status`) — sopravvive alla chiusura della PWA
  - GET aperte a tutti gli utenti autenticati; download/eliminazione/selezione admin-only (`@Roles(UserRole.admin)`); card in Impostazioni comunque mostrata solo agli admin (coerente con le altre card di sistema)
- Streaming risposta via **SSE** su `POST /chat/sessions/:id/messages` (nginx con buffering disattivato)
- **Tool calling sicuro**: il backend espone al modello tool sui dati (transazioni, saldi, …) iniettando lo `userId` server-side — il modello non può leggere dati di altri utenti ([[Autenticazione e Sicurezza]])
- Persistenza in `ChatSession`/`ChatMessage` ([[Database]])
- Hook frontend: `useChatStream`; rendering risposta con react-markdown (stili `.prose-sm` in `index.css`) — **hardened**: immagini rimosse e link resi testo inerte (`MARKDOWN_COMPONENTS` in `ChatPage.tsx`), perché la risposta può contenere testo di terzi letto dai dati → [[Autenticazione e Sicurezza]]

Ollama è usato anche per i suggerimenti di categoria in [[Import CSV-OFX]].
