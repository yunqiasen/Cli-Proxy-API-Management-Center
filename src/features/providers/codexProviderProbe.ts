import {
  apiCallApi,
  getApiCallErrorMessage,
  providerConnectivityApi,
  type ApiCallRequest,
  type ApiCallResult,
} from '@/services/api';
import { buildCodexResponsesEndpoint } from '@/components/providers/utils';
import type { ProviderKeyConfig } from '@/types';
import { createCodexConnectivityRequest } from './sheets/forms/codexConnectivityRequest';

export type CodexProbeState = 'idle' | 'loading' | 'success' | 'error';

export interface CodexProbeMessages {
  baseUrlRequired: string;
  endpointInvalid: string;
  apiKeyRequired: string;
  modelRequired: string;
  requestFailed: string;
  timeout?: (seconds: number) => string;
}

export interface CodexProbeEntryResult {
  index: number;
  state: Exclude<CodexProbeState, 'idle' | 'loading'>;
  message: string;
  statusCode?: number;
  durationMs: number;
}

export interface CodexProbeStatus {
  state: CodexProbeState;
  total: number;
  successCount: number;
  failureCount: number;
  message: string;
}

export interface CodexProbeResult extends CodexProbeStatus {
  state: Exclude<CodexProbeState, 'idle' | 'loading'>;
  entries: CodexProbeEntryResult[];
}

export interface CodexProbeOptions {
  timeoutMs?: number;
  model?: string;
  entryIndices?: number[];
  request?: (payload: ApiCallRequest, config?: { timeout?: number }) => Promise<ApiCallResult>;
}

type CodexProbeKeyEntry = NonNullable<ProviderKeyConfig['apiKeyEntries']>[number] & {
  explicitApiKey?: string;
};

export type CodexProbeProviderConfig = Omit<ProviderKeyConfig, 'apiKeyEntries'> & {
  apiKeyEntries?: CodexProbeKeyEntry[];
  explicitApiKey?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export const getCodexProbeEntryIndices = (
  entryIndex?: number,
  testAll = false
): number[] | undefined => (testAll ? undefined : [entryIndex ?? 0]);

const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
};

const pickModel = (config: CodexProbeProviderConfig): string => {
  for (const model of config.models ?? []) {
    const name = (model.name ?? '').trim();
    if (name) return name;
  }
  return '';
};

const getEntries = (config: CodexProbeProviderConfig) => {
  if (config.apiKeyEntries?.length) {
    const useLegacyAuthIndex = config.apiKeyEntries.length === 1;
    return config.apiKeyEntries.map((entry, index) => ({
      index,
      apiKey: entry.apiKey?.trim() ?? '',
      explicitApiKey:
        typeof entry.explicitApiKey === 'string' ? entry.explicitApiKey.trim() : undefined,
      proxyUrl: entry.proxyUrl?.trim() ?? '',
      authIndex:
        entry.authIndex?.trim() || (useLegacyAuthIndex ? config.authIndex?.trim() : '') || '',
    }));
  }

  const apiKey = config.apiKey?.trim() ?? '';
  const authIndex = config.authIndex?.trim() ?? '';
  const hasStandaloneAuthorization = Object.entries(config.headers ?? {}).some(
    ([name, value]) =>
      name.toLowerCase() === 'authorization' && value.trim() !== '' && !value.includes('$TOKEN$')
  );
  if (!apiKey && !authIndex && !hasStandaloneAuthorization) return [];

  return [
    {
      index: 0,
      apiKey,
      explicitApiKey:
        typeof config.explicitApiKey === 'string' ? config.explicitApiKey.trim() : undefined,
      proxyUrl: config.proxyUrl?.trim() ?? '',
      authIndex,
    },
  ];
};

const summarizeMessage = (entries: CodexProbeEntryResult[], fallback: string): string => {
  const failures = entries.filter((entry) => entry.state === 'error');
  if (!failures.length) return '';
  const first = failures[0]?.message || fallback;
  return failures.length > 1 ? `${first} (+${failures.length - 1})` : first;
};

export function pickCodexProbeModel(config: CodexProbeProviderConfig): string {
  return pickModel(config);
}

export async function simulateCodexProvider(
  config: CodexProbeProviderConfig,
  messages: CodexProbeMessages,
  options: CodexProbeOptions = {}
): Promise<CodexProbeResult> {
  const startedAt = Date.now();
  const timeoutCandidate = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs =
    Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
      ? timeoutCandidate
      : DEFAULT_TIMEOUT_MS;
  const request = options.request ?? apiCallApi.request;
  const baseUrl = (config.baseUrl ?? '').trim();
  const endpoint = buildCodexResponsesEndpoint(baseUrl);
  const model = options.model?.trim() || pickModel(config);
  const allEntries = getEntries(config);
  const selectedIndices = options.entryIndices ? new Set(options.entryIndices) : undefined;
  const entries = selectedIndices
    ? allEntries.filter((entry) => selectedIndices.has(entry.index))
    : allEntries;

  let validEndpoint = false;
  try {
    const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl);
    const hasSupportedScheme = /^https?:\/\//i.test(baseUrl);
    if (hasExplicitScheme && !hasSupportedScheme) throw new Error('unsupported scheme');
    const normalizedBase = hasSupportedScheme ? baseUrl : `http://${baseUrl}`;
    const parsedBase = new URL(normalizedBase);
    const parsedEndpoint = new URL(endpoint);
    validEndpoint =
      (parsedBase.protocol === 'http:' || parsedBase.protocol === 'https:') &&
      Boolean(parsedBase.hostname) &&
      !parsedBase.search &&
      !parsedBase.hash &&
      (parsedEndpoint.protocol === 'http:' || parsedEndpoint.protocol === 'https:') &&
      Boolean(parsedEndpoint.hostname);
  } catch {
    validEndpoint = false;
  }
  const validationMessage = !baseUrl
    ? messages.baseUrlRequired
    : !endpoint || !validEndpoint
      ? messages.endpointInvalid
      : !model
        ? messages.modelRequired
        : '';
  if (validationMessage) {
    const invalidEntries = entries.map((entry) => ({
      index: entry.index,
      state: 'error' as const,
      message: validationMessage,
      durationMs: Date.now() - startedAt,
    }));
    return {
      state: 'error',
      total: invalidEntries.length,
      successCount: 0,
      failureCount: invalidEntries.length,
      entries: invalidEntries,
      message: validationMessage,
    };
  }

  if (!entries.length) {
    return {
      state: 'error',
      total: 0,
      successCount: 0,
      failureCount: 0,
      entries: [],
      message: messages.apiKeyRequired,
    };
  }

  const runEntry = async (entry: (typeof entries)[number]): Promise<CodexProbeEntryResult> => {
    const entryStartedAt = Date.now();
    const customHeaders = { ...(config.headers ?? {}) };
    let hasAuthorization = false;
    Object.entries(customHeaders).forEach(([name, value]) => {
      if (name.toLowerCase() !== 'authorization') return;
      const normalizedValue = value.trim();
      if (normalizedValue && (!normalizedValue.includes('$TOKEN$') || entry.authIndex)) {
        hasAuthorization = true;
      } else {
        delete customHeaders[name];
      }
    });
    const resolvedKey =
      entry.apiKey || (allEntries.length === 1 ? (config.apiKey?.trim() ?? '') : '');
    const requestKey =
      entry.explicitApiKey !== undefined
        ? entry.explicitApiKey || (entry.authIndex ? '' : resolvedKey)
        : entry.authIndex
          ? ''
          : resolvedKey;
    if (!requestKey && !hasAuthorization && !entry.authIndex) {
      return {
        index: entry.index,
        state: 'error',
        message: messages.apiKeyRequired,
        durationMs: Date.now() - entryStartedAt,
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    if (!hasAuthorization) {
      headers.Authorization = requestKey ? `Bearer ${requestKey}` : 'Bearer $TOKEN$';
    }
    const probe = createCodexConnectivityRequest(model, headers);
    try {
      const result = options.request
        ? await request(
            {
              authIndex: entry.authIndex || undefined,
              method: 'POST',
              url: endpoint,
              header: probe.headers,
              data: JSON.stringify(probe.body),
            },
            { timeout: timeoutMs }
          )
        : await providerConnectivityApi.requestCodex(
            {
              authIndex: entry.authIndex || undefined,
              model,
              ...(requestKey ? { apiKey: requestKey } : {}),
              baseUrl,
              proxyUrl: entry.proxyUrl || config.proxyUrl,
              headers: customHeaders,
              disableImageGeneration: config.disableImageGeneration === true,
            },
            { timeout: timeoutMs }
          );
      if (
        result.statusCode < 200 ||
        result.statusCode >= 300 ||
        typeof result.body !== 'object' ||
        result.body === null
      ) {
        return {
          index: entry.index,
          state: 'error',
          message: getApiCallErrorMessage(result),
          statusCode: result.statusCode,
          durationMs: Date.now() - entryStartedAt,
        };
      }
      return {
        index: entry.index,
        state: 'success',
        message: '',
        statusCode: result.statusCode,
        durationMs: Date.now() - entryStartedAt,
      };
    } catch (error) {
      const rawMessage = errorMessage(error, messages.requestFailed);
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: string }).code ?? '')
          : '';
      const isTimeout =
        errorCode === 'ECONNABORTED' || rawMessage.toLowerCase().includes('timeout');
      return {
        index: entry.index,
        state: 'error',
        message: isTimeout && messages.timeout ? messages.timeout(timeoutMs / 1000) : rawMessage,
        durationMs: Date.now() - entryStartedAt,
      };
    }
  };

  const results: CodexProbeEntryResult[] = new Array(entries.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= entries.length) return;
      results[current] = await runEntry(entries[current]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => worker()));
  results.sort((a, b) => a.index - b.index);
  const successCount = results.filter((entry) => entry.state === 'success').length;
  const failureCount = results.length - successCount;
  return {
    state: failureCount ? 'error' : 'success',
    total: results.length,
    successCount,
    failureCount,
    entries: results,
    message: summarizeMessage(results, messages.requestFailed),
  };
}
