import type { ModelAlias, OpenAIProviderConfig } from '@/types';
import type { ProviderEntryFormInput } from './types';
import { buildModelOptions } from './modelOptions';
import { buildRuntimePolicy } from './runtimePolicy';
import { pickProviderBehavior } from './providerBehavior';

export const headersFromEntries = (
  entries: Array<{ key: string; value: string }>
): Record<string, string> => {
  const out: Record<string, string> = {};
  entries.forEach((entry) => {
    const key = entry.key.trim();
    if (!key) return;
    out[key] = entry.value;
  });
  return out;
};

export const buildModelAliases = (
  models: ProviderEntryFormInput['models'] | undefined,
  includeImage = false
): ModelAlias[] =>
  (models ?? [])
    .map((m) => {
      const entry: ModelAlias = {
        name: m.name.trim(),
        alias: m.alias?.trim() || undefined,
        priority: m.priority,
        testModel: m.testModel,
        sourceIndex: m.sourceIndex,
        ...buildModelOptions(includeImage && m.type ? { ...m, thinkingEnabled: false } : m),
      };
      if (includeImage) {
        if (m.type) entry.thinking = undefined;
        entry.wireExtras = m.wireExtras;
        entry.image = !m.type && m.image === true;
        entry.type = m.type;
        entry.upstreamPath = m.type ? m.upstreamPath?.trim() || undefined : undefined;
      }
      return entry;
    })
    .filter((m) => m.name);

export const buildOpenAIConfig = (
  input: ProviderEntryFormInput,
  existing?: OpenAIProviderConfig | null,
  preserveSourceIndexes = false
): OpenAIProviderConfig => {
  const headers = headersFromEntries(input.headers);
  const models = buildModelAliases(input.models, true);
  const apiKeyEntries =
    input.apiKeyEntries
      ?.map((entry, index) => {
        const fallbackApiKey =
          entry.existingApiKey?.trim() || existing?.apiKeyEntries?.[index]?.apiKey?.trim() || '';
        return {
          ...(preserveSourceIndexes && entry.sourceIndex !== undefined
            ? { sourceIndex: entry.sourceIndex }
            : {}),
          apiKey: entry.apiKey.trim() || fallbackApiKey,
          proxyUrl: entry.proxyUrl.trim() || undefined,
          weight: entry.weight,
          authIndex: entry.authIndex?.trim() || undefined,
        };
      })
      .filter((entry) => entry.apiKey) ?? [];

  return {
    ...(existing ?? {}),
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    prefix: input.prefix.trim() || undefined,
    apiKeyEntries,
    disabled: input.disabled,
    disableCooling: input.disableCooling,
    ...(input.runtimePolicy ? buildRuntimePolicy(input.runtimePolicy) : {}),
    ...pickProviderBehavior(input, 'openaiCompatibility'),
    headers: Object.keys(headers).length ? headers : undefined,
    models: models.length ? models : undefined,
    priority: input.priority,
    testModel: input.testModel?.trim() || undefined,
  };
};
