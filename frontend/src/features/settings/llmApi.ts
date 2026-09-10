import { api } from '@/lib/api/client';

export type LlmProvider = 'ollama' | 'opencode';
export type OpencodeTier = 'zen' | 'go';

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  parameterSize?: string;
  quantization?: string;
  modifiedAt?: string;
}

export interface OpencodeModelEntry {
  modelId: string;
  displayName: string;
  family: string | null;
  /** USD per 1M token di input. `null` se non nel catalogo metadati. */
  inputPrice: number | null;
  /** USD per 1M token di output. `null` se non nel catalogo metadati. */
  outputPrice: number | null;
  quality: string | null;
  description: string | null;
  recommended: boolean;
}

/**
 * Risposta di `GET settings/llm/opencode/models`: contiene **solo** modelli
 * verificati funzionanti. `checkedAt` = quando è stata fatta la verifica (null
 * = non verificata, manca la API key), `excludedCount` = quanti il gateway
 * elenca ma non serve, `refreshing` = una verifica è in corso.
 */
export interface OpencodeModelList {
  models: OpencodeModelEntry[];
  checkedAt: string | null;
  excludedCount: number;
  refreshing: boolean;
}

export interface LlmSettings {
  provider: LlmProvider;
  activeModel: string;
  source: 'db' | 'env';
  serverOk: boolean;
  /** Prompt di base dei report di periodo; vuoto = si usa il predefinito. */
  reportPrompt: string;
  installed: InstalledModel[];
  opencode: {
    configured: boolean;
    apiKeyMasked: string | null;
    tier: OpencodeTier | null;
    model: string | null;
  };
}

export interface CatalogItem {
  tag: string;
  displayName: string;
  downloadSize: string;
  ramRequired: string;
  description: string;
  overLimit: boolean;
}

export interface LlmCatalog {
  items: CatalogItem[];
}

export interface PullStatus {
  active: boolean;
  model?: string;
  status?: string;
  completedBytes?: number;
  totalBytes?: number;
  percent?: number;
  error?: string;
  done?: boolean;
}

export const llmApi = {
  /** Salva il prompt di base dei report (admin). Vuoto = torna al predefinito. */
  setReportPrompt: (prompt: string) =>
    api.put('settings/llm/report-prompt', { json: { prompt } }).json<{ reportPrompt: string }>(),
  get: () => api.get('settings/llm').json<LlmSettings>(),
  catalog: () => api.get('settings/llm/catalog').json<LlmCatalog>(),
  pull: (model: string) =>
    api.post('settings/llm/models/pull', { json: { model } }).json<{ started: true }>(),
  pullStatus: () => api.get('settings/llm/pull-status').json<PullStatus>(),
  remove: (name: string) => api.delete(`settings/llm/models/${encodeURIComponent(name)}`),
  select: (model: string) =>
    api.put('settings/llm', { json: { model } }).json<{ activeModel: string }>(),
  // ---- OpenCode (Zen/Go) ----
  setProvider: (provider: LlmProvider) =>
    api.put('settings/llm/provider', { json: { provider } }).json<{ provider: LlmProvider }>(),
  opencodeModels: (tier?: OpencodeTier) =>
    api
      .get(tier ? `settings/llm/opencode/models?tier=${tier}` : 'settings/llm/opencode/models')
      .json<OpencodeModelList>(),
  saveOpencodeKey: (apiKey: string, tier?: OpencodeTier) =>
    api
      .put('settings/llm/opencode/key', { json: { apiKey, ...(tier ? { tier } : {}) } })
      .json<{ tier: OpencodeTier; apiKeyMasked: string }>(),
  removeOpencodeKey: () => api.delete('settings/llm/opencode/key'),
  selectOpencodeModel: (model: string) =>
    api
      .put('settings/llm/opencode/model', { json: { model } })
      .json<{ activeModel: string }>(),
  testOpencode: () =>
    api.post('settings/llm/opencode/test').json<{ ok: boolean; tier: OpencodeTier | null; error?: string }>(),
};