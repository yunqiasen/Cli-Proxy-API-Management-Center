import type {
  GeminiKeyConfig,
  ModelAlias,
  NativeApiKeyEntry,
  ProviderKeyConfig,
} from '../../types/provider';
import type { ApiKeyEntryInput, ModelEntryInput, ProviderEntryFormInput } from './types';
import { buildModelOptions, readModelOptions } from './modelOptions';
import { readThinkingLevels } from './thinkingLevels';
import { readRuntimePolicy, buildRuntimePolicy } from './runtimePolicy';
import { pickProviderBehavior } from './providerBehavior';

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
  entries: Array<{ key: string; value: string }> | undefined
): Record<string, string> => {
  const headers: Record<string, string> = {};
  (entries ?? []).forEach((entry) => {
    const key = entry.key.trim();
    if (key) headers[key] = entry.value;
  });
  return headers;
};

const buildModels = (models: ModelEntryInput[]): ModelAlias[] =>
  models
    .map((model) => ({
      sourceIndex: model.sourceIndex,
      name: model.name.trim(),
      alias: model.alias?.trim() || undefined,
      priority: model.priority,
      testModel: model.testModel,
      ...buildModelOptions(model),
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
        ...(entry.weight !== undefined ? { weight: entry.weight } : {}),
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
        weight: entry.weight,
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
    runtimePolicy: readRuntimePolicy(config ?? undefined),
    priority: config?.priority,
    weight: config?.weight,
    models: config?.models?.length
      ? config.models.map((model) => ({
          sourceIndex: model.sourceIndex,
          name: model.name,
          alias: model.alias ?? '',
          priority: model.priority,
          testModel: model.testModel,
          ...readModelOptions(model),
          thinkingJson:
            model.thinking === undefined ? undefined : JSON.stringify(model.thinking, null, 2),
          thinkingLevels: readThinkingLevels(model.thinking),
        }))
      : [emptyModel()],
    headers: config?.headers
      ? Object.entries(config.headers).map(([key, value]) => ({ key, value: String(value) }))
      : [emptyHeader()],
    excludedModelsText: excludedModels.join('\n'),
    websockets: brand === 'codex' ? providerConfig?.websockets === true : undefined,
    disableImageGeneration:
      brand === 'codex' ? providerConfig?.disableImageGeneration === true : undefined,
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
    fingerprintProfile: brand === 'claude' ? (providerConfig?.fingerprintProfile ?? '') : undefined,
    testModel: '',
    apiKeyEntries: groupedEntries,
    ...pickProviderBehavior(config ?? {}, brand),
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

  return buildNativeProviderDraft(brand, input, existing);
}

// Probes use the save draft without validating credentials they will not send.
export function buildNativeProviderDraft(
  brand: NativeProviderBrand,
  input: ProviderEntryFormInput,
  existing?: GeminiKeyConfig | ProviderKeyConfig | null
): GeminiKeyConfig | ProviderKeyConfig {
  const entries = normalizedEntries(input.apiKeyEntries);
  const headers = headersFromEntries(input.headers);
  const models = buildModels(input.models).map((model) => {
    const saved =
      model.sourceIndex !== undefined && model.sourceIndex !== null
        ? existing?.models?.find((candidate) => candidate.sourceIndex === model.sourceIndex)
        : existing?.models?.find((candidate) => candidate.name.trim() === model.name.trim());
    if (!saved) return model;
    return {
      ...model,
      ...(saved.wireExtras ? { wireExtras: saved.wireExtras } : {}),
    };
  });
  const excludedModels = parseTextList(input.excludedModelsText).filter((model) => model !== '*');
  if (input.disabled) excludedModels.unshift('*');

  const existingGrouped = Boolean(existing?.apiKeyEntries?.length);
  const hasEntryOverrides = entries.some(
    (entry) => entry.priority !== undefined || entry.weight !== undefined || Boolean(entry.proxyUrl)
  );
  // Only switch to grouped mode when the key already has its own entries, the
  // user explicitly entered a name, or there are multiple keys / per-key
  // overrides. A name that was inherited from the group for display must not
  // silently upgrade a single key into a named group.
  const userNamed = input.name.trim() && input.name !== existing?.name;
  const useGrouped =
    existingGrouped || Boolean(userNamed) || entries.length > 1 || hasEntryOverrides;
  const legacyKey = existing?.apiKey?.trim() || input.apiKey.trim();
  const policyFields = input.runtimePolicy
    ? buildRuntimePolicy(
        input.runtimePolicy,
        brand === 'gemini' || brand === 'codex' || brand === 'claude'
      )
    : {};
  const next: ProviderKeyConfig = {
    ...(existing ?? {}),
    name: input.name.trim() || undefined,
    apiKey: useGrouped ? legacyKey : (entries[0]?.apiKey ?? legacyKey),
    apiKeyEntries: useGrouped ? entries : undefined,
    priority: input.priority,
    weight: input.weight,
    prefix: input.prefix.trim() || undefined,
    baseUrl: input.baseUrl.trim() || undefined,
    proxyUrl: input.proxyUrl.trim() || undefined,
    models: models.length ? models : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    excludedModels: excludedModels.length ? excludedModels : undefined,
    disableCooling: input.disableCooling,
    ...policyFields,
    authIndex: existing?.authIndex,
    ...pickProviderBehavior(input, brand),
  };

  if (brand === 'codex') {
    next.websockets = input.websockets === true;
    next.disableImageGeneration = input.disableImageGeneration === true;
  }
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
    next.fingerprintProfile = input.fingerprintProfile?.trim() || undefined;
  }
  return next;
}
