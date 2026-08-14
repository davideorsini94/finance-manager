/**
 * Catalogo curato dei modelli Ollama proposti nelle impostazioni.
 *
 * Ollama non espone un'API pubblica della propria library, quindi la lista è
 * statica e va aggiornata a mano. Serve anche da **allowlist**: solo questi tag
 * possono essere passati a `ollama.pull()` (mai una stringa arbitraria che
 * arriva dal client).
 *
 * Tutti i tag sono quantizzazioni q4_K_M: il miglior compromesso
 * qualità/memoria per un self-host su CPU.
 */

export interface LlmCatalogEntry {
  /** Tag esatto da passare a `ollama.pull` / `ollama.run`. */
  tag: string;
  displayName: string;
  /** Dimensione del download, come mostrata in UI. */
  downloadSize: string;
  /** RAM stimata a runtime (pesi + contesto 8k), come mostrata in UI. */
  ramRequired: string;
  description: string;
  /** true se la RAM stimata supera il limite del container Ollama. */
  overLimit: boolean;
}

/**
 * Limite di memoria del container `ollama` (`deploy.resources.limits.memory:
 * 8g` in docker-compose.yml). Oltre questa soglia il modello viene ucciso
 * dall'OOM killer a metà inferenza, quindi va segnalato in UI.
 */
export const OLLAMA_MEMORY_LIMIT_GB = 8;

/**
 * Sorgente del catalogo: la RAM è numerica per poter derivare `overLimit`
 * senza duplicare la soglia in ogni voce.
 */
const CATALOG_SEED: readonly {
  tag: string;
  displayName: string;
  downloadSize: string;
  ramRequiredGb: number;
  description: string;
}[] = [
  {
    tag: 'qwen2.5:7b-instruct-q4_K_M',
    displayName: 'Qwen2.5 7B Instruct',
    downloadSize: '4,7 GB',
    ramRequiredGb: 6,
    description:
      'Modello predefinito dell\'app: ottimo italiano e tool-calling affidabile, il migliore per la chat finanziaria e la categorizzazione automatica. Consigliato.',
  },
  {
    tag: 'llama3.1:8b-instruct-q4_K_M',
    displayName: 'Llama 3.1 8B Instruct',
    downloadSize: '4,9 GB',
    ramRequiredGb: 6.5,
    description:
      'Alternativa Meta con contesto lungo e buon tool-calling. Qualità paragonabile a Qwen2.5 7B, italiano leggermente meno naturale e un filo più lento.',
  },
  {
    tag: 'mistral:7b-instruct-v0.3-q4_K_M',
    displayName: 'Mistral 7B Instruct v0.3',
    downloadSize: '4,4 GB',
    ramRequiredGb: 5.5,
    description:
      'Veloce e leggero, il più reattivo tra i 7B su CPU. Tool-calling meno costante: adatto se preferisci la rapidità alla precisione delle chiamate ai tool.',
  },
  {
    tag: 'gemma2:9b-instruct-q4_K_M',
    displayName: 'Gemma 2 9B Instruct',
    downloadSize: '5,8 GB',
    ramRequiredGb: 7.5,
    description:
      'Il più capace del catalogo nella comprensione del testo, ma richiede circa 7,5 GB: molto vicino al limite di 8 GB del container e sensibilmente più lento su CPU. Usalo solo se la macchina è scarica.',
  },
  {
    tag: 'qwen2.5:3b-instruct-q4_K_M',
    displayName: 'Qwen2.5 3B Instruct',
    downloadSize: '2,0 GB',
    ramRequiredGb: 3,
    description:
      'Versione ridotta di Qwen2.5: dimezza RAM e tempi di risposta mantenendo un italiano decente. Scelta consigliata su hardware modesto (NAS, mini-PC).',
  },
  {
    tag: 'phi3.5:3.8b-mini-instruct-q4_K_M',
    displayName: 'Phi-3.5 Mini 3.8B Instruct',
    downloadSize: '2,2 GB',
    ramRequiredGb: 3.5,
    description:
      'Modello Microsoft molto compatto e rapido. Buono per la categorizzazione delle transazioni, più debole nella chat in italiano e nel tool-calling.',
  },
];

export const LLM_CATALOG: readonly LlmCatalogEntry[] = CATALOG_SEED.map((e) => ({
  tag: e.tag,
  displayName: e.displayName,
  downloadSize: e.downloadSize,
  ramRequired: `~${formatGb(e.ramRequiredGb)} GB`,
  description: e.description,
  overLimit: e.ramRequiredGb > OLLAMA_MEMORY_LIMIT_GB,
}));

/** Allowlist: true solo se il tag è una voce esatta del catalogo. */
export function isCatalogModel(tag: string): boolean {
  return LLM_CATALOG.some((e) => e.tag === tag);
}

/** Formatta in stile italiano (virgola decimale, interi senza decimali). */
function formatGb(gb: number): string {
  return Number.isInteger(gb) ? String(gb) : gb.toFixed(1).replace('.', ',');
}
