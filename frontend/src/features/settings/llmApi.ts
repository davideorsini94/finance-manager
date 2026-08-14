import { api } from '@/lib/api/client';

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  parameterSize?: string;
  quantization?: string;
  modifiedAt?: string;
}

export interface LlmSettings {
  activeModel: string;
  source: 'db' | 'env';
  serverOk: boolean;
  installed: InstalledModel[];
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
  get: () => api.get('settings/llm').json<LlmSettings>(),
  catalog: () => api.get('settings/llm/catalog').json<LlmCatalog>(),
  pull: (model: string) =>
    api.post('settings/llm/models/pull', { json: { model } }).json<{ started: true }>(),
  pullStatus: () => api.get('settings/llm/pull-status').json<PullStatus>(),
  remove: (name: string) => api.delete(`settings/llm/models/${encodeURIComponent(name)}`),
  select: (model: string) =>
    api.put('settings/llm', { json: { model } }).json<{ activeModel: string }>(),
};
