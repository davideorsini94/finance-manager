import type { ChatRequest, Ollama } from 'ollama';

/**
 * Chiamata a Ollama che restituisce solo il testo della risposta, per gli usi
 * non interattivi (bollette, categorie, report).
 * - `think: false`: i modelli recenti (qwen3.5) ragionano per default; su CPU
 *   il ragionamento moltiplica i tempi senza migliorare l'estrazione. Sui
 *   modelli senza ragionamento il parametro è ignorato.
 * - streaming: un modello lento su CPU risponde dopo più di 5 minuti, e il
 *   fetch di Node chiude la richiesta per "Headers Timeout" (300 s) prima che
 *   arrivi la risposta non in streaming. In streaming gli header arrivano
 *   subito; il limite resta il timeout del chiamante.
 */
export async function ollamaChatText(ollama: Ollama, req: Omit<ChatRequest, 'stream' | 'think'>): Promise<string> {
  const stream = await ollama.chat({ ...req, think: false, stream: true });
  let text = '';
  for await (const chunk of stream) text += chunk.message?.content ?? '';
  return text;
}
