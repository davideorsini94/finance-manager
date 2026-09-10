/**
 * Metadati dei modelli OpenCode (Zen/Go): costo e qualità.
 *
 * La lista dei modelli disponibili NON è statica: viene letta a runtime
 * dall'endpoint `GET {base}/models` della tier rilevata dalla API key (Zen o
 * Go), così ogni chiave vede esattamente i modelli che può usare. Questa mappa
 * serve solo ad arricchire quella lista con il **costo** (USD per 1M token
 * input/output) e la **qualità** (giudizio curato, come per il catalogo
 * Ollama). I modelli non presenti in mappa vengono comunque mostrati, senza
 * prezzo/qualità.
 *
 * Prezzi allineati alla tabella ufficiale https://opencode.ai/docs/zen
 * (aggiornare a mano quando cambiano). I prezzi DeepSeek sono il valore
 * "Peak" (il più alto); GPT/Claude/Gemini/Grok il valore "≤ soglia" quando la
 * soglia esiste.
 */

export type OpencodeQuality = 'eccellente' | 'molto buona' | 'buona' | 'gratuito';

export interface OpencodeModelMeta {
  /** Model ID esatto restituito da `GET /models` e da passare all'API. */
  modelId: string;
  displayName: string;
  /** Produttore/famiglia, es. "Anthropic", "OpenAI", "DeepSeek". */
  family: string;
  /** USD per 1M token di input. */
  inputPrice: number;
  /** USD per 1M token di output. */
  outputPrice: number;
  /** Giudizio curato sulla qualità (chat/tool-calling in italiano). */
  quality: OpencodeQuality;
  /** Descrizione breve mostrata in UI. */
  description: string;
  /** Consigliato: il miglior compromesso costo/qualità per la chat finanziaria. */
  recommended?: boolean;
}

const OPCODE_META_SEED: readonly OpencodeModelMeta[] = [
  {
    modelId: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    family: 'DeepSeek',
    inputPrice: 0.44,
    outputPrice: 1.32,
    quality: 'eccellente',
    description:
      'Il miglior compromesso costo/prestazioni: qualità da modello grande a prezzo minimo, ottimo tool-calling e italiano. Consigliato per la chat finanziaria.',
    recommended: true,
  },
  {
    modelId: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'DeepSeek',
    inputPrice: 1.32,
    outputPrice: 3.96,
    quality: 'eccellente',
    description:
      'Versione Pro di DeepSeek: più capace su ragionamento e analisi lunghe, costo ancora contenuto.',
  },
  {
    modelId: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    family: 'OpenAI',
    inputPrice: 0.2,
    outputPrice: 1.2,
    quality: 'molto buona',
    description:
      'Il GPT più economico della famiglia 5.6: veloce e adeguato per riepiloghi e classificazioni.',
  },
  {
    modelId: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini',
    family: 'OpenAI',
    inputPrice: 0.75,
    outputPrice: 4.5,
    quality: 'molto buona',
    description: 'Equilibrato per risposte quotidiane: buon italiano e tool-calling affidabile.',
  },
  {
    modelId: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    family: 'OpenAI',
    inputPrice: 2.0,
    outputPrice: 12.0,
    quality: 'eccellente',
    description: 'Il GPT "daily driver": forte su ragionamento e analisi finanziarie.',
  },
  {
    modelId: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    family: 'OpenAI',
    inputPrice: 2.0,
    outputPrice: 10.0,
    quality: 'eccellente',
    description: 'Il più capace della famiglia 5.6 (prezzo promozionale fino al 18/09/2026).',
  },
  {
    modelId: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    family: 'Anthropic',
    inputPrice: 1.0,
    outputPrice: 5.0,
    quality: 'molto buona',
    description: 'Veloce ed economico, ottimo per classificazione e risposte brevi.',
  },
  {
    modelId: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    family: 'Anthropic',
    inputPrice: 2.0,
    outputPrice: 10.0,
    quality: 'eccellente',
    description: 'Il miglior rapporto qualità/prezzo di Claude: perfetto per la chat con tool.',
  },
  {
    modelId: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    family: 'Anthropic',
    inputPrice: 5.0,
    outputPrice: 25.0,
    quality: 'eccellente',
    description: 'Top di gamma Anthropic: massima qualità, costo alto. Per analisi complesse.',
  },
  {
    modelId: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    family: 'Anthropic',
    inputPrice: 10.0,
    outputPrice: 50.0,
    quality: 'eccellente',
    description: 'Il modello più avanzato di Anthropic: solo per casi che giustificano il costo.',
  },
  {
    modelId: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash',
    family: 'Google',
    inputPrice: 0.5,
    outputPrice: 3.0,
    quality: 'molto buona',
    description: 'Veloce ed economico, contesto 1M: buono per riepiloghi con molta storia.',
  },
  {
    modelId: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash Lite',
    family: 'Google',
    inputPrice: 0.3,
    outputPrice: 2.5,
    quality: 'molto buona',
    description: 'La Gemini più economica: adeguata per categorizzazione e risposte semplici.',
  },
  {
    modelId: 'qwen3.5-plus',
    displayName: 'Qwen3.5 Plus',
    family: 'Alibaba',
    inputPrice: 0.2,
    outputPrice: 1.2,
    quality: 'molto buona',
    description: 'Cinese economico con ottimo tool-calling, prezzo vicino a DeepSeek Flash.',
  },
  {
    modelId: 'qwen3.7-plus',
    displayName: 'Qwen3.7 Plus',
    family: 'Alibaba',
    inputPrice: 0.4,
    outputPrice: 1.6,
    quality: 'molto buona',
    description: 'Evoluzione di Qwen3.5 Plus: qualità superiore a costo ancora basso.',
  },
  {
    modelId: 'kimi-k2.5',
    displayName: 'Kimi K2.5',
    family: 'Moonshot',
    inputPrice: 0.6,
    outputPrice: 3.0,
    quality: 'molto buona',
    description: 'Agente capace con contesto lungo, ottimo tool-calling.',
  },
  {
    modelId: 'glm-5.2',
    displayName: 'GLM 5.2',
    family: 'Zhipu',
    inputPrice: 1.4,
    outputPrice: 4.4,
    quality: 'molto buona',
    description: 'GLM recente: solido su ragionamento e strumenti.',
  },
  {
    modelId: 'minimax-m3',
    displayName: 'MiniMax M3',
    family: 'MiniMax',
    inputPrice: 0.3,
    outputPrice: 1.2,
    quality: 'molto buona',
    description: 'Molto economico e veloce: buona scelta per classificazione in volume.',
  },
  {
    modelId: 'grok-4.5',
    displayName: 'Grok 4.5',
    family: 'xAI',
    inputPrice: 2.0,
    outputPrice: 6.0,
    quality: 'molto buona',
    description: 'Ragionamento forte e output fino a 500K token.',
  },
  {
    modelId: 'grok-build-0.1',
    displayName: 'Grok Build 0.1',
    family: 'xAI',
    inputPrice: 1.0,
    outputPrice: 2.0,
    quality: 'molto buona',
    description: 'Versione "build" di Grok a costo ridotto.',
  },
  {
    // L'ID reale del gateway ha il suffisso `-contributor` (modello a opt-in):
    // senza, questa voce non combaciava con nessun modello e restava inerte.
    modelId: 'muse-spark-1.2-contributor',
    displayName: 'Muse Spark 1.2',
    family: 'Meta',
    inputPrice: 1.25,
    outputPrice: 4.25,
    quality: 'eccellente',
    description:
      'Modello Meta agente di alto livello: ottimo per tool-calling complessi. Richiede opt-in sull\'account OpenCode.',
  },
];

export const OPENCODE_MODEL_META: ReadonlyMap<string, OpencodeModelMeta> = new Map(
  OPCODE_META_SEED.map((m) => [m.modelId, m]),
);

/**
 * Ci sono metadati (prezzo/qualità) per questo modello?
 *
 * **Non è un'allowlist**: la selezione del modello si valida contro l'elenco
 * vivo della tier in `LlmModelsService.selectOpencodeModel`. Usarla come
 * allowlist rifiutava come "fuori catalogo" modelli realmente serviti, appena
 * il gateway ne aggiungeva di nuovi.
 */
export function hasOpencodeModelMeta(modelId: string): boolean {
  return OPENCODE_MODEL_META.has(modelId);
}

/**
 * Ordine di preferenza quando l'app deve **sostituire da sé** il modello
 * attivo che il gateway non serve più: prima il consigliato del catalogo, poi
 * la qualità migliore (a pari qualità il più economico in input), infine — se
 * nessun candidato ha metadati — il primo id in ordine alfabetico. Nessuna
 * scelta casuale: lo stesso guasto deve portare sempre allo stesso modello,
 * altrimenti non si capisce più chi sta rispondendo.
 *
 * `null` se non funziona niente: meglio lasciare in configurazione un modello
 * rotto (con la riserva Ollama che risponde) che scriverne uno inventato.
 */
export function pickReplacementModel(workingModelIds: readonly string[]): string | null {
  if (!workingModelIds.length) return null;

  const withMeta = workingModelIds
    .map((modelId) => ({ modelId, meta: OPENCODE_MODEL_META.get(modelId) }))
    .filter((c): c is { modelId: string; meta: OpencodeModelMeta } => !!c.meta);

  const recommended = withMeta.find((c) => c.meta.recommended);
  if (recommended) return recommended.modelId;

  if (withMeta.length) {
    return [...withMeta].sort(
      (a, b) =>
        QUALITY_RANK[a.meta.quality] - QUALITY_RANK[b.meta.quality] ||
        a.meta.inputPrice - b.meta.inputPrice ||
        a.modelId.localeCompare(b.modelId),
    )[0].modelId;
  }

  return [...workingModelIds].sort((a, b) => a.localeCompare(b))[0];
}

/** Qualità dalla migliore alla peggiore, per la scelta del sostituto. */
const QUALITY_RANK: Record<OpencodeQuality, number> = {
  eccellente: 0,
  'molto buona': 1,
  buona: 2,
  gratuito: 3,
};
