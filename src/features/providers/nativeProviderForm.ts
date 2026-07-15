import type {
  GeminiKeyConfig,
  ModelAlias,
  NativeApiKeyEntry,
  ProviderKeyConfig,
} from '../../types/provider.ts';
import type { ApiKeyEntryInput, ModelEntryInput, ProviderEntryFormInput } from './types.ts';

export type NativeProviderBrand = 'gemini' | 'codex' | 'claude';
export type NativeProviderKeyValidationError = 'api-key-required' | 'duplicate-api-key' | null;

const emptyModel = (): ModelEntryInput => ({ name: '', alias: '' });
const emptyHeader = () => ({ key: '', value: '' });

const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const headersFromEntries = (
  entries: Array<{ key: string; value: string }>
): Record<string, string> => {
  const headers: Record<string, string> = {};
  entries.forEach((entry) => {
    const key = entry.key.trim();
    if (key) headers[key] = entry.value;
  });
  return headers;
};

const buildModels = (models: ModelEntryInput[]): ModelAlias[] =>
  models
    .map((model) => ({
      name: model.name.trim(),
      alias: model.alias?.trim() || undefined,
      priority: model.priority,
      testModel: model.testModel,
    }))
    .filter((model) => model.name);

const effectiveEntryKey = (entry: ApiKeyEntryInput): string =>
  entry.apiKey.trim() || entry.existingApiKey?.trim() || '';

const normalizedEntries = (entries: ApiKeyEntryInput[] | undefined): NativeApiKeyEntry[] =>
  (entries ?? [])
    .map((entry) => {
      const apiKey = effectiveEntryKey(entry);
      if (!apiKey) return null;
      return {
        apiKey,
        ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
        ...(entry.proxyUrl.trim() ? { proxyUrl: entry.proxyUrl.trim() } : {}),
        ...(entry.authIndex?.trim() ? { authIndex: entry.authIndex.trim() } : {}),
      } satisfies NativeApiKeyEntry;
    })
    .filter((entry): entry is NativeApiKeyEntry => entry !== null);

export function validateNativeProviderKeyEntries(
  entries: ApiKeyEntryInput[] | undefined
): NativeProviderKeyValidationError {
  const keys = (entries ?? []).map(effectiveEntryKey).filter(Boolean);
  if (!keys.length) return 'api-key-required';
  return new Set(keys).size === keys.length ? null : 'duplicate-api-key';
}

export function buildNativeProviderFormInput(
  brand: NativeProviderBrand,
  config?: GeminiKeyConfig | ProviderKeyConfig | null
): ProviderEntryFormInput {
  const groupedEntries = config?.apiKeyEntries?.length
    ? config.apiKeyEntries.map((entry) => ({
        apiKey: '',
        existingApiKey: entry.apiKey,
        priority: entry.priority,
        proxyUrl: entry.proxyUrl ?? '',
        authIndex: entry.authIndex,
      }))
    : config?.apiKey
      ? [{ apiKey: '', existingApiKey: config.apiKey, proxyUrl: '' }]
      : [{ apiKey: '', proxyUrl: '' }];
  const providerConfig = config as ProviderKeyConfig | undefined;
  const excludedModels = (config?.excludedModels ?? []).filter((model) => model.trim() !== '*');
  return {
    apiKey: '',
    name: config?.name ?? '',
    baseUrl: config?.baseUrl ?? '',
    proxyUrl: config?.proxyUrl ?? '',
    prefix: config?.prefix ?? '',
    disabled: config?.excludedModels?.some((model) => model.trim() === '*') ?? false,
    disableCooling: config?.disableCooling === true,
    priority: config?.priority,
    models: config?.models?.length
      ? config.models.map((model) => ({
          name: model.name,
          alias: model.alias ?? '',
          priority: model.priority,
          testModel: model.testModel,
        }))
      : [emptyModel()],
    headers: config?.headers
      ? Object.entries(config.headers).map(([key, value]) => ({ key, value: String(value) }))
      : [emptyHeader()],
    excludedModelsText: excludedModels.join('\n'),
    websockets: brand === 'codex' ? providerConfig?.websockets === true : undefined,
    cloak:
      brand === 'claude'
        ? {
            mode: providerConfig?.cloak?.mode ?? '',
            strictMode: providerConfig?.cloak?.strictMode === true,
            sensitiveWordsText: providerConfig?.cloak?.sensitiveWords?.join('\n') ?? '',
            cacheUserId: providerConfig?.cloak?.cacheUserId === true,
          }
        : undefined,
    experimentalCchSigning:
      brand === 'claude' ? providerConfig?.experimentalCchSigning === true : undefined,
    rebuildMidSystemMessage:
      brand === 'claude' ? providerConfig?.rebuildMidSystemMessage === true : undefined,
    testModel: '',
    apiKeyEntries: groupedEntries,
  };
}

export function buildNativeProviderConfig(
  brand: NativeProviderBrand,
  input: ProviderEntryFormInput,
  existing?: GeminiKeyConfig | ProviderKeyConfig | null
): GeminiKeyConfig | ProviderKeyConfig {
  const validation = validateNativeProviderKeyEntries(input.apiKeyEntries);
  if (validation === 'api-key-required') throw new Error('Native provider API key is required');
  if (validation === 'duplicate-api-key') throw new Error('Duplicate native provider API key');

  const entries = normalizedEntries(input.apiKeyEntries);
  const headers = headersFromEntries(input.headers);
  const models = buildModels(input.models);
  const excludedModels = parseTextList(input.excludedModelsText).filter((model) => model !== '*');
  if (input.disabled) excludedModels.unshift('*');

  const existingGrouped = Boolean(existing?.apiKeyEntries?.length);
  const hasEntryOverrides = entries.some(
    (entry) => entry.priority !== undefined || Boolean(entry.proxyUrl)
  );
  const useGrouped =
    existingGrouped || Boolean(input.name.trim()) || entries.length > 1 || hasEntryOverrides;
  const legacyKey = existing?.apiKey?.trim() || input.apiKey.trim();
  const next: ProviderKeyConfig = {
    ...(existing ?? {}),
    name: input.name.trim() || undefined,
    apiKey: useGrouped ? legacyKey : (entries[0]?.apiKey ?? legacyKey),
    apiKeyEntries: useGrouped ? entries : undefined,
    priority: input.priority,
    prefix: input.prefix.trim() || undefined,
    baseUrl: input.baseUrl.trim() || undefined,
    proxyUrl: input.proxyUrl.trim() || undefined,
    models: models.length ? models : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    excludedModels: excludedModels.length ? excludedModels : undefined,
    disableCooling: input.disableCooling === true,
  };

  if (brand === 'codex') next.websockets = input.websockets === true;
  if (brand === 'claude') {
    if (input.cloak) {
      const existingCloak = (existing as ProviderKeyConfig | undefined)?.cloak;
      const cloak: NonNullable<ProviderKeyConfig['cloak']> = {};
      const mode = input.cloak.mode.trim();
      if (mode) cloak.mode = mode;
      if (input.cloak.strictMode || existingCloak?.strictMode !== undefined) {
        cloak.strictMode = input.cloak.strictMode;
      }
      const sensitiveWords = parseTextList(input.cloak.sensitiveWordsText);
      if (sensitiveWords.length) cloak.sensitiveWords = sensitiveWords;
      if (input.cloak.cacheUserId || existingCloak?.cacheUserId !== undefined) {
        cloak.cacheUserId = input.cloak.cacheUserId;
      }
      next.cloak = Object.keys(cloak).length ? cloak : undefined;
    } else {
      next.cloak = undefined;
    }
    next.experimentalCchSigning = input.experimentalCchSigning === true;
    next.rebuildMidSystemMessage = input.rebuildMidSystemMessage === true;
  }
  return next;
}
