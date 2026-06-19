import type { OpenAIProviderConfig } from '@/types';
import {
  buildRecentRequestCompositeKey,
  mergeRecentRequestBucketGroups,
  statusBarDataFromRecentRequests,
  sumRecentRequests,
  type ApiKeyUsageFailureDetail,
  type ApiKeyUsageSuccessDetail,
  type RecentRequestBucket,
  type RecentRequestUsageEntry,
  type StatusBarData,
} from '@/utils/recentRequests';

const DISABLE_ALL_MODELS_RULE = '*';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

export const hasDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models) &&
  models.some((model) => String(model ?? '').trim() === DISABLE_ALL_MODELS_RULE);

export const stripDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models)
    ? models.filter((model) => String(model ?? '').trim() !== DISABLE_ALL_MODELS_RULE)
    : [];

export const withDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return [...base, DISABLE_ALL_MODELS_RULE];
};

export const withoutDisableAllModelsRule = (models?: string[]) =>
  stripDisableAllModelsRule(models);

const normalizeUpstreamBaseUrl = (baseUrl: string, fallback = ''): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) return fallback;
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

const buildGeminiModelResource = (model: string): string => {
  const trimmed = String(model || '')
    .trim()
    .replace(/^\/+/g, '')
    .replace(/:generateContent$/i, '');
  if (!trimmed) return '';

  if (/^(models|tunedModels)\//i.test(trimmed)) {
    return trimmed.split('/').map(encodeURIComponent).join('/');
  }

  return `models/${encodeURIComponent(trimmed)}`;
};

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeUpstreamBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
};

export const buildCodexResponsesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeUpstreamBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (/\/v1\/responses$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/v1\/models$/i.test(trimmed)) {
    return trimmed.replace(/\/models$/i, '/responses');
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/responses`;
  }
  return `${trimmed}/v1/responses`;
};

export const buildClaudeMessagesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeUpstreamBaseUrl(baseUrl, 'https://api.anthropic.com');
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
};

export const buildGeminiGenerateContentEndpoint = (
  baseUrl: string,
  model: string
): string => {
  const resource = buildGeminiModelResource(model);
  if (!resource) return '';

  const trimmed = normalizeUpstreamBaseUrl(baseUrl, DEFAULT_GEMINI_BASE_URL);
  if (!trimmed) return '';
  if (/:generateContent$/i.test(trimmed)) {
    return trimmed;
  }

  let root = trimmed.replace(/\/+$/g, '');
  if (/\/v1beta\/models$/i.test(root)) {
    root = root.replace(/\/models$/i, '');
  } else if (!/\/v1beta$/i.test(root)) {
    root = root.replace(/\/v1beta(?:\/.*)?$/i, '');
    root = `${root}/v1beta`;
  }

  return `${root}/${resource}:generateContent`;
};

export type ProviderRecentUsageMap = Map<string, Map<string, RecentRequestUsageEntry>>;

const EMPTY_RECENT_USAGE_ENTRY: RecentRequestUsageEntry = {
  success: 0,
  failed: 0,
  recentRequests: [],
  successDetails: [],
  failureDetails: []
};

const normalizeProviderRecentKey = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

const normalizeUsageBaseUrl = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\/+$/g, '')
    .toLowerCase();

const splitRecentCompositeKey = (compositeKey: string): { baseUrl: string; apiKey: string } => {
  const separatorIndex = compositeKey.lastIndexOf('|');
  if (separatorIndex < 0) {
    return { baseUrl: '', apiKey: compositeKey.trim() };
  }
  return {
    baseUrl: compositeKey.slice(0, separatorIndex),
    apiKey: compositeKey.slice(separatorIndex + 1),
  };
};

const hasRecentUsage = (entry: RecentRequestUsageEntry): boolean =>
  entry.success > 0 ||
  entry.failed > 0 ||
  entry.recentRequests.some((bucket) => bucket.success > 0 || bucket.failed > 0) ||
  entry.successDetails.length > 0 ||
  entry.failureDetails.length > 0;

const findCompatibleRecentUsageEntry = (
  providerBucket: Map<string, RecentRequestUsageEntry>,
  apiKey?: string,
  baseUrl?: string
): RecentRequestUsageEntry => {
  const normalizedApiKey = String(apiKey ?? '').trim();
  const normalizedBaseUrl = normalizeUsageBaseUrl(baseUrl);
  const candidates: RecentRequestUsageEntry[] = [];

  providerBucket.forEach((entry, compositeKey) => {
    if (!hasRecentUsage(entry)) return;
    const parsed = splitRecentCompositeKey(compositeKey);
    if (normalizedApiKey && parsed.apiKey.trim() !== normalizedApiKey) return;
    if (normalizeUsageBaseUrl(parsed.baseUrl) !== normalizedBaseUrl) return;
    candidates.push(entry);
  });

  return candidates.length === 1 ? candidates[0] : EMPTY_RECENT_USAGE_ENTRY;
};

const getProviderRecentUsageEntry = (
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestUsageEntry => {
  const providerKey = normalizeProviderRecentKey(provider);
  const providerBucket = usageByProvider.get(providerKey);
  if (!providerBucket) {
    return EMPTY_RECENT_USAGE_ENTRY;
  }

  const normalizedApiKey = String(apiKey ?? '').trim();
  if (normalizedApiKey) {
    const compositeKey = buildRecentRequestCompositeKey(baseUrl, normalizedApiKey);
    const exactEntry = providerBucket.get(compositeKey);
    if (exactEntry) {
      return exactEntry;
    }
  }

  return findCompatibleRecentUsageEntry(providerBucket, normalizedApiKey, baseUrl);
};

const getProviderRecentBuckets = (
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestBucket[] =>
  getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl).recentRequests;

export function getProviderRecentStatusData(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): StatusBarData {
  return statusBarDataFromRecentRequests(
    getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl)
  );
}

export function getProviderTotalStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  const entry = getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl);
  return { success: entry.success, failure: entry.failed };
}

const mergeSuccessDetails = (groups: ApiKeyUsageSuccessDetail[][]): ApiKeyUsageSuccessDetail[] => {
  const merged = new Map<string, ApiKeyUsageSuccessDetail>();
  groups.flat().forEach((item) => {
    const key = `${item.model}|${item.status}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, count: current.count + item.count } : { ...item });
  });
  return Array.from(merged.values()).sort((a, b) => b.count - a.count).slice(0, 10);
};

const mergeFailureDetails = (groups: ApiKeyUsageFailureDetail[][]): ApiKeyUsageFailureDetail[] => {
  const merged = new Map<string, ApiKeyUsageFailureDetail>();
  groups.flat().forEach((item) => {
    const key = `${item.model}|${item.status}|${item.error}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, count: current.count + item.count } : { ...item });
  });
  return Array.from(merged.values()).sort((a, b) => b.count - a.count).slice(0, 10);
};

export function getProviderUsageDetails(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { successDetails: ApiKeyUsageSuccessDetail[]; failureDetails: ApiKeyUsageFailureDetail[] } {
  const entry = getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl);
  return { successDetails: entry.successDetails, failureDetails: entry.failureDetails };
}

export function getProviderRecentWindowStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  return sumRecentRequests(getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl));
}

const collectOpenAIProviderRecentBuckets = (
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): RecentRequestBucket[] => {
  if (!provider.apiKeyEntries?.length) {
    return [];
  }

  const groups = provider.apiKeyEntries.map((entry) =>
    getProviderRecentBuckets(usageByProvider, provider.name, entry.apiKey, provider.baseUrl)
  );

  return mergeRecentRequestBucketGroups(groups);
};

export function getOpenAIProviderRecentWindowStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return sumRecentRequests(collectOpenAIProviderRecentBuckets(provider, usageByProvider));
}

export function getOpenAIProviderTotalStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return (provider.apiKeyEntries || []).reduce(
    (total, entry) => {
      const usageEntry = getProviderRecentUsageEntry(
        usageByProvider,
        provider.name,
        entry.apiKey,
        provider.baseUrl
      );
      return {
        success: total.success + usageEntry.success,
        failure: total.failure + usageEntry.failed,
      };
    },
    { success: 0, failure: 0 }
  );
}

export function getOpenAIProviderUsageDetails(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { successDetails: ApiKeyUsageSuccessDetail[]; failureDetails: ApiKeyUsageFailureDetail[] } {
  const usageEntries = (provider.apiKeyEntries || []).map((entry) =>
    getProviderRecentUsageEntry(usageByProvider, provider.name, entry.apiKey, provider.baseUrl)
  );
  return {
    successDetails: mergeSuccessDetails(usageEntries.map((entry) => entry.successDetails)),
    failureDetails: mergeFailureDetails(usageEntries.map((entry) => entry.failureDetails))
  };
}

export function getOpenAIProviderRecentStatusData(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData {
  return statusBarDataFromRecentRequests(
    collectOpenAIProviderRecentBuckets(provider, usageByProvider)
  );
}
