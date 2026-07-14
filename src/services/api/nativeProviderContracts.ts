import type {
  CloakConfig,
  GeminiKeyConfig,
  ModelAlias,
  NativeApiKeyEntry,
  ProviderKeyConfig,
} from '../../types/provider.ts';

type NativeProviderConfig = GeminiKeyConfig & ProviderKeyConfig;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const normalizeString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
};

const normalizeNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeStringList = (value: unknown): string[] => {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : [];
  const seen = new Set<string>();
  return items.reduce<string[]>((out, item) => {
    const normalized = String(item ?? '').trim();
    const identity = normalized.toLowerCase();
    if (!normalized || seen.has(identity)) return out;
    seen.add(identity);
    out.push(normalized);
    return out;
  }, []);
};

const normalizeHeaders = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined;
  const headers: Record<string, string> = {};
  Object.entries(value).forEach(([key, headerValue]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey || headerValue === undefined || headerValue === null) return;
    headers[normalizedKey] = String(headerValue).trim();
  });
  return Object.keys(headers).length ? headers : undefined;
};

const normalizeModels = (value: unknown): ModelAlias[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const models = value
    .map((item): ModelAlias | null => {
      if (typeof item === 'string') {
        const name = item.trim();
        return name ? { name } : null;
      }
      if (!isRecord(item)) return null;
      const name = normalizeString(item.name);
      if (!name) return null;
      const model: ModelAlias = { name };
      const alias = normalizeString(item.alias);
      if (alias && alias !== name) model.alias = alias;
      const priority = normalizeNumber(item.priority);
      if (priority !== undefined) model.priority = priority;
      const testModel = normalizeString(item['test-model']);
      if (testModel) model.testModel = testModel;
      return model;
    })
    .filter((item): item is ModelAlias => item !== null);
  return models.length ? models : undefined;
};

const normalizeCloak = (value: unknown): CloakConfig | undefined => {
  if (!isRecord(value)) return undefined;
  const cloak: CloakConfig = {};
  const mode = normalizeString(value.mode);
  if (mode) cloak.mode = mode;
  const strictMode = normalizeBoolean(value['strict-mode']);
  if (strictMode !== undefined) cloak.strictMode = strictMode;
  const sensitiveWords = normalizeStringList(value['sensitive-words']);
  if (sensitiveWords.length) cloak.sensitiveWords = sensitiveWords;
  const cacheUserId = normalizeBoolean(value['cache-user-id']);
  if (cacheUserId !== undefined) cloak.cacheUserId = cacheUserId;
  return Object.keys(cloak).length ? cloak : undefined;
};

export const normalizeNativeApiKeyEntries = (value: unknown): NativeApiKeyEntry[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const entries = value.reduce<NativeApiKeyEntry[]>((out, item) => {
    if (!isRecord(item)) return out;
    const apiKey = normalizeString(item['api-key']);
    if (!apiKey || seen.has(apiKey)) return out;
    seen.add(apiKey);
    const entry: NativeApiKeyEntry = { apiKey };
    const priority = normalizeNumber(item.priority);
    if (priority !== undefined) entry.priority = priority;
    const proxyUrl = normalizeString(item['proxy-url']);
    if (proxyUrl) entry.proxyUrl = proxyUrl;
    const authIndex = normalizeString(item['auth-index']);
    if (authIndex) entry.authIndex = authIndex;
    out.push(entry);
    return out;
  }, []);
  return entries.length ? entries : undefined;
};

export function normalizeNativeProviderPayload(item: unknown): NativeProviderConfig | null {
  if (item === undefined || item === null) return null;
  const record = isRecord(item) ? item : {};
  const apiKey = normalizeString(record['api-key'] ?? (typeof item === 'string' ? item : '')) ?? '';
  const apiKeyEntries = normalizeNativeApiKeyEntries(record['api-key-entries']);
  if (!apiKey && !apiKeyEntries?.length) return null;

  const config: NativeProviderConfig = { apiKey };
  const name = normalizeString(record.name);
  if (name) config.name = name;
  if (apiKeyEntries) config.apiKeyEntries = apiKeyEntries;
  const priority = normalizeNumber(record.priority);
  if (priority !== undefined) config.priority = priority;
  const prefix = normalizeString(record.prefix);
  if (prefix) config.prefix = prefix;
  const baseUrl = normalizeString(record['base-url']);
  if (baseUrl) config.baseUrl = baseUrl;
  const proxyUrl = normalizeString(record['proxy-url']);
  if (proxyUrl) config.proxyUrl = proxyUrl;
  const headers = normalizeHeaders(record.headers);
  if (headers) config.headers = headers;
  const models = normalizeModels(record.models);
  if (models) config.models = models;
  const excludedModels = normalizeStringList(record['excluded-models']);
  if (excludedModels.length) config.excludedModels = excludedModels;
  const disableCooling = normalizeBoolean(record['disable-cooling']);
  if (disableCooling !== undefined) config.disableCooling = disableCooling;
  const authIndex = normalizeString(record['auth-index']);
  if (authIndex) config.authIndex = authIndex;
  const websockets = normalizeBoolean(record.websockets);
  if (websockets !== undefined) config.websockets = websockets;
  const cloak = normalizeCloak(record.cloak);
  if (cloak) config.cloak = cloak;
  const experimentalCchSigning = normalizeBoolean(record['experimental-cch-signing']);
  if (experimentalCchSigning !== undefined) {
    config.experimentalCchSigning = experimentalCchSigning;
  }
  const rebuildMidSystemMessage = normalizeBoolean(record['rebuild-mid-system-message']);
  if (rebuildMidSystemMessage !== undefined) {
    config.rebuildMidSystemMessage = rebuildMidSystemMessage;
  }
  return config;
}

const serializeModels = (models?: ModelAlias[]) => {
  const payload = (models ?? [])
    .map((model) => {
      const name = model.name.trim();
      if (!name) return null;
      const entry: Record<string, unknown> = { name };
      if (model.alias?.trim() && model.alias.trim() !== name) entry.alias = model.alias.trim();
      if (model.priority !== undefined) entry.priority = model.priority;
      if (model.testModel?.trim()) entry['test-model'] = model.testModel.trim();
      return entry;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  return payload.length ? payload : undefined;
};

const serializeCloak = (cloak?: CloakConfig): Record<string, unknown> | undefined => {
  if (!cloak) return undefined;
  const payload: Record<string, unknown> = {};
  if (cloak.mode?.trim()) payload.mode = cloak.mode.trim();
  if (cloak.strictMode !== undefined) payload['strict-mode'] = cloak.strictMode;
  if (cloak.sensitiveWords?.length) payload['sensitive-words'] = cloak.sensitiveWords;
  if (cloak.cacheUserId !== undefined) payload['cache-user-id'] = cloak.cacheUserId;
  return Object.keys(payload).length ? payload : undefined;
};

export const serializeNativeApiKeyEntry = (
  entry: NativeApiKeyEntry
): Record<string, unknown> => {
  const payload: Record<string, unknown> = { 'api-key': entry.apiKey.trim() };
  if (entry.priority !== undefined) payload.priority = entry.priority;
  if (entry.proxyUrl?.trim()) payload['proxy-url'] = entry.proxyUrl.trim();
  return payload;
};

export function serializeNativeProviderPayload(
  config: GeminiKeyConfig | ProviderKeyConfig
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (config.name?.trim()) payload.name = config.name.trim();
  if (config.apiKey.trim()) payload['api-key'] = config.apiKey.trim();
  if (config.priority !== undefined) payload.priority = config.priority;
  if (config.prefix?.trim()) payload.prefix = config.prefix.trim();
  if (config.baseUrl?.trim()) payload['base-url'] = config.baseUrl.trim();
  if (config.proxyUrl?.trim()) payload['proxy-url'] = config.proxyUrl.trim();
  const providerConfig = config as ProviderKeyConfig;
  if (providerConfig.websockets !== undefined) payload.websockets = providerConfig.websockets;
  if (config.disableCooling) payload['disable-cooling'] = true;
  if (config.apiKeyEntries?.length) {
    payload['api-key-entries'] = config.apiKeyEntries.map(serializeNativeApiKeyEntry);
  }
  if (config.headers && Object.keys(config.headers).length) payload.headers = config.headers;
  const models = serializeModels(config.models);
  if (models) payload.models = models;
  if (config.excludedModels?.length) payload['excluded-models'] = config.excludedModels;
  const cloak = serializeCloak(providerConfig.cloak);
  if (cloak) payload.cloak = cloak;
  if (providerConfig.experimentalCchSigning) payload['experimental-cch-signing'] = true;
  if (providerConfig.rebuildMidSystemMessage) payload['rebuild-mid-system-message'] = true;
  return payload;
}
