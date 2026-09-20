import type { ApiKeyEntry, ModelAlias, OpenAIProviderConfig } from '@/types';

export const OPENAI_PROVIDER_FIELDS = [
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
export const OPENAI_MODEL_ALIAS_FIELDS = [
  ...MODEL_ALIAS_FIELDS,
  'image',
  'type',
  'upstream-path',
] as const;

const serializeModelAliases = (models?: ModelAlias[]) =>
  Array.isArray(models)
    ? models
        .map((model) => {
          if (!model?.name) return null;
          const payload: Record<string, unknown> = { ...model.wireExtras, name: model.name };
          if (model.alias && model.alias !== model.name) {
            payload.alias = model.alias;
          }
          if (model.priority !== undefined) {
            payload.priority = model.priority;
          }
          if (model.testModel) {
            payload['test-model'] = model.testModel;
          }
          if (model.image && !model.type) {
            payload.image = true;
          }
          if (model.type) {
            payload.type = model.type;
            if (model.upstreamPath?.trim()) payload['upstream-path'] = model.upstreamPath.trim();
          }
          if (model.thinking && !model.type) {
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

export const serializeOpenAIProvider = (provider: OpenAIProviderConfig) => {
  const payload: Record<string, unknown> = {
    ...provider.wireExtras,
    name: provider.name,
    'base-url': provider.baseUrl,
    'api-key-entries': Array.isArray(provider.apiKeyEntries)
      ? provider.apiKeyEntries.map((entry) => serializeApiKeyEntry(entry))
      : [],
  };
  if (provider.prefix?.trim()) payload.prefix = provider.prefix.trim();
  if (provider.disabled !== undefined) payload.disabled = provider.disabled;
  const headers =
    provider.headers && Object.keys(provider.headers).length ? provider.headers : undefined;
  if (headers) payload.headers = headers;
  const models = serializeModelAliases(provider.models);
  if (models && models.length) payload.models = models;
  if (provider.priority !== undefined) payload.priority = provider.priority;
  if (provider.testModel) payload['test-model'] = provider.testModel;
  if (provider.disableCooling) payload['disable-cooling'] = true;
  return payload;
};

// Preserve server-managed options while keeping credentials and response metadata
// outside form drafts. These same field lists drive save merging and clears.
export function openAIWireExtras(
  record: Record<string, unknown>,
  managedFields: readonly string[]
): Record<string, unknown> | undefined {
  const extras = { ...record };
  for (const field of [...managedFields, 'auth-index', 'api-key', 'api-keys']) delete extras[field];
  return Object.keys(extras).length ? extras : undefined;
}

export function serializeOpenAIProviderDraft(
  provider: OpenAIProviderConfig
): Record<string, unknown> {
  const payload = serializeOpenAIProvider(provider);
  for (const field of OPENAI_PROVIDER_FIELDS) {
    if (!(field in payload)) payload[field] = null;
  }
  delete payload['api-key-entries'];
  return payload;
}

// Resolve a UI model choice to the public request name without changing legacy chat probes.
export function resolveOpenAIProbeModel(provider: OpenAIProviderConfig, requested: string) {
  const trimmed = requested.trim();
  const prefix = provider.prefix?.trim();
  const name =
    prefix && trimmed.startsWith(`${prefix}/`) ? trimmed.slice(prefix.length + 1) : trimmed;
  const selected = provider.models?.find((model) => model.name === name || model.alias === name);
  return {
    model: selected?.type
      ? [prefix, selected.alias?.trim() || selected.name.trim()].filter(Boolean).join('/')
      : trimmed,
    type: selected?.type,
  };
}
