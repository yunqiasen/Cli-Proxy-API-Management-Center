/**
 * AI 提供商相关 API
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import { normalizeOpenAIProvider, normalizeProviderKeyConfig } from './transformers';
import { serializeNativeProviderPayload } from './nativeProviderContracts';
import { serializeMediaProviderPayload } from './mediaProviderContracts';
import { normalizeMediaProviderPayload } from './mediaProviderContracts';
import type {
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
  ApiKeyEntry,
  ModelAlias,
  MediaProviderConfig,
} from '@/types';

const serializeHeaders = (headers?: Record<string, string>) =>
  headers && Object.keys(headers).length ? headers : undefined;

const RESPONSE_ONLY_FIELDS = ['auth-index'] as const;

const PROVIDER_COMMON_KEY_FIELDS = [
  'name',
  'api-key',
  'api-key-entries',
  'priority',
  'weight',
  'prefix',
  'base-url',
  'proxy-url',
  'headers',
  'models',
  'excluded-models',
  'disable-cooling',
] as const;

const GEMINI_KEY_FIELDS = PROVIDER_COMMON_KEY_FIELDS;
const INTERACTIONS_KEY_FIELDS = PROVIDER_COMMON_KEY_FIELDS;
const CODEX_KEY_FIELDS = [...PROVIDER_COMMON_KEY_FIELDS, 'websockets'] as const;
const XAI_KEY_FIELDS = CODEX_KEY_FIELDS;
const CLAUDE_KEY_FIELDS = [
  ...PROVIDER_COMMON_KEY_FIELDS,
  'cloak',
  'experimental-cch-signing',
  'rebuild-mid-system-message',
] as const;
const VERTEX_KEY_FIELDS = [
  'api-key',
  'priority',
  'weight',
  'prefix',
  'base-url',
  'proxy-url',
  'headers',
  'models',
  'excluded-models',
] as const;

const OPENAI_PROVIDER_FIELDS = [
  'name',
  'priority',
  'disabled',
  'prefix',
  'base-url',
  'api-key-entries',
  'headers',
  'models',
  'test-model',
  'disable-cooling',
] as const;

const MODEL_ALIAS_FIELDS = ['name', 'alias', 'priority', 'test-model', 'thinking'] as const;
const OPENAI_MODEL_ALIAS_FIELDS = [...MODEL_ALIAS_FIELDS, 'image'] as const;

const API_KEY_ENTRY_FIELDS = ['api-key', 'proxy-url', 'weight'] as const;
const NATIVE_API_KEY_ENTRY_FIELDS = ['api-key', 'priority', 'proxy-url'] as const;

const CLOAK_FIELDS = ['mode', 'strict-mode', 'sensitive-words', 'cache-user-id'] as const;

const getStringField = (record: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const openAIProviderIdentity = (record: Record<string, unknown>) =>
  getStringField(record, ['name']);

const modelIdentity = (record: Record<string, unknown>) => getStringField(record, ['name']);

const apiKeyEntryIdentity = (record: Record<string, unknown>) =>
  getStringField(record, ['api-key']);

const cloneWithoutKnownFields = (
  raw: unknown,
  knownFields: readonly string[]
): Record<string, unknown> => {
  const next: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  [...knownFields, ...RESPONSE_ONLY_FIELDS].forEach((field) => {
    delete next[field];
  });
  return next;
};

const mergeKnownFields = (
  raw: unknown,
  payload: Record<string, unknown>,
  knownFields: readonly string[]
) => {
  const next = cloneWithoutKnownFields(raw, knownFields);
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) {
      next[key] = value;
    }
  });
  return next;
};

const findRawRecord = (
  rawRecords: Array<Record<string, unknown> | undefined>,
  usedIndexes: Set<number>,
  payload: Record<string, unknown>,
  index: number,
  getIdentity: (record: Record<string, unknown>) => string,
  fallbackByIndex = true
) => {
  const identity = getIdentity(payload);
  if (identity) {
    for (let i = 0; i < rawRecords.length; i += 1) {
      const candidate = rawRecords[i];
      if (!candidate || usedIndexes.has(i)) continue;
      if (getIdentity(candidate) === identity) {
        usedIndexes.add(i);
        return candidate;
      }
    }
  }

  if (fallbackByIndex) {
    const fallback = rawRecords[index];
    if (fallback && !usedIndexes.has(index)) {
      usedIndexes.add(index);
      return fallback;
    }
  }

  return undefined;
};

const mergeKnownRecordList = (
  rawItems: unknown,
  payloadItems: Record<string, unknown>[],
  knownFields: readonly string[],
  getIdentity: (record: Record<string, unknown>) => string,
  fallbackByIndex = true
) => {
  const rawRecords = Array.isArray(rawItems)
    ? rawItems.map((item) => (isRecord(item) ? item : undefined))
    : [];
  const usedIndexes = new Set<number>();

  return payloadItems.map((payload, index) => {
    const raw = findRawRecord(
      rawRecords,
      usedIndexes,
      payload,
      index,
      getIdentity,
      fallbackByIndex
    );
    return mergeKnownFields(raw, payload, knownFields);
  });
};

const getRawSectionList = (rawConfig: unknown, section: string): unknown[] => {
  if (!isRecord(rawConfig)) return [];
  const value = rawConfig[section];
  return Array.isArray(value) ? value : [];
};

type ProviderRecordMerger = (
  raw: unknown,
  payload: Record<string, unknown>
) => Record<string, unknown>;

export function appendLatestProviderRecord(
  latestItems: unknown[],
  payload: Record<string, unknown>,
  mergePayload: ProviderRecordMerger
): unknown[] {
  return [...latestItems, mergePayload(undefined, payload)];
}

export function replaceLatestProviderRecord(
  latestItems: unknown[],
  isTarget: (record: Record<string, unknown>, index: number) => boolean,
  payload: Record<string, unknown>,
  mergePayload: ProviderRecordMerger
): unknown[] {
  const targetIndex = latestItems.findIndex(
    (item, index) => isRecord(item) && isTarget(item, index)
  );
  if (targetIndex < 0) {
    throw new Error('Provider configuration changed; refresh and try again.');
  }

  return latestItems.map((item, index) =>
    index === targetIndex ? mergePayload(item, payload) : item
  );
}

const mutateLatestProviderList = async (
  section: string,
  mutate: (latestItems: unknown[]) => unknown[]
) => {
  const rawConfig = await apiClient.get('/config');
  const latestItems = getRawSectionList(rawConfig, section);
  await apiClient.put(`/${section}`, mutate(latestItems));
};

const matchesProviderKey = (record: Record<string, unknown>, apiKey: string, baseUrl?: string) =>
  getStringField(record, ['api-key']) === apiKey.trim() &&
  getStringField(record, ['base-url']) === (baseUrl ?? '').trim();

const matchesOpenAIProvider = (record: Record<string, unknown>, name: string) =>
  openAIProviderIdentity(record) === name.trim();

const mergeModelPayloads = (
  raw: unknown,
  models: unknown,
  knownFields: readonly string[] = MODEL_ALIAS_FIELDS
) =>
  Array.isArray(models)
    ? mergeKnownRecordList(
        isRecord(raw) ? raw.models : undefined,
        models.filter(isRecord),
        knownFields,
        modelIdentity,
        false
      )
    : undefined;

const mergeProviderKeyPayload = (
  raw: unknown,
  payload: Record<string, unknown>,
  knownFields: readonly string[]
) => {
  const next = mergeKnownFields(raw, payload, knownFields);
  const rawApiKeyEntries = isRecord(raw) ? raw['api-key-entries'] : undefined;
  const apiKeyEntries = payload['api-key-entries'];
  if (Array.isArray(apiKeyEntries)) {
    next['api-key-entries'] = mergeKnownRecordList(
      rawApiKeyEntries,
      apiKeyEntries.filter(isRecord),
      NATIVE_API_KEY_ENTRY_FIELDS,
      apiKeyEntryIdentity
    );
  }
  const models = mergeModelPayloads(raw, payload.models);
  if (models) next.models = models;
  if (isRecord(payload.cloak)) {
    next.cloak = mergeKnownFields(
      isRecord(raw) ? raw.cloak : undefined,
      payload.cloak,
      CLOAK_FIELDS
    );
  }
  return next;
};

const mergeOpenAIProviderPayload = (raw: unknown, payload: Record<string, unknown>) => {
  const next = mergeKnownFields(raw, payload, OPENAI_PROVIDER_FIELDS);
  const rawApiKeyEntries = isRecord(raw) ? raw['api-key-entries'] : undefined;
  const apiKeyEntries = payload['api-key-entries'];
  if (Array.isArray(apiKeyEntries)) {
    next['api-key-entries'] = mergeKnownRecordList(
      rawApiKeyEntries,
      apiKeyEntries.filter(isRecord),
      API_KEY_ENTRY_FIELDS,
      apiKeyEntryIdentity
    );
  }
  const models = mergeModelPayloads(raw, payload.models, OPENAI_MODEL_ALIAS_FIELDS);
  if (models) next.models = models;
  return next;
};

const extractArrayPayload = (data: unknown, key: string): unknown[] => {
  if (!isRecord(data)) return [];
  const list = data[key];
  return Array.isArray(list) ? list : [];
};

const buildProviderDeleteQuery = (apiKey: string, baseUrl?: string) => {
  const params = new URLSearchParams();
  params.set('api-key', apiKey.trim());
  params.set('base-url', (baseUrl ?? '').trim());
  return `?${params.toString()}`;
};

const serializeModelAliases = (models?: ModelAlias[], includeOpenAIFields = false) =>
  Array.isArray(models)
    ? models
        .map((model) => {
          if (!model?.name) return null;
          const payload: Record<string, unknown> = { name: model.name };
          if (model.alias && model.alias !== model.name) {
            payload.alias = model.alias;
          }
          if (model.priority !== undefined) {
            payload.priority = model.priority;
          }
          if (model.testModel) {
            payload['test-model'] = model.testModel;
          }
          if (includeOpenAIFields && model.image) {
            payload.image = true;
          }
          if (model.thinking) {
            payload.thinking = model.thinking;
          }
          return payload;
        })
        .filter(Boolean)
    : undefined;

const serializeApiKeyEntry = (entry: ApiKeyEntry) => {
  const payload: Record<string, unknown> = { 'api-key': entry.apiKey };
  if (entry.proxyUrl) payload['proxy-url'] = entry.proxyUrl;
  if (entry.weight !== undefined) payload.weight = entry.weight;
  return payload;
};

const serializeProviderKey = (config: ProviderKeyConfig) => {
  const payload = serializeNativeProviderPayload(config);
  if (config.weight !== undefined) payload.weight = config.weight;
  return payload;
};

const serializeVertexModelAliases = (models?: ModelAlias[]) =>
  Array.isArray(models)
    ? models
        .map((model) => {
          const name = typeof model?.name === 'string' ? model.name.trim() : '';
          const alias = typeof model?.alias === 'string' ? model.alias.trim() : '';
          if (!name || !alias) return null;
          return {
            name,
            alias,
            ...(model.thinking ? { thinking: model.thinking } : {}),
          };
        })
        .filter(Boolean)
    : undefined;

const serializeVertexKey = (config: ProviderKeyConfig) => {
  const payload: Record<string, unknown> = { 'api-key': config.apiKey };
  if (config.priority !== undefined) payload.priority = config.priority;
  if (config.weight !== undefined) payload.weight = config.weight;
  if (config.prefix?.trim()) payload.prefix = config.prefix.trim();
  if (config.baseUrl) payload['base-url'] = config.baseUrl;
  if (config.proxyUrl) payload['proxy-url'] = config.proxyUrl;
  const headers = serializeHeaders(config.headers);
  if (headers) payload.headers = headers;
  const models = serializeVertexModelAliases(config.models);
  if (models && models.length) payload.models = models;
  if (config.excludedModels && config.excludedModels.length) {
    payload['excluded-models'] = config.excludedModels;
  }
  return payload;
};

const serializeGeminiKey = (config: GeminiKeyConfig) => {
  const payload = serializeNativeProviderPayload(config);
  if (config.weight !== undefined) payload.weight = config.weight;
  return payload;
};

const serializeOpenAIProvider = (provider: OpenAIProviderConfig) => {
  const payload: Record<string, unknown> = {
    name: provider.name,
    'base-url': provider.baseUrl,
    'api-key-entries': Array.isArray(provider.apiKeyEntries)
      ? provider.apiKeyEntries.map((entry) => serializeApiKeyEntry(entry))
      : [],
  };
  if (provider.prefix?.trim()) payload.prefix = provider.prefix.trim();
  if (provider.disabled !== undefined) payload.disabled = provider.disabled;
  const headers = serializeHeaders(provider.headers);
  if (headers) payload.headers = headers;
  const models = serializeModelAliases(provider.models, true);
  if (models && models.length) payload.models = models;
  if (provider.priority !== undefined) payload.priority = provider.priority;
  if (provider.testModel) payload['test-model'] = provider.testModel;
  if (provider.disableCooling) payload['disable-cooling'] = true;
  return payload;
};

const extractMediaProviders = (data: unknown): MediaProviderConfig[] => {
  const list = extractArrayPayload(data, 'media-providers');
  return list
    .map((item, index) => normalizeMediaProviderPayload(item, index))
    .filter(Boolean) as MediaProviderConfig[];
};

const mutateMediaProviderList = async (
  mutate: (items: MediaProviderConfig[]) => MediaProviderConfig[]
): Promise<void> => {
  const current = extractMediaProviders(await apiClient.get('/media-providers'));
  await apiClient.put(
    '/media-providers',
    mutate(current).map((provider) =>
      serializeMediaProviderPayload(provider, { includeAuthIndexes: true })
    )
  );
};

export const providersApi = {
  createGeminiKey: (config: GeminiKeyConfig) =>
    mutateLatestProviderList('gemini-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeGeminiKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, GEMINI_KEY_FIELDS)
      )
    ),

  updateGeminiKey: (apiKey: string, baseUrl: string | undefined, config: GeminiKeyConfig) =>
    mutateLatestProviderList('gemini-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (record) => matchesProviderKey(record, apiKey, baseUrl),
        serializeGeminiKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, GEMINI_KEY_FIELDS)
      )
    ),

  updateGeminiKeyAtIndex: (index: number, config: GeminiKeyConfig) =>
    mutateLatestProviderList('gemini-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (_record, currentIndex) => currentIndex === index,
        serializeGeminiKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, GEMINI_KEY_FIELDS)
      )
    ),

  deleteGeminiKeyAtIndex: (index: number) =>
    apiClient.delete(`/gemini-api-key?index=${encodeURIComponent(String(index))}`),

  deleteGeminiKey: (apiKey: string, baseUrl?: string) =>
    apiClient.delete(`/gemini-api-key${buildProviderDeleteQuery(apiKey, baseUrl)}`),

  createInteractionsKey: (config: GeminiKeyConfig) =>
    mutateLatestProviderList('interactions-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeGeminiKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, INTERACTIONS_KEY_FIELDS)
      )
    ),

  updateInteractionsKey: (apiKey: string, baseUrl: string | undefined, config: GeminiKeyConfig) =>
    mutateLatestProviderList('interactions-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (record) => matchesProviderKey(record, apiKey, baseUrl),
        serializeGeminiKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, INTERACTIONS_KEY_FIELDS)
      )
    ),

  updateInteractionsKeyAtIndex: (index: number, config: GeminiKeyConfig) =>
    mutateLatestProviderList('interactions-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (_record, currentIndex) => currentIndex === index,
        serializeGeminiKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, INTERACTIONS_KEY_FIELDS)
      )
    ),

  deleteInteractionsKeyAtIndex: (index: number) =>
    apiClient.delete(`/interactions-api-key?index=${encodeURIComponent(String(index))}`),

  deleteInteractionsKey: (apiKey: string, baseUrl?: string) =>
    apiClient.delete(`/interactions-api-key${buildProviderDeleteQuery(apiKey, baseUrl)}`),

  createCodexConfig: (config: ProviderKeyConfig) =>
    mutateLatestProviderList('codex-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeProviderKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, CODEX_KEY_FIELDS)
      )
    ),

  updateCodexConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    mutateLatestProviderList('codex-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (record) => matchesProviderKey(record, apiKey, baseUrl),
        serializeProviderKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, CODEX_KEY_FIELDS)
      )
    ),

  updateCodexConfigAtIndex: (index: number, config: ProviderKeyConfig) =>
    mutateLatestProviderList('codex-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (_record, currentIndex) => currentIndex === index,
        serializeProviderKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, CODEX_KEY_FIELDS)
      )
    ),

  deleteCodexConfigAtIndex: (index: number) =>
    apiClient.delete(`/codex-api-key?index=${encodeURIComponent(String(index))}`),

  deleteCodexConfig: (apiKey: string, baseUrl?: string) =>
    apiClient.delete(`/codex-api-key${buildProviderDeleteQuery(apiKey, baseUrl)}`),

  createXAIConfig: (config: ProviderKeyConfig) =>
    mutateLatestProviderList('xai-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeProviderKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, XAI_KEY_FIELDS)
      )
    ),

  updateXAIConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    mutateLatestProviderList('xai-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (record) => matchesProviderKey(record, apiKey, baseUrl),
        serializeProviderKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, XAI_KEY_FIELDS)
      )
    ),

  deleteXAIConfig: (apiKey: string, baseUrl?: string) =>
    apiClient.delete(`/xai-api-key${buildProviderDeleteQuery(apiKey, baseUrl)}`),

  createClaudeConfig: (config: ProviderKeyConfig) =>
    mutateLatestProviderList('claude-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeProviderKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, CLAUDE_KEY_FIELDS)
      )
    ),

  updateClaudeConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    mutateLatestProviderList('claude-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (record) => matchesProviderKey(record, apiKey, baseUrl),
        serializeProviderKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, CLAUDE_KEY_FIELDS)
      )
    ),

  updateClaudeConfigAtIndex: (index: number, config: ProviderKeyConfig) =>
    mutateLatestProviderList('claude-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (_record, currentIndex) => currentIndex === index,
        serializeProviderKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, CLAUDE_KEY_FIELDS)
      )
    ),

  deleteClaudeConfigAtIndex: (index: number) =>
    apiClient.delete(`/claude-api-key?index=${encodeURIComponent(String(index))}`),

  deleteClaudeConfig: (apiKey: string, baseUrl?: string) =>
    apiClient.delete(`/claude-api-key${buildProviderDeleteQuery(apiKey, baseUrl)}`),

  async getVertexConfigs(): Promise<ProviderKeyConfig[]> {
    const data = await apiClient.get('/vertex-api-key');
    const list = extractArrayPayload(data, 'vertex-api-key');
    return list
      .map((item) => normalizeProviderKeyConfig(item))
      .filter(Boolean) as ProviderKeyConfig[];
  },

  createVertexConfig: (config: ProviderKeyConfig) =>
    mutateLatestProviderList('vertex-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeVertexKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, VERTEX_KEY_FIELDS)
      )
    ),

  updateVertexConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    mutateLatestProviderList('vertex-api-key', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (record) => matchesProviderKey(record, apiKey, baseUrl),
        serializeVertexKey(config),
        (raw, payload) => mergeProviderKeyPayload(raw, payload, VERTEX_KEY_FIELDS)
      )
    ),

  deleteVertexConfig: (apiKey: string, baseUrl?: string) =>
    apiClient.delete(`/vertex-api-key${buildProviderDeleteQuery(apiKey, baseUrl)}`),

  async getOpenAIProviders(): Promise<OpenAIProviderConfig[]> {
    const data = await apiClient.get('/openai-compatibility');
    const list = extractArrayPayload(data, 'openai-compatibility');
    return list
      .map((item, index) => normalizeOpenAIProvider(item, index))
      .filter(Boolean) as OpenAIProviderConfig[];
  },

  createOpenAIProvider: (provider: OpenAIProviderConfig) =>
    mutateLatestProviderList('openai-compatibility', (latestItems) =>
      appendLatestProviderRecord(
        latestItems,
        serializeOpenAIProvider(provider),
        mergeOpenAIProviderPayload
      )
    ),

  updateOpenAIProvider: (name: string, index: number, provider: OpenAIProviderConfig) =>
    mutateLatestProviderList('openai-compatibility', (latestItems) =>
      replaceLatestProviderRecord(
        latestItems,
        (record, currentIndex) => currentIndex === index && matchesOpenAIProvider(record, name),
        serializeOpenAIProvider(provider),
        mergeOpenAIProviderPayload
      )
    ),

  updateOpenAIProviderDisabled: (index: number, disabled: boolean) =>
    apiClient.patch('/openai-compatibility', { index, value: { disabled } }),

  deleteOpenAIProvider: (index: number) =>
    apiClient.delete(`/openai-compatibility?index=${encodeURIComponent(String(index))}`),

  async getMediaProviders(): Promise<MediaProviderConfig[]> {
    return extractMediaProviders(await apiClient.get('/media-providers'));
  },

  createMediaProvider: (provider: MediaProviderConfig) =>
    mutateMediaProviderList((items) => [...items, provider]),

  updateMediaProvider: (index: number, provider: MediaProviderConfig) =>
    apiClient.patch('/media-providers', {
      index,
      value: serializeMediaProviderPayload(provider, { includeAuthIndexes: true }),
    }),

  putMediaProviders: (providers: MediaProviderConfig[]) =>
    apiClient.put(
      '/media-providers',
      providers.map((provider) =>
        serializeMediaProviderPayload(provider, { includeAuthIndexes: true })
      )
    ),

  deleteMediaProvider: (index: number) =>
    apiClient.delete(`/media-providers?index=${encodeURIComponent(String(index))}`),
};
