import type {
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
  MediaProviderConfig,
} from '@/types';
import { hasDisableAllModelsRule, stripDisableAllModelsRule } from '@/components/providers/utils';
import { maskApiKey } from '@/utils/format';
import {
  APIKEY_FUN_DISPLAY_NAME,
  APIKEY_FUN_PROTOCOLS,
  getApiKeyFunProtocolUrls,
  resolveApiKeyFunBaseUrl,
} from './sponsor';
import { CLAUDE_API_DISPLAY_NAME } from './claudeApi';
import {
  CODE0_DISPLAY_NAME,
  CODE0_PROTOCOL_LABELS,
  getCode0ProtocolUrls,
  resolveCode0BaseUrl,
} from './code0';
import {
  FENNO_AI_DISPLAY_NAME,
  FENNO_AI_PROTOCOL_LABELS,
  getFennoAIProtocolUrls,
  resolveFennoAIBaseUrl,
} from './fennoAI';
import {
  QINIU_CLOUD_DISPLAY_NAME,
  QINIU_CLOUD_PROTOCOL_LABELS,
  getQiniuCloudProtocolUrls,
  resolveQiniuCloudBaseUrl,
} from './qiniuCloud';
import {
  LMU_AI_DISPLAY_NAME,
  LMU_AI_PROTOCOL_LABELS,
  getLmuAIProtocolUrls,
  resolveLmuAIBaseUrl,
} from './lmuAI';
import {
  INFISTAR_DISPLAY_NAME,
  INFISTAR_PROTOCOL_LABELS,
  getInfistarProtocolUrls,
  resolveInfistarBaseUrl,
} from './infistar';
import {
  KIMI_DISPLAY_NAME,
  KIMI_PROTOCOL_LABELS,
  getKimiProtocolUrls,
  resolveKimiBaseUrl,
} from './kimi';
import { buildNativeProviderResourceData } from './nativeProviderResource';
import type {
  ProviderBrand,
  ProviderResource,
  ProviderResourceSelector,
  SponsorProviderBrand,
  SponsorProviderRaw,
} from './types';

const countHeaders = (headers?: Record<string, string>): number =>
  headers ? Object.keys(headers).length : 0;

const collectModelSearchTerms = (models?: Array<{ name?: string; alias?: string }>): string[] => {
  const seen = new Set<string>();
  (models ?? []).forEach((model) => {
    const name = (model?.name ?? '').trim();
    const alias = (model?.alias ?? '').trim();
    if (alias) seen.add(alias);
    if (name) seen.add(name);
  });
  return Array.from(seen);
};

const collectModelDisplayNames = (models?: Array<{ name?: string; alias?: string }>): string[] => {
  const seen = new Set<string>();
  (models ?? []).forEach((model) => {
    const alias = (model?.alias ?? '').trim();
    const name = (model?.name ?? '').trim();
    const display = alias || name;
    if (display) seen.add(display);
  });
  return Array.from(seen);
};

const normalizePriority = (priority?: number): number =>
  typeof priority === 'number' && Number.isFinite(priority) ? priority : 0;

const buildId = (brand: ProviderBrand, index: number, fragment: string) =>
  `${brand}:${index}:${fragment || 'item'}`;

const truncateForId = (value: string | undefined | null): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 12) return trimmed;
  return trimmed.slice(0, 8);
};

function providerKeyToResource(
  brand: 'gemini' | 'interactions' | 'codex' | 'xai' | 'claude' | 'claudeApi' | 'vertex',
  config: GeminiKeyConfig | ProviderKeyConfig,
  index: number
): ProviderResource {
  const native = buildNativeProviderResourceData(config, index, maskApiKey);
  const apiKey = native.apiKeys[0] ?? '';
  const disabled = hasDisableAllModelsRule(config.excludedModels);
  const excludedModels = stripDisableAllModelsRule(config.excludedModels);
  const flags: ProviderResource['flags'] = {};
  if (brand === 'codex' || brand === 'xai') {
    flags.websockets = (config as ProviderKeyConfig).websockets === true;
  }
  if (brand === 'claude' || brand === 'claudeApi') {
    const cloak = (config as ProviderKeyConfig).cloak;
    flags.cloakEnabled = Boolean(cloak?.mode?.trim());
  }

  const modelSearchTerms = collectModelSearchTerms(config.models);
  const selector: ProviderResourceSelector = {
    brand,
    index,
    ...(native.selector.name ? { name: native.selector.name } : {}),
    ...(apiKey ? { apiKey } : {}),
    baseUrl: config.baseUrl,
  } as ProviderResourceSelector;

  return {
    id: buildId(brand, index, truncateForId(native.name || apiKey)),
    brand,
    originalIndex: index,
    name: native.name,
    identifier: native.identifier,
    apiKeyPreview: native.keyPreviews[0] ?? null,
    apiKeyPreviews: native.keyPreviews,
    apiKeys: native.apiKeys,
    credentialSearchTerms: native.searchTerms,
    apiKey: apiKey || null,
    authIndex: config.apiKeyEntries?.[0]?.authIndex ?? config.authIndex ?? null,
    baseUrl: config.baseUrl ?? null,
    proxyUrl: config.proxyUrl ?? null,
    prefix: config.prefix ?? null,
    modelCount: config.models?.length ?? 0,
    models:
      brand === 'interactions'
        ? Array.from(
            new Set((config.models ?? []).map((model) => (model.name ?? '').trim()).filter(Boolean))
          )
        : modelSearchTerms,
    modelDisplays: collectModelDisplayNames(config.models),
    modelSearchTerms,
    priority: normalizePriority(config.priority),
    headerCount: countHeaders(config.headers),
    excludedModelCount: excludedModels.length,
    excludedModels,
    apiKeyEntryCount: native.keyCount,
    disabled,
    flags,
    selector,
    raw: config,
  };
}

export function geminiToResource(config: GeminiKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('gemini', config, index);
}

export function interactionsToResource(config: GeminiKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('interactions', config, index);
}

export function codexToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('codex', config, index);
}

export function xaiToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('xai', config, index);
}

export function claudeToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('claude', config, index);
}

export function claudeApiToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  const resource = providerKeyToResource('claudeApi', config, index);
  return {
    ...resource,
    name: CLAUDE_API_DISPLAY_NAME,
  };
}

export function vertexToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('vertex', config, index);
}

export function mediaToResource(
  config: MediaProviderConfig,
  index: number,
  brand: 'image' | 'video' | 'audio' = config.kind
): ProviderResource {
  const entries = config.apiKeyEntries ?? [];
  const apiKeys = entries.map((entry) => entry.apiKey).filter(Boolean);
  const keyPreviews = apiKeys.map(maskApiKey);
  const models = config.models ?? [];
  const modelSearchTerms = collectModelSearchTerms(models);
  const modelDisplays = models
    .map((model) => model.alias?.trim() || model.displayName?.trim() || model.name.trim())
    .filter(Boolean)
    .filter((value, idx, list) => list.indexOf(value) === idx);
  const capabilities = Array.from(
    new Set(
      models
        .flatMap((model) => model.capabilities ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  const priority = normalizePriority(config.priority);
  return {
    id: buildId(brand, index, config.name),
    brand,
    originalIndex: config.sourceIndex ?? index,
    name: config.name.trim() || null,
    identifier: config.name.trim() || `#${index + 1}`,
    apiKeyPreview: keyPreviews[0] ?? null,
    apiKeyPreviews: keyPreviews,
    apiKeys,
    credentialSearchTerms: [...apiKeys, ...keyPreviews],
    apiKey: apiKeys[0] ?? null,
    authIndex: entries[0]?.authIndex ?? config.authIndex ?? null,
    baseUrl: config.baseUrl ?? null,
    proxyUrl: entries[0]?.proxyUrl ?? null,
    prefix: config.prefix ?? null,
    modelCount: models.length,
    models: modelSearchTerms,
    modelDisplays,
    modelSearchTerms,
    priority,
    headerCount: countHeaders(config.headers),
    excludedModelCount: 0,
    excludedModels: [],
    apiKeyEntryCount: entries.length,
    disabled: config.disabled === true,
    flags: {},
    mediaKind: config.kind,
    mediaCapabilities: capabilities,
    operationCount: config.operations?.length ?? 0,
    selector: { brand, name: config.name, kind: config.kind, index: config.sourceIndex ?? index },
    raw: config,
  };
}

export function openaiToResource(config: OpenAIProviderConfig, index: number): ProviderResource {
  const sourceIndex = config.sourceIndex ?? index;
  const name = (config.name ?? '').trim();
  const firstEntry = config.apiKeyEntries?.[0];
  const previewApiKey = firstEntry?.apiKey ? maskApiKey(firstEntry.apiKey) : null;
  const modelSearchTerms = collectModelSearchTerms(config.models);
  const excludedModels = stripDisableAllModelsRule(
    (config as { excludedModels?: string[] }).excludedModels
  );
  return {
    id: buildId('openaiCompatibility', sourceIndex, truncateForId(name) || `#${sourceIndex}`),
    brand: 'openaiCompatibility',
    originalIndex: sourceIndex,
    name: name || null,
    identifier: name || `#${sourceIndex + 1}`,
    apiKeyPreview: previewApiKey,
    apiKey: null,
    authIndex: config.authIndex ?? null,
    baseUrl: config.baseUrl ?? null,
    proxyUrl: null,
    prefix: config.prefix ?? null,
    modelCount: config.models?.length ?? 0,
    models: modelSearchTerms,
    modelDisplays: collectModelDisplayNames(config.models),
    modelSearchTerms,
    priority: normalizePriority(config.priority),
    headerCount: countHeaders(config.headers),
    excludedModelCount: excludedModels.length,
    excludedModels,
    apiKeyEntryCount: config.apiKeyEntries?.length ?? 0,
    disabled: config.disabled === true,
    flags: {},
    selector: { brand: 'openaiCompatibility', name, index: sourceIndex },
    raw: config,
  };
}

interface SponsorResourceOptions {
  displayName: string;
  protocolLabels: readonly string[];
  resolveBaseUrl: (value: string | undefined | null) => string;
  getProtocolUrls: (value: string | undefined | null) => {
    anthropic: string;
    openai: string;
    codex: string;
    gemini: string;
  };
}

function sponsorRawToResource(
  brand: SponsorProviderBrand,
  raw: SponsorProviderRaw,
  options: SponsorResourceOptions
): ProviderResource | null {
  if (
    raw.openai.length === 0 &&
    raw.claude.length === 0 &&
    raw.codex.length === 0 &&
    raw.gemini.length === 0
  ) {
    return null;
  }
  const openaiKeyCount = raw.openai.reduce(
    (count, item) => count + (item.config.apiKeyEntries?.length ?? 0),
    0
  );
  const codexKeyCount = raw.codex.length;
  const geminiKeyCount = raw.gemini.length;
  const firstOpenAIEntry = raw.openai
    .flatMap((item) => item.config.apiKeyEntries ?? [])
    .find((entry) => entry.apiKey?.trim());
  const firstCodex = raw.codex.find((item) => item.config.apiKey?.trim());
  const firstClaude = raw.claude.find((item) => item.config.apiKey?.trim());
  const firstGemini = raw.gemini.find((item) => item.config.apiKey?.trim());
  const apiKey =
    firstOpenAIEntry?.apiKey ??
    firstCodex?.config.apiKey ??
    firstClaude?.config.apiKey ??
    firstGemini?.config.apiKey ??
    '';
  const openaiDisabled =
    raw.openai.length > 0 && raw.openai.every((item) => item.config.disabled === true);
  const codexDisabled =
    raw.codex.length > 0 &&
    raw.codex.every((item) => hasDisableAllModelsRule(item.config.excludedModels));
  const claudeDisabled =
    raw.claude.length > 0 &&
    raw.claude.every((item) => hasDisableAllModelsRule(item.config.excludedModels));
  const geminiDisabled =
    raw.gemini.length > 0 &&
    raw.gemini.every((item) => hasDisableAllModelsRule(item.config.excludedModels));
  const enabledCount =
    (raw.openai.length > 0 && !openaiDisabled ? 1 : 0) +
    (raw.codex.length > 0 && !codexDisabled ? 1 : 0) +
    (raw.claude.length > 0 && !claudeDisabled ? 1 : 0) +
    (raw.gemini.length > 0 && !geminiDisabled ? 1 : 0);
  const allResourcesConfigured =
    raw.openai.length > 0 || raw.codex.length > 0 || raw.claude.length > 0 || raw.gemini.length > 0;
  const disabled = allResourcesConfigured && enabledCount === 0;
  const modelSearchTerms = [
    ...raw.openai.flatMap((item) => collectModelSearchTerms(item.config.models)),
    ...raw.codex.flatMap((item) => collectModelSearchTerms(item.config.models)),
    ...raw.claude.flatMap((item) => collectModelSearchTerms(item.config.models)),
    ...raw.gemini.flatMap((item) => collectModelSearchTerms(item.config.models)),
  ];
  const modelDisplays = Array.from(
    new Set([
      ...raw.openai.flatMap((item) => collectModelDisplayNames(item.config.models)),
      ...raw.codex.flatMap((item) => collectModelDisplayNames(item.config.models)),
      ...raw.claude.flatMap((item) => collectModelDisplayNames(item.config.models)),
      ...raw.gemini.flatMap((item) => collectModelDisplayNames(item.config.models)),
    ])
  );
  const uniqueModels = Array.from(new Set(modelSearchTerms));
  const excludedModels = Array.from(
    new Set([
      ...raw.codex.flatMap((item) => stripDisableAllModelsRule(item.config.excludedModels)),
      ...raw.claude.flatMap((item) => stripDisableAllModelsRule(item.config.excludedModels)),
      ...raw.gemini.flatMap((item) => stripDisableAllModelsRule(item.config.excludedModels)),
    ])
  );
  const headerCount =
    raw.openai.reduce((count, item) => count + countHeaders(item.config.headers), 0) +
    raw.codex.reduce((count, item) => count + countHeaders(item.config.headers), 0) +
    raw.claude.reduce((count, item) => count + countHeaders(item.config.headers), 0) +
    raw.gemini.reduce((count, item) => count + countHeaders(item.config.headers), 0);
  const priority = Math.max(
    0,
    ...raw.openai.map((item) => normalizePriority(item.config.priority)),
    ...raw.codex.map((item) => normalizePriority(item.config.priority)),
    ...raw.claude.map((item) => normalizePriority(item.config.priority)),
    ...raw.gemini.map((item) => normalizePriority(item.config.priority))
  );
  const baseUrl = options.resolveBaseUrl(
    raw.openai[0]?.config.baseUrl ??
      raw.codex[0]?.config.baseUrl ??
      raw.claude[0]?.config.baseUrl ??
      raw.gemini[0]?.config.baseUrl
  );
  const protocolUrls = options.getProtocolUrls(baseUrl);

  return {
    id: buildId(brand, 0, 'sponsor'),
    brand,
    originalIndex: 0,
    name: options.displayName,
    identifier: options.displayName,
    apiKeyPreview: apiKey ? maskApiKey(apiKey) : null,
    apiKey: apiKey || null,
    authIndex: null,
    baseUrl: [protocolUrls.openai, protocolUrls.anthropic, protocolUrls.gemini]
      .filter(Boolean)
      .join(' / '),
    proxyUrl:
      firstOpenAIEntry?.proxyUrl ??
      raw.codex.find((item) => item.config.proxyUrl)?.config.proxyUrl ??
      raw.claude.find((item) => item.config.proxyUrl)?.config.proxyUrl ??
      raw.gemini.find((item) => item.config.proxyUrl)?.config.proxyUrl ??
      null,
    prefix:
      raw.openai[0]?.config.prefix ??
      raw.codex[0]?.config.prefix ??
      raw.claude[0]?.config.prefix ??
      raw.gemini[0]?.config.prefix ??
      null,
    modelCount: uniqueModels.length,
    models: uniqueModels,
    modelDisplays,
    modelSearchTerms: uniqueModels,
    priority,
    headerCount,
    excludedModelCount: excludedModels.length,
    excludedModels,
    apiKeyEntryCount: openaiKeyCount + codexKeyCount + raw.claude.length + geminiKeyCount,
    disabled,
    flags: {
      protocols: [...options.protocolLabels],
    },
    selector: {
      brand,
      openaiIndices: raw.openai.map((item) => item.index),
      claudeIndices: raw.claude.map((item) => item.index),
      codexIndices: raw.codex.map((item) => item.index),
      geminiIndices: raw.gemini.map((item) => item.index),
    } as ProviderResourceSelector,
    raw,
  };
}

export function apiKeyFunToResource(raw: SponsorProviderRaw): ProviderResource | null {
  return sponsorRawToResource('apikeyFun', raw, {
    displayName: APIKEY_FUN_DISPLAY_NAME,
    protocolLabels: APIKEY_FUN_PROTOCOLS,
    resolveBaseUrl: resolveApiKeyFunBaseUrl,
    getProtocolUrls: getApiKeyFunProtocolUrls,
  });
}

export function code0ToResource(raw: SponsorProviderRaw): ProviderResource | null {
  return sponsorRawToResource('code0', raw, {
    displayName: CODE0_DISPLAY_NAME,
    protocolLabels: CODE0_PROTOCOL_LABELS,
    resolveBaseUrl: resolveCode0BaseUrl,
    getProtocolUrls: getCode0ProtocolUrls,
  });
}

export function fennoAIToResource(raw: SponsorProviderRaw): ProviderResource | null {
  return sponsorRawToResource('fennoAI', raw, {
    displayName: FENNO_AI_DISPLAY_NAME,
    protocolLabels: FENNO_AI_PROTOCOL_LABELS,
    resolveBaseUrl: resolveFennoAIBaseUrl,
    getProtocolUrls: getFennoAIProtocolUrls,
  });
}

export function qiniuCloudToResource(raw: SponsorProviderRaw): ProviderResource | null {
  return sponsorRawToResource('qiniuCloud', raw, {
    displayName: QINIU_CLOUD_DISPLAY_NAME,
    protocolLabels: QINIU_CLOUD_PROTOCOL_LABELS,
    resolveBaseUrl: resolveQiniuCloudBaseUrl,
    getProtocolUrls: getQiniuCloudProtocolUrls,
  });
}

export function lmuAIToResource(raw: SponsorProviderRaw): ProviderResource | null {
  return sponsorRawToResource('lmuAI', raw, {
    displayName: LMU_AI_DISPLAY_NAME,
    protocolLabels: LMU_AI_PROTOCOL_LABELS,
    resolveBaseUrl: resolveLmuAIBaseUrl,
    getProtocolUrls: getLmuAIProtocolUrls,
  });
}

export function infistarToResource(raw: SponsorProviderRaw): ProviderResource | null {
  return sponsorRawToResource('infistar', raw, {
    displayName: INFISTAR_DISPLAY_NAME,
    protocolLabels: INFISTAR_PROTOCOL_LABELS,
    resolveBaseUrl: resolveInfistarBaseUrl,
    getProtocolUrls: getInfistarProtocolUrls,
  });
}

export function kimiToResource(raw: SponsorProviderRaw): ProviderResource | null {
  return sponsorRawToResource('kimi', raw, {
    displayName: KIMI_DISPLAY_NAME,
    protocolLabels: KIMI_PROTOCOL_LABELS,
    resolveBaseUrl: resolveKimiBaseUrl,
    getProtocolUrls: getKimiProtocolUrls,
  });
}
