import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { providersApi } from '@/services/api';
import { getErrorMessage } from '@/utils/helpers';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  stripDisableAllModelsRule,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import type {
  GeminiKeyConfig,
  ModelAlias,
  OpenAIProviderConfig,
  ProviderKeyConfig,
  MediaProviderConfig,
  MediaOperationConfig,
} from '@/types';
import {
  apiKeyFunToResource,
  claudeApiToResource,
  claudeToResource,
  code0ToResource,
  codexToResource,
  fennoAIToResource,
  geminiToResource,
  interactionsToResource,
  openaiToResource,
  qiniuCloudToResource,
  kimiToResource,
  mediaToResource,
  vertexToResource,
  xaiToResource,
} from './adapters';
import { PROVIDER_BRAND_ORDER } from './descriptors';
import type {
  ProviderBrand,
  ProviderEntryFormInput,
  MediaOperationInput,
  ProviderGroup,
  ProviderResource,
  ProviderSnapshot,
  SponsorKeyEntryInput,
  SponsorProviderBrand,
  SponsorProviderRaw,
} from './types';
import {
  buildApiKeyFunRaw,
  isApiKeyFunClaudeProvider,
  isApiKeyFunCodexProvider,
  isApiKeyFunOpenAIProvider,
} from './sponsor';
import { CLAUDE_API_BASE_URL, isClaudeApiProvider } from './claudeApi';
import {
  buildCode0Raw,
  isCode0ClaudeProvider,
  isCode0CodexProvider,
  isCode0GeminiProvider,
  isCode0OpenAIProvider,
} from './code0';
import { buildFennoAIRaw, isFennoAIClaudeProvider, isFennoAICodexProvider } from './fennoAI';
import {
  buildQiniuCloudRaw,
  isQiniuCloudClaudeProvider,
  isQiniuCloudCodexProvider,
  isQiniuCloudGeminiProvider,
  isQiniuCloudOpenAIProvider,
} from './qiniuCloud';
import { buildKimiRaw, isKimiClaudeProvider, isKimiOpenAIProvider } from './kimi';
import { getSponsorProviderDefinition, type SponsorProtocolUrls } from './sponsorDefinitions';
import { runSponsorMutationWithRecovery } from './sponsorMutationRecovery';
import { buildNativeProviderConfig } from './nativeProviderForm';

export interface UseProviderWorkbenchResult {
  connected: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  snapshot: ProviderSnapshot | null;
  refetch: () => Promise<void>;

  createProvider: (brand: ProviderBrand, input: ProviderEntryFormInput) => Promise<void>;
  updateProvider: (resource: ProviderResource, input: ProviderEntryFormInput) => Promise<void>;
  deleteProvider: (resource: ProviderResource) => Promise<void>;
  toggleDisabled: (resource: ProviderResource, disabled: boolean) => Promise<void>;
  mutating: boolean;
  refreshSnapshot: () => void;
}

/* -------------------------------------------------------------------------- */
/* form -> backend config 转换                                                 */
/* -------------------------------------------------------------------------- */

const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const headersFromEntries = (
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

const parseThinkingJson = (value: string | undefined): Record<string, unknown> | undefined => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Thinking config must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

const buildExcludedModels = (
  textValue: string,
  disabled: boolean,
  brand: ProviderBrand
): string[] | undefined => {
  const list = parseTextList(textValue);
  const filtered = list.filter((v) => v !== '*');
  if (brand === 'openaiCompatibility') {
    return filtered.length ? filtered : undefined;
  }
  if (disabled) {
    return withDisableAllModelsRule(filtered);
  }
  return filtered.length ? filtered : undefined;
};

const buildModelAliases = (
  models: ProviderEntryFormInput['models'] | undefined,
  includeOpenAIFields = false
): ModelAlias[] =>
  (models ?? [])
    .map((m) => {
      const entry: ModelAlias = {
        name: m.name.trim(),
        alias: m.alias?.trim() || undefined,
        priority: m.priority,
        testModel: m.testModel,
      };
      if (includeOpenAIFields) {
        entry.image = m.image === true;
        entry.thinking = parseThinkingJson(m.thinkingJson);
      }
      return entry;
    })
    .filter((m) => m.name);

const buildProviderKeyConfig = (
  brand: 'gemini' | 'interactions' | 'codex' | 'xai' | 'claude' | 'vertex',
  input: ProviderEntryFormInput,
  existing?: ProviderKeyConfig | GeminiKeyConfig | null
): ProviderKeyConfig | GeminiKeyConfig => {
  const headers = headersFromEntries(input.headers);
  const models = buildModelAliases(input.models);
  const excluded = buildExcludedModels(input.excludedModelsText, input.disabled, brand);
  const apiKeyChanged = input.apiKey.trim().length > 0;
  const next: ProviderKeyConfig = {
    apiKey: apiKeyChanged ? input.apiKey.trim() : (existing?.apiKey ?? ''),
    priority: input.priority,
    weight: input.weight,
    prefix: input.prefix.trim() || undefined,
    baseUrl: input.baseUrl.trim() || undefined,
    proxyUrl: input.proxyUrl.trim() || undefined,
    models: models.length ? models : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    excludedModels: excluded,
    disableCooling: input.disableCooling === true,
    authIndex: existing?.authIndex,
  };
  if ((brand === 'codex' || brand === 'xai') && input.websockets !== undefined) {
    next.websockets = input.websockets;
  }
  if (brand === 'claude' && input.cloak) {
    next.cloak = {
      mode: input.cloak.mode.trim() || undefined,
      strictMode: input.cloak.strictMode,
      sensitiveWords: parseTextList(input.cloak.sensitiveWordsText),
      cacheUserId: input.cloak.cacheUserId === true,
    };
  }
  if (brand === 'claude') {
    next.experimentalCchSigning = input.experimentalCchSigning === true;
  }
  return next;
};

const buildClaudeApiConfig = (
  input: ProviderEntryFormInput,
  existing?: ProviderKeyConfig | null
): ProviderKeyConfig =>
  buildProviderKeyConfig(
    'claude',
    {
      ...input,
      baseUrl: CLAUDE_API_BASE_URL,
    },
    existing
  ) as ProviderKeyConfig;

const splitMediaText = (value: string): string[] =>
  value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const emptyMediaOperation = (): MediaOperationInput => ({
  name: '',
  capability: '',
  method: 'POST',
  path: '',
  requestFormat: 'json',
  modelMode: 'optional',
  model: '',
  responseFormat: 'passthrough',
  resultPath: '',
  asyncEnabled: false,
  taskIdPath: '',
  pollMethod: 'GET',
  pollPath: '',
  statusPath: '',
  successValuesText: 'completed',
  failureValuesText: 'failed',
  asyncResultPath: '',
  pollInterval: '3s',
});

const buildMediaProviderFormInput = (
  brand: 'image' | 'video' | 'audio',
  config?: MediaProviderConfig | null
): ProviderEntryFormInput => ({
  apiKey: '',
  name: config?.name ?? '',
  baseUrl: config?.baseUrl ?? '',
  proxyUrl: config?.apiKeyEntries?.[0]?.proxyUrl ?? '',
  prefix: config?.prefix ?? '',
  disabled: config?.disabled === true,
  disableCooling: config?.disableCooling === true,
  priority: config?.priority,
  mediaKind: brand,
  headers: config?.headers
    ? Object.entries(config.headers).map(([key, value]) => ({ key, value: String(value) }))
    : [{ key: '', value: '' }],
  excludedModelsText: '',
  models: config?.models?.length
    ? config.models.map((model) => ({
        name: model.name,
        alias: model.alias ?? '',
        displayName: model.displayName ?? '',
        forceMapping: model.forceMapping === true,
        capabilities: [...(model.capabilities ?? [])],
      }))
    : [{ name: '', alias: '', capabilities: [] }],
  operations: config?.operations?.length
    ? config.operations.map((operation) => ({
        name: operation.name,
        capability: operation.capability ?? '',
        method: operation.method,
        path: operation.path,
        requestFormat: operation.requestFormat,
        modelMode: operation.modelMode,
        model: operation.model ?? '',
        responseFormat: operation.responseFormat,
        resultPath: operation.resultPath ?? '',
        asyncEnabled: Boolean(operation.async),
        taskIdPath: operation.async?.taskIdPath ?? '',
        pollMethod: operation.async?.pollMethod ?? 'GET',
        pollPath: operation.async?.pollPath ?? '',
        statusPath: operation.async?.statusPath ?? '',
        successValuesText: operation.async?.successValues?.join('\n') ?? 'completed',
        failureValuesText: operation.async?.failureValues?.join('\n') ?? 'failed',
        asyncResultPath: operation.async?.resultPath ?? '',
        pollInterval: operation.async?.pollInterval ?? '3s',
      }))
    : [emptyMediaOperation()],
  apiKeyEntries: config?.apiKeyEntries?.length
    ? config.apiKeyEntries.map((entry) => ({
        apiKey: '',
        existingApiKey: entry.apiKey,
        priority: entry.priority,
        proxyUrl: entry.proxyUrl ?? '',
        authIndex: entry.authIndex,
      }))
    : [{ apiKey: '', proxyUrl: '', authIndex: config?.authIndex }],
  testModel: '',
  cloak: undefined,
});

const buildMediaProviderConfig = (
  brand: 'image' | 'video' | 'audio',
  input: ProviderEntryFormInput,
  existing?: MediaProviderConfig | null
): MediaProviderConfig => {
  const apiKeyEntries = (input.apiKeyEntries ?? [])
    .map((entry, index) => ({
      apiKey:
        entry.apiKey.trim() ||
        entry.existingApiKey?.trim() ||
        existing?.apiKeyEntries?.[index]?.apiKey?.trim() ||
        '',
      priority: entry.priority,
      proxyUrl: entry.proxyUrl.trim() || undefined,
      authIndex: entry.authIndex,
    }))
    .filter((entry) => entry.apiKey);
  const headers = headersFromEntries(input.headers);
  const models = (input.models ?? [])
    .map((model) => ({
      name: model.name.trim(),
      alias: model.alias?.trim() || undefined,
      displayName: model.displayName?.trim() || undefined,
      forceMapping: model.forceMapping === true || undefined,
      capabilities: (model.capabilities ?? []).map((item) => item.trim()).filter(Boolean),
    }))
    .filter((model) => model.name);
  const operations = (input.operations ?? [])
    .map((operation) => {
      const result: MediaOperationConfig = {
        name: operation.name.trim(),
        capability: operation.capability.trim() || undefined,
        method: operation.method.trim().toUpperCase() || 'POST',
        path: operation.path.trim(),
        requestFormat: operation.requestFormat,
        modelMode: operation.modelMode,
        model: operation.modelMode === 'none' ? undefined : operation.model.trim() || undefined,
        responseFormat: operation.responseFormat,
        resultPath: operation.resultPath.trim() || undefined,
      };
      if (operation.asyncEnabled) {
        result.async = {
          taskIdPath: operation.taskIdPath.trim(),
          pollMethod: operation.pollMethod.trim().toUpperCase() || 'GET',
          pollPath: operation.pollPath.trim(),
          statusPath: operation.statusPath.trim(),
          successValues: splitMediaText(operation.successValuesText),
          failureValues: splitMediaText(operation.failureValuesText),
          resultPath: operation.asyncResultPath.trim() || undefined,
          pollInterval: operation.pollInterval.trim() || undefined,
        };
      }
      return result;
    })
    .filter((operation) => operation.name && operation.path);
  const providerAuthIndex =
    apiKeyEntries.length === 0
      ? input.apiKeyEntries?.find((entry) => entry.authIndex?.trim())?.authIndex?.trim() ||
        existing?.authIndex
      : undefined;
  return {
    ...(existing ?? {}),
    name: input.name.trim(),
    kind: brand,
    baseUrl: input.baseUrl.trim(),
    priority: input.priority,
    disabled: input.disabled,
    disableCooling: input.disableCooling === true,
    prefix: input.prefix.trim() || undefined,
    authIndex: providerAuthIndex,
    apiKeyEntries,
    headers: Object.keys(headers).length ? headers : undefined,
    models: models.length ? models : undefined,
    operations: operations.length ? operations : undefined,
  };
};

const buildOpenAIConfig = (
  input: ProviderEntryFormInput,
  existing?: OpenAIProviderConfig | null
): OpenAIProviderConfig => {
  const headers = headersFromEntries(input.headers);
  const models = buildModelAliases(input.models, true);
  const apiKeyEntries =
    input.apiKeyEntries
      ?.map((entry, index) => {
        const fallbackApiKey =
          entry.existingApiKey?.trim() || existing?.apiKeyEntries?.[index]?.apiKey?.trim() || '';
        return {
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
    disableCooling: input.disableCooling === true,
    headers: Object.keys(headers).length ? headers : undefined,
    models: models.length ? models : undefined,
    priority: input.priority,
    testModel: input.testModel?.trim() || undefined,
  };
};

const sponsorEntryApiKey = (entry: SponsorKeyEntryInput): string =>
  entry.apiKey.trim() || entry.existingApiKey?.trim() || '';

const buildSponsorOpenAIConfig = (
  entry: SponsorKeyEntryInput,
  providerName: string,
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: OpenAIProviderConfig
): OpenAIProviderConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models, true);
  const apiKey = sponsorEntryApiKey(entry);
  const firstExistingEntry = existing?.apiKeyEntries?.[0];
  const apiKeyEntries = apiKey
    ? [
        {
          ...(firstExistingEntry ?? {}),
          apiKey,
          proxyUrl: entry.proxyUrl.trim() || undefined,
          weight: entry.weight,
        },
      ]
    : [];

  return {
    ...(existing ?? {}),
    name: providerName,
    baseUrl: urls.openai,
    prefix: entry.prefix.trim() || undefined,
    disabled: entry.disabled,
    disableCooling: entry.disableCooling === true,
    priority: entry.priority,
    apiKeyEntries,
    models: models.length ? models : undefined,
  };
};

const buildSponsorProviderKeyConfig = (
  entry: SponsorKeyEntryInput,
  protocol: 'claude' | 'codex',
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: ProviderKeyConfig
): ProviderKeyConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models);
  const apiKey = sponsorEntryApiKey(entry);
  const excluded = entry.disabled
    ? withDisableAllModelsRule(stripDisableAllModelsRule(existing?.excludedModels))
    : withoutDisableAllModelsRule(existing?.excludedModels);

  return {
    ...(existing ?? {}),
    apiKey,
    baseUrl: protocol === 'claude' ? urls.anthropic : urls.codex,
    proxyUrl: entry.proxyUrl.trim() || undefined,
    prefix: entry.prefix.trim() || undefined,
    priority: entry.priority,
    weight: entry.weight,
    disableCooling: entry.disableCooling === true,
    excludedModels: excluded,
    models: models.length ? models : undefined,
  };
};

const buildSponsorGeminiConfig = (
  entry: SponsorKeyEntryInput,
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: GeminiKeyConfig
): GeminiKeyConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models);
  const apiKey = sponsorEntryApiKey(entry);
  const excluded = entry.disabled
    ? withDisableAllModelsRule(stripDisableAllModelsRule(existing?.excludedModels))
    : withoutDisableAllModelsRule(existing?.excludedModels);

  return {
    ...(existing ?? {}),
    apiKey,
    baseUrl: urls.gemini,
    proxyUrl: entry.proxyUrl.trim() || undefined,
    prefix: entry.prefix.trim() || undefined,
    priority: entry.priority,
    weight: entry.weight,
    disableCooling: entry.disableCooling === true,
    excludedModels: excluded,
    models: models.length ? models : undefined,
  };
};

const normalizeSponsorKeyEntries = (
  entries: SponsorKeyEntryInput[] | undefined
): SponsorKeyEntryInput[] => (entries ?? []).filter((entry) => sponsorEntryApiKey(entry));

const toggleSponsorConfig = async (raw: SponsorProviderRaw, disabled: boolean) => {
  for (const item of raw.gemini) {
    const excludedModels = disabled
      ? withDisableAllModelsRule(item.config.excludedModels)
      : withoutDisableAllModelsRule(item.config.excludedModels);
    await providersApi.updateGeminiKey(item.config.apiKey, item.config.baseUrl, {
      ...item.config,
      excludedModels,
    });
  }
  for (const item of raw.codex) {
    const excludedModels = disabled
      ? withDisableAllModelsRule(item.config.excludedModels)
      : withoutDisableAllModelsRule(item.config.excludedModels);
    await providersApi.updateCodexConfig(item.config.apiKey, item.config.baseUrl, {
      ...item.config,
      excludedModels,
    });
  }
  for (const item of raw.claude) {
    const excludedModels = disabled
      ? withDisableAllModelsRule(item.config.excludedModels)
      : withoutDisableAllModelsRule(item.config.excludedModels);
    await providersApi.updateClaudeConfig(item.config.apiKey, item.config.baseUrl, {
      ...item.config,
      excludedModels,
    });
  }
  for (const item of raw.openai) {
    await providersApi.updateOpenAIProviderDisabled(item.index, disabled);
  }
};

/* -------------------------------------------------------------------------- */
/* hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useProviderWorkbench(): UseProviderWorkbenchResult {
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const config = useConfigStore((s) => s.config);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  const updateConfigValue = useConfigStore((s) => s.updateConfigValue);
  const isCacheValid = useConfigStore((s) => s.isCacheValid);

  const [isPending, setIsPending] = useState<boolean>(() => !isCacheValid());
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mutating, setMutating] = useState<boolean>(false);
  const [fetchedAt, setFetchedAt] = useState<string>(() => new Date().toISOString());

  const hasFetchedRef = useRef(false);

  const connected = connectionStatus === 'connected';

  const refetch = useCallback(async () => {
    setIsFetching(true);
    setErrorMessage(null);
    try {
      const [configResult, vertexResult, openaiResult, mediaResult] = await Promise.allSettled([
        fetchConfig(true),
        providersApi.getVertexConfigs(),
        providersApi.getOpenAIProviders(),
        providersApi.getMediaProviders(),
      ]);
      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }
      if (vertexResult.status === 'fulfilled') {
        updateConfigValue('vertex-api-key', vertexResult.value || []);
      }
      if (openaiResult.status === 'fulfilled') {
        updateConfigValue('openai-compatibility', openaiResult.value || []);
      }
      if (mediaResult.status === 'fulfilled') {
        updateConfigValue('media-providers', mediaResult.value || []);
      }
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setErrorMessage(getErrorMessage(err) || 'Failed to load providers');
    } finally {
      setIsPending(false);
      setIsFetching(false);
    }
  }, [fetchConfig, updateConfigValue]);

  const refreshSnapshot = useCallback(() => {
    setFetchedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    if (!connected) return;
    hasFetchedRef.current = true;
    refetch().catch(() => {});
  }, [connected, refetch]);

  /* ------------------- snapshot 计算 ------------------- */

  const snapshot = useMemo<ProviderSnapshot | null>(() => {
    if (!config) return null;
    const groups: ProviderGroup[] = PROVIDER_BRAND_ORDER.map((brand) => {
      let resources: ProviderResource[] = [];
      switch (brand) {
        case 'gemini':
          resources = (config.geminiApiKeys ?? []).reduce<ProviderResource[]>(
            (out, item, index) => {
              if (!isCode0GeminiProvider(item) && !isQiniuCloudGeminiProvider(item)) {
                out.push(geminiToResource(item, index));
              }
              return out;
            },
            []
          );
          break;
        case 'interactions':
          resources = (config.interactionsApiKeys ?? []).map((item, index) =>
            interactionsToResource(item, index)
          );
          break;
        case 'codex':
          resources = (config.codexApiKeys ?? []).reduce<ProviderResource[]>((out, item, index) => {
            if (
              !isApiKeyFunCodexProvider(item) &&
              !isCode0CodexProvider(item) &&
              !isFennoAICodexProvider(item) &&
              !isQiniuCloudCodexProvider(item)
            ) {
              out.push(codexToResource(item, index));
            }
            return out;
          }, []);
          break;
        case 'xai':
          resources = (config.xaiApiKeys ?? []).map((item, index) => xaiToResource(item, index));
          break;
        case 'claude':
          resources = (config.claudeApiKeys ?? []).reduce<ProviderResource[]>(
            (out, item, index) => {
              if (
                !isApiKeyFunClaudeProvider(item) &&
                !isCode0ClaudeProvider(item) &&
                !isFennoAIClaudeProvider(item) &&
                !isQiniuCloudClaudeProvider(item) &&
                !isKimiClaudeProvider(item) &&
                !isClaudeApiProvider(item)
              ) {
                out.push(claudeToResource(item, index));
              }
              return out;
            },
            []
          );
          break;
        case 'claudeApi':
          resources = (config.claudeApiKeys ?? []).reduce<ProviderResource[]>(
            (out, item, index) => {
              if (isClaudeApiProvider(item)) {
                out.push(claudeApiToResource(item, index));
              }
              return out;
            },
            []
          );
          break;
        case 'vertex':
          resources = (config.vertexApiKeys ?? []).map((c, i) => vertexToResource(c, i));
          break;
        case 'openaiCompatibility':
          resources = (config.openaiCompatibility ?? []).reduce<ProviderResource[]>(
            (out, item, index) => {
              if (
                !isApiKeyFunOpenAIProvider(item) &&
                !isCode0OpenAIProvider(item) &&
                !isQiniuCloudOpenAIProvider(item) &&
                !isKimiOpenAIProvider(item)
              ) {
                out.push(openaiToResource(item, index));
              }
              return out;
            },
            []
          );
          break;
        case 'image':
        case 'video':
        case 'audio':
          resources = (config.mediaProviders ?? [])
            .filter((item) => item.kind === brand)
            .map((item, index) => mediaToResource(item, item.sourceIndex ?? index, brand));
          break;
        case 'apikeyFun': {
          const sponsorResource = apiKeyFunToResource(buildApiKeyFunRaw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
        case 'code0': {
          const sponsorResource = code0ToResource(buildCode0Raw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
        case 'fennoAI': {
          const sponsorResource = fennoAIToResource(buildFennoAIRaw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
        case 'qiniuCloud': {
          const sponsorResource = qiniuCloudToResource(buildQiniuCloudRaw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
        case 'kimi': {
          const sponsorResource = kimiToResource(buildKimiRaw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
      }
      return {
        id: brand,
        resources,
      };
    });
    return {
      fetchedAt,
      groups,
    };
  }, [config, fetchedAt]);

  /* ------------------- mutations ------------------- */

  const persistSponsorConfig = useCallback(
    async (brand: SponsorProviderBrand, input: ProviderEntryFormInput) => {
      const definition = getSponsorProviderDefinition(brand);
      const raw =
        brand === 'apikeyFun'
          ? buildApiKeyFunRaw(config)
          : brand === 'code0'
            ? buildCode0Raw(config)
            : brand === 'fennoAI'
              ? buildFennoAIRaw(config)
              : brand === 'qiniuCloud'
                ? buildQiniuCloudRaw(config)
                : buildKimiRaw(config);
      const entries = normalizeSponsorKeyEntries(input.sponsorKeyEntries);
      const openaiEntry = entries.find((entry) => entry.protocol === 'openai');
      const claudeEntry = entries.find((entry) => entry.protocol === 'claude');
      const codexEntry = entries.find((entry) => entry.protocol === 'codex');
      const geminiEntry = entries.find((entry) => entry.protocol === 'gemini');

      if (definition.protocols.includes('gemini')) {
        const current = raw.gemini[0];
        if (geminiEntry) {
          const next = buildSponsorGeminiConfig(
            geminiEntry,
            definition.getProtocolUrls,
            current?.config
          );
          if (current) {
            await providersApi.updateGeminiKey(current.config.apiKey, current.config.baseUrl, next);
          } else {
            await providersApi.createGeminiKey(next);
          }
        } else {
          for (const item of raw.gemini) {
            await providersApi.deleteGeminiKey(item.config.apiKey, item.config.baseUrl);
          }
        }
      }

      const currentCodex = raw.codex[0];
      if (codexEntry) {
        const next = buildSponsorProviderKeyConfig(
          codexEntry,
          'codex',
          definition.getProtocolUrls,
          currentCodex?.config
        );
        if (currentCodex) {
          await providersApi.updateCodexConfig(
            currentCodex.config.apiKey,
            currentCodex.config.baseUrl,
            next
          );
        } else {
          await providersApi.createCodexConfig(next);
        }
      } else {
        for (const item of raw.codex) {
          await providersApi.deleteCodexConfig(item.config.apiKey, item.config.baseUrl);
        }
      }

      const currentClaude = raw.claude[0];
      if (claudeEntry) {
        const next = buildSponsorProviderKeyConfig(
          claudeEntry,
          'claude',
          definition.getProtocolUrls,
          currentClaude?.config
        );
        if (currentClaude) {
          await providersApi.updateClaudeConfig(
            currentClaude.config.apiKey,
            currentClaude.config.baseUrl,
            next
          );
        } else {
          await providersApi.createClaudeConfig(next);
        }
      } else {
        for (const item of raw.claude) {
          await providersApi.deleteClaudeConfig(item.config.apiKey, item.config.baseUrl);
        }
      }

      const currentOpenAI = raw.openai[0];
      if (openaiEntry) {
        const next = buildSponsorOpenAIConfig(
          openaiEntry,
          definition.providerName,
          definition.getProtocolUrls,
          currentOpenAI?.config
        );
        if (currentOpenAI) {
          await providersApi.updateOpenAIProvider(
            currentOpenAI.config.name,
            currentOpenAI.index,
            next
          );
        } else {
          await providersApi.createOpenAIProvider(next);
        }
      } else if (currentOpenAI) {
        await providersApi.deleteOpenAIProvider(currentOpenAI.index);
      }
    },
    [config]
  );

  const createProvider = useCallback(
    async (brand: ProviderBrand, input: ProviderEntryFormInput) => {
      setMutating(true);
      try {
        if (brand === 'gemini') {
          await providersApi.createGeminiKey(
            buildNativeProviderConfig('gemini', input) as GeminiKeyConfig
          );
        } else if (brand === 'interactions') {
          await providersApi.createInteractionsKey(
            buildProviderKeyConfig('interactions', input) as GeminiKeyConfig
          );
        } else if (brand === 'codex') {
          await providersApi.createCodexConfig(
            buildNativeProviderConfig('codex', input) as ProviderKeyConfig
          );
        } else if (brand === 'xai') {
          await providersApi.createXAIConfig(
            buildProviderKeyConfig('xai', input) as ProviderKeyConfig
          );
        } else if (brand === 'claude') {
          await providersApi.createClaudeConfig(
            buildNativeProviderConfig('claude', input) as ProviderKeyConfig
          );
        } else if (brand === 'claudeApi') {
          await providersApi.createClaudeConfig(buildClaudeApiConfig(input));
        } else if (brand === 'vertex') {
          await providersApi.createVertexConfig(
            buildProviderKeyConfig('vertex', input) as ProviderKeyConfig
          );
        } else if (brand === 'openaiCompatibility') {
          await providersApi.createOpenAIProvider(buildOpenAIConfig(input));
        } else if (brand === 'image' || brand === 'video' || brand === 'audio') {
          await providersApi.createMediaProvider(buildMediaProviderConfig(brand, input));
        } else if (
          brand === 'apikeyFun' ||
          brand === 'code0' ||
          brand === 'fennoAI' ||
          brand === 'qiniuCloud' ||
          brand === 'kimi'
        ) {
          await runSponsorMutationWithRecovery(() => persistSponsorConfig(brand, input), refetch);
        }
        await refetch();
      } finally {
        setMutating(false);
      }
    },
    [persistSponsorConfig, refetch]
  );

  const updateProvider = useCallback(
    async (resource: ProviderResource, input: ProviderEntryFormInput) => {
      setMutating(true);
      try {
        const brand = resource.brand;
        const selector = resource.selector;
        if (brand === 'gemini' && selector.brand === 'gemini') {
          const existing = resource.raw as GeminiKeyConfig;
          await providersApi.updateGeminiKeyAtIndex(
            selector.index,
            buildNativeProviderConfig('gemini', input, existing) as GeminiKeyConfig
          );
        } else if (brand === 'interactions' && selector.brand === 'interactions') {
          const existing = resource.raw as GeminiKeyConfig;
          await providersApi.updateInteractionsKey(
            selector.apiKey,
            selector.baseUrl,
            buildProviderKeyConfig('interactions', input, existing) as GeminiKeyConfig
          );
        } else if (brand === 'codex' && selector.brand === 'codex') {
          const existing = resource.raw as ProviderKeyConfig;
          await providersApi.updateCodexConfigAtIndex(
            selector.index,
            buildNativeProviderConfig('codex', input, existing) as ProviderKeyConfig
          );
        } else if (brand === 'xai' && selector.brand === 'xai') {
          const existing = resource.raw as ProviderKeyConfig;
          await providersApi.updateXAIConfig(
            selector.apiKey,
            selector.baseUrl,
            buildProviderKeyConfig('xai', input, existing) as ProviderKeyConfig
          );
        } else if (brand === 'claude' && selector.brand === 'claude') {
          const existing = resource.raw as ProviderKeyConfig;
          await providersApi.updateClaudeConfigAtIndex(
            selector.index,
            buildNativeProviderConfig('claude', input, existing) as ProviderKeyConfig
          );
        } else if (brand === 'claudeApi' && selector.brand === 'claudeApi') {
          await providersApi.updateClaudeConfig(
            selector.apiKey,
            selector.baseUrl,
            buildClaudeApiConfig(input, resource.raw as ProviderKeyConfig)
          );
        } else if (brand === 'vertex' && selector.brand === 'vertex') {
          const existing = resource.raw as ProviderKeyConfig;
          await providersApi.updateVertexConfig(
            selector.apiKey,
            selector.baseUrl,
            buildProviderKeyConfig('vertex', input, existing) as ProviderKeyConfig
          );
        } else if (brand === 'openaiCompatibility' && selector.brand === 'openaiCompatibility') {
          await providersApi.updateOpenAIProvider(
            selector.name,
            selector.index,
            buildOpenAIConfig(input, resource.raw as OpenAIProviderConfig)
          );
        } else if (brand === 'image' || brand === 'video' || brand === 'audio') {
          if (selector.brand !== brand) throw new Error('Media provider selector mismatch');
          await providersApi.updateMediaProvider(
            selector.index,
            buildMediaProviderConfig(brand, input, resource.raw as MediaProviderConfig)
          );
        } else if (
          brand === 'apikeyFun' ||
          brand === 'code0' ||
          brand === 'fennoAI' ||
          brand === 'qiniuCloud' ||
          brand === 'kimi'
        ) {
          await runSponsorMutationWithRecovery(() => persistSponsorConfig(brand, input), refetch);
        }
        await refetch();
      } finally {
        setMutating(false);
      }
    },
    [persistSponsorConfig, refetch]
  );

  const deleteProvider = useCallback(
    async (resource: ProviderResource) => {
      setMutating(true);
      try {
        const sel = resource.selector;
        if (sel.brand === 'gemini') {
          await providersApi.deleteGeminiKeyAtIndex(sel.index);
          const next = (config?.geminiApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('gemini-api-key', next);
        } else if (sel.brand === 'interactions') {
          await providersApi.deleteInteractionsKey(sel.apiKey, sel.baseUrl);
          const next = (config?.interactionsApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('interactions-api-key', next);
        } else if (sel.brand === 'codex') {
          await providersApi.deleteCodexConfigAtIndex(sel.index);
          const next = (config?.codexApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('codex-api-key', next);
        } else if (sel.brand === 'xai') {
          await providersApi.deleteXAIConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.xaiApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('xai-api-key', next);
        } else if (sel.brand === 'claude') {
          await providersApi.deleteClaudeConfigAtIndex(sel.index);
          const next = (config?.claudeApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('claude-api-key', next);
        } else if (sel.brand === 'claudeApi') {
          await providersApi.deleteClaudeConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.claudeApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('claude-api-key', next);
        } else if (sel.brand === 'vertex') {
          await providersApi.deleteVertexConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.vertexApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('vertex-api-key', next);
        } else if (sel.brand === 'openaiCompatibility') {
          await providersApi.deleteOpenAIProvider(sel.index);
          const next = (config?.openaiCompatibility ?? []).filter(
            (item, index) => (item.sourceIndex ?? index) !== sel.index
          );
          updateConfigValue('openai-compatibility', next);
        } else if (sel.brand === 'image' || sel.brand === 'video' || sel.brand === 'audio') {
          await providersApi.deleteMediaProvider(sel.index);
          const next = (config?.mediaProviders ?? []).filter((_item, index) => index !== sel.index);
          updateConfigValue('media-providers', next);
        } else if (
          sel.brand === 'apikeyFun' ||
          sel.brand === 'code0' ||
          sel.brand === 'fennoAI' ||
          sel.brand === 'qiniuCloud' ||
          sel.brand === 'kimi'
        ) {
          await runSponsorMutationWithRecovery(async () => {
            const raw = resource.raw as SponsorProviderRaw;
            for (const item of raw.gemini) {
              await providersApi.deleteGeminiKey(item.config.apiKey, item.config.baseUrl);
            }
            for (const item of raw.codex) {
              await providersApi.deleteCodexConfig(item.config.apiKey, item.config.baseUrl);
            }
            for (const item of raw.claude) {
              await providersApi.deleteClaudeConfig(item.config.apiKey, item.config.baseUrl);
            }
            const openAIIndices = raw.openai
              .map((item) => item.index)
              .sort((left, right) => right - left);
            for (const index of openAIIndices) {
              await providersApi.deleteOpenAIProvider(index);
            }
          }, refetch);
        }
        await refetch();
      } finally {
        setMutating(false);
      }
    },
    [config, refetch, updateConfigValue]
  );

  const toggleDisabled = useCallback(
    async (resource: ProviderResource, disabled: boolean) => {
      setMutating(true);
      try {
        const brand = resource.brand;
        const selector = resource.selector;
        if (brand === 'gemini' && selector.brand === 'gemini') {
          const current = resource.raw as GeminiKeyConfig;
          const excluded = disabled
            ? withDisableAllModelsRule(current.excludedModels)
            : withoutDisableAllModelsRule(current.excludedModels);
          await providersApi.updateGeminiKeyAtIndex(selector.index, {
            ...current,
            excludedModels: excluded,
          });
        } else if (brand === 'interactions' && selector.brand === 'interactions') {
          const current = resource.raw as GeminiKeyConfig;
          const excluded = disabled
            ? withDisableAllModelsRule(current.excludedModels)
            : withoutDisableAllModelsRule(current.excludedModels);
          await providersApi.updateInteractionsKey(selector.apiKey, selector.baseUrl, {
            ...current,
            excludedModels: excluded,
          });
        } else if (
          (brand === 'codex' && selector.brand === 'codex') ||
          (brand === 'xai' && selector.brand === 'xai') ||
          (brand === 'claude' && selector.brand === 'claude') ||
          (brand === 'claudeApi' && selector.brand === 'claudeApi') ||
          (brand === 'vertex' && selector.brand === 'vertex')
        ) {
          const current = resource.raw as ProviderKeyConfig;
          const excluded = disabled
            ? withDisableAllModelsRule(current.excludedModels)
            : withoutDisableAllModelsRule(current.excludedModels);
          const next = { ...current, excludedModels: excluded };
          if (selector.brand === 'codex') {
            await providersApi.updateCodexConfigAtIndex(selector.index, next);
          } else if (selector.brand === 'xai') {
            await providersApi.updateXAIConfig(selector.apiKey, selector.baseUrl, next);
          } else if (selector.brand === 'claude' || selector.brand === 'claudeApi') {
            await providersApi.updateClaudeConfigAtIndex(selector.index, next);
          } else if (selector.brand === 'vertex') {
            await providersApi.updateVertexConfig(selector.apiKey, selector.baseUrl, next);
          }
        } else if (brand === 'openaiCompatibility' && selector.brand === 'openaiCompatibility') {
          await providersApi.updateOpenAIProviderDisabled(selector.index, disabled);
        } else if (brand === 'image' || brand === 'video' || brand === 'audio') {
          if (selector.brand !== brand) throw new Error('Media provider selector mismatch');
          await providersApi.updateMediaProvider(
            selector.index,
            buildMediaProviderConfig(
              brand,
              {
                ...buildMediaProviderFormInput(brand, resource.raw as MediaProviderConfig),
                disabled,
              },
              resource.raw as MediaProviderConfig
            )
          );
        } else if (
          brand === 'apikeyFun' ||
          brand === 'code0' ||
          brand === 'fennoAI' ||
          brand === 'qiniuCloud' ||
          brand === 'kimi'
        ) {
          await runSponsorMutationWithRecovery(
            () => toggleSponsorConfig(resource.raw as SponsorProviderRaw, disabled),
            refetch
          );
        }
        await refetch();
      } finally {
        setMutating(false);
      }
    },
    [refetch]
  );

  return {
    connected,
    isPending,
    isFetching,
    isError: Boolean(errorMessage),
    errorMessage,
    snapshot,
    refetch,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleDisabled,
    mutating,
    refreshSnapshot,
  };
}
