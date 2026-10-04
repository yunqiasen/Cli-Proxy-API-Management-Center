import type {
  CloakConfig,
  GeminiKeyConfig,
  ModelAlias,
  NativeApiKeyEntry,
  ProviderKeyConfig,
  ProviderPolicyField,
  ProviderRuntimePolicy,
  ProviderBehaviorOptions,
  RequestScopedErrorRule,
} from '../../types/provider.ts';
import { readCredentialWeight } from '../../utils/credentialWeight';
import { normalizeModelOptions, normalizeModelThinking, serializeModelOptions } from './providerModels';

export const PROVIDER_COMMON_KEY_FIELDS = [
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

export const CODEX_KEY_FIELDS = [
  ...PROVIDER_COMMON_KEY_FIELDS,
  'websockets',
  'disable-image-generation',
  'responses-first-output-timeout-seconds',
  'request-retry',
  'request-scoped-errors',
  'inherit-fields',
  'alpha-search',
  'disable-codex-cloaking',
  'support-prompt-cache-key',
  'fingerprint-profile',
  'source',
] as const;

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

// Preserve server fields not exposed by this form in both saves and probes.
const extraFields = (
  record: Record<string, unknown>,
  known: string[]
): Record<string, unknown> | undefined => {
  const extra = Object.fromEntries(Object.entries(record).filter(([key]) => !known.includes(key)));
  return Object.keys(extra).length ? extra : undefined;
};

const normalizeModels = (value: unknown): ModelAlias[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const models = value
    .map((item, sourceIndex): ModelAlias | null => {
      if (typeof item === 'string') {
        const name = item.trim();
        return name ? { name, sourceIndex } : null;
      }
      if (!isRecord(item)) return null;
      const name = normalizeString(item.name);
      if (!name) return null;
      const model: ModelAlias = { name, sourceIndex, ...normalizeModelOptions(item) };
      const extras = extraFields(item, [
        'name', 'alias', 'priority', 'test-model', 'thinking',
        'display-name', 'max-context-length', 'force-mapping', 'is-compat',
        'support-configuration-update', 'use-max-completion-tokens',
        'input-modalities', 'output-modalities',
      ]);
      if (extras) model.wireExtras = extras;
      const alias = normalizeString(item.alias);
      if (alias) model.alias = alias;
      const priority = normalizeNumber(item.priority);
      if (priority !== undefined) model.priority = priority;
      const testModel = normalizeString(item['test-model']);
      if (testModel) model.testModel = testModel;
      if (isRecord(item.thinking)) model.thinking = normalizeModelThinking(item.thinking);
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
    const weight = normalizeNumber(item.weight);
    if (weight !== undefined) entry.weight = weight;
    const proxyUrl = normalizeString(item['proxy-url']);
    if (proxyUrl) entry.proxyUrl = proxyUrl;
    const authIndex = normalizeString(item['auth-index']);
    if (authIndex) entry.authIndex = authIndex;
    out.push(entry);
    return out;
  }, []);
  return entries.length ? entries : undefined;
};

const normalizeRequestScopedErrors = (value: unknown): RequestScopedErrorRule[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rules = value
    .filter(isRecord)
    .map((rule): RequestScopedErrorRule => {
      const result: RequestScopedErrorRule = {};
      if (typeof rule.status === 'number') result.status = rule.status;
      if (Array.isArray(rule.match))
        result.match = rule.match.filter((v): v is string => typeof v === 'string');
      if (Array.isArray(rule['match-regexr']))
        result.matchRegex = rule['match-regexr'].filter(
          (v): v is string => typeof v === 'string',
        );
      if (typeof rule.action === 'string')
        result.action = rule.action as RequestScopedErrorRule['action'];
      return result;
    });
  return rules.length ? rules : undefined;
};

export function normalizeNativeProviderPayload(item: unknown): NativeProviderConfig | null {
  if (item === undefined || item === null) return null;
  const record = isRecord(item) ? item : {};
  const apiKey = normalizeString(record['api-key'] ?? (typeof item === 'string' ? item : '')) ?? '';
  const apiKeyEntries = normalizeNativeApiKeyEntries(record['api-key-entries']);
  if (!apiKey && !apiKeyEntries?.length) return null;

  const config: NativeProviderConfig = { apiKey };
  const extras = extraFields(record, [
    ...CODEX_KEY_FIELDS,
    'auth-index',
    'cloak',
    'experimental-cch-signing',
    'rebuild-mid-system-message',
    'weight',
  ]);
  if (extras) config.wireExtras = extras;
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
  const disableImageGeneration = normalizeBoolean(record['disable-image-generation']);
  if (disableImageGeneration !== undefined) config.disableImageGeneration = disableImageGeneration;
  const firstOutputTimeout = normalizeNumber(record['responses-first-output-timeout-seconds']);
  if (firstOutputTimeout !== undefined)
    config.responsesFirstOutputTimeoutSeconds = firstOutputTimeout;
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
  // Runtime policy fields (upstream v1.25.2)
  const requestRetry = normalizeNumber(record['request-retry']);
  if (requestRetry !== undefined) config.requestRetry = requestRetry;
  const inheritFields = Array.isArray(record['inherit-fields'])
    ? record['inherit-fields'].filter(
        (v): v is string => typeof v === 'string' && v.trim() !== '',
      )
    : undefined;
  if (inheritFields?.length) config.inheritFields = inheritFields as ProviderPolicyField[];
  const requestScopedErrors = normalizeRequestScopedErrors(record['request-scoped-errors']);
  if (requestScopedErrors?.length) config.requestScopedErrors = requestScopedErrors;
  // Behavior option fields
  const alphaSearch = normalizeBoolean(record['alpha-search']);
  if (alphaSearch !== undefined) config.alphaSearch = alphaSearch;
  const disableCodexCloaking = normalizeBoolean(record['disable-codex-cloaking']);
  if (disableCodexCloaking !== undefined) config.disableCodexCloaking = disableCodexCloaking;
  const supportPromptCacheKey = normalizeBoolean(record['support-prompt-cache-key']);
  if (supportPromptCacheKey !== undefined) config.supportPromptCacheKey = supportPromptCacheKey;
  const fingerprintProfile = normalizeString(record['fingerprint-profile']);
  if (fingerprintProfile) config.fingerprintProfile = fingerprintProfile;
  // Weight (consolidated from applyNativeProviderWeight)
  const weight = readCredentialWeight(record.weight);
  if (weight !== undefined) config.weight = weight;
  return config;
}

export function normalizeNativeProviderSectionPayload(
  payload: unknown,
  section: string
): NativeProviderConfig[] {
  if (!isRecord(payload)) return [];
  const items = payload[section];
  if (!Array.isArray(items)) return [];

  return items.reduce<NativeProviderConfig[]>((out, item) => {
    const config = normalizeNativeProviderPayload(item);
    if (!config) return out;
    if (isRecord(item)) {
      const weight = normalizeNumber(item.weight);
      if (weight !== undefined) config.weight = weight;
    }
    out.push(config);
    return out;
  }, []);
}

const serializeModels = (models?: ModelAlias[]) => {
  const payload = (models ?? [])
    .map((model) => {
      const name = model.name.trim();
      if (!name) return null;
      const entry: Record<string, unknown> = { ...model.wireExtras, name };
      const options = serializeModelOptions(model);
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        if (key === 'thinking' && model.thinking === undefined) continue;
        entry[key] = value;
      }
      if (model.alias?.trim()) entry.alias = model.alias.trim();
      if (model.priority !== undefined) entry.priority = model.priority;
      if (model.testModel?.trim()) entry['test-model'] = model.testModel.trim();
      if (model.thinking) entry.thinking = model.thinking;
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

export const serializeNativeApiKeyEntry = (entry: NativeApiKeyEntry): Record<string, unknown> => {
  const payload: Record<string, unknown> = { 'api-key': entry.apiKey.trim() };
  if (entry.priority !== undefined) payload.priority = entry.priority;
  if (entry.weight !== undefined) payload.weight = entry.weight;
  if (entry.proxyUrl?.trim()) payload['proxy-url'] = entry.proxyUrl.trim();
  if (entry.authIndex?.trim()) payload['auth-index'] = entry.authIndex.trim();
  return payload;
};

export function serializeNativeProviderPayload(
  config: GeminiKeyConfig | ProviderKeyConfig
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...config.wireExtras };
  if (config.weight !== undefined) payload.weight = config.weight;
  if (config.name?.trim()) payload.name = config.name.trim();
  if (config.apiKey.trim()) payload['api-key'] = config.apiKey.trim();
  if (config.priority !== undefined) payload.priority = config.priority;
  if (config.prefix?.trim()) payload.prefix = config.prefix.trim();
  if (config.baseUrl?.trim()) payload['base-url'] = config.baseUrl.trim();
  if (config.proxyUrl?.trim()) payload['proxy-url'] = config.proxyUrl.trim();
  const providerConfig = config as ProviderKeyConfig;
  if (providerConfig.websockets !== undefined) payload.websockets = providerConfig.websockets;
  if (providerConfig.disableImageGeneration) payload['disable-image-generation'] = true;
  if (providerConfig.responsesFirstOutputTimeoutSeconds !== undefined) {
    payload['responses-first-output-timeout-seconds'] =
      providerConfig.responsesFirstOutputTimeoutSeconds;
  }
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
  // Runtime policy serialization (upstream v1.25.2)
  const policyConfig = config as ProviderRuntimePolicy;
  if (policyConfig.requestRetry !== undefined) payload['request-retry'] = policyConfig.requestRetry;
  if (policyConfig.requestScopedErrors?.length) {
    payload['request-scoped-errors'] = policyConfig.requestScopedErrors.map((rule) => ({
      ...(rule.status !== undefined ? { status: rule.status } : {}),
      ...(rule.match ? { match: rule.match } : {}),
      ...(rule.matchRegex ? { 'match-regexr': rule.matchRegex } : {}),
      ...(rule.action ? { action: rule.action } : {}),
    }));
  }
  if (policyConfig.inheritFields?.length) payload['inherit-fields'] = policyConfig.inheritFields;
  // Behavior options
  const behaviorConfig = config as ProviderBehaviorOptions;
  if (behaviorConfig.alphaSearch !== undefined) payload['alpha-search'] = behaviorConfig.alphaSearch;
  if (behaviorConfig.disableCodexCloaking !== undefined) payload['disable-codex-cloaking'] = behaviorConfig.disableCodexCloaking;
  if (behaviorConfig.supportPromptCacheKey !== undefined) payload['support-prompt-cache-key'] = behaviorConfig.supportPromptCacheKey;
  if (providerConfig.fingerprintProfile?.trim()) payload['fingerprint-profile'] = providerConfig.fingerprintProfile.trim();
  return payload;
}

// Missing managed fields clear saved values, just like the save API merger.
// The credential selection is carried separately and never includes the key pool.
export function serializeCodexProviderDraft(config: ProviderKeyConfig): Record<string, unknown> {
  const payload = serializeNativeProviderPayload(config);
  for (const field of CODEX_KEY_FIELDS) {
    if (!(field in payload)) payload[field] = null;
  }
  delete payload['api-key'];
  delete payload['api-key-entries'];
  return payload;
}
