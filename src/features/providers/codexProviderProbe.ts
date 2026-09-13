import {
  apiCallApi,
  getApiCallErrorMessage,
  providerConnectivityApi,
  type ApiCallRequest,
  type ApiCallResult,
} from '@/services/api';
import { buildCodexResponsesEndpoint } from '@/components/providers/utils';
import type { ProviderKeyConfig } from '@/types';
import { isRecord } from '@/utils/helpers';
import { serializeCodexProviderDraft } from '@/services/api/nativeProviderContracts';
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
  // Only the legacy xAI raw transport opts out of the Codex completion contract.
  requireCompleted?: boolean;
  timeoutMs?: number;
  model?: string;
  entryIndices?: number[];
  testAll?: boolean;
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

const codexResponseFailed = (
  body: Record<string, unknown>,
  requireCompleted: boolean
): boolean =>
  body.error != null ||
  ((requireCompleted || typeof body.status === 'string') && body.status !== 'completed');

const codexProbeErrorBody = (body: Record<string, unknown> | undefined, fallback: string) => {
  const error = body?.error;
  const details = body?.incomplete_details;
  const message = [
    isRecord(error) ? error.message : error,
    body?.message,
    isRecord(details) ? details.reason : undefined,
    isRecord(error) ? error.code : undefined,
  ].find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  return { error: { message: message || fallback } };
};

const isCodexFailureEvent = (type: unknown): boolean =>
  type === 'error' ||
  type === 'response.failed' ||
  type === 'response.incomplete' ||
  type === 'response.cancelled';

const codexProbeEventBody = (
  event: Record<string, unknown>,
  fallback: string,
  eventName = '',
  requireCompleted = true
): Record<string, unknown> | undefined => {
  const type = typeof event.type === 'string' ? event.type : eventName;
  const response = isRecord(event.response) ? event.response : undefined;
  if (isCodexFailureEvent(type) || isCodexFailureEvent(eventName) || event.error != null) {
    return codexProbeErrorBody(response || event, fallback);
  }
  if (type === 'response.completed') {
    return response && !codexResponseFailed(response, requireCompleted)
      ? response
      : codexProbeErrorBody(response, fallback);
  }
  return undefined;
};

const codexProbeBody = (body: unknown, fallback: string, requireCompleted = true): unknown => {
  if (typeof body !== 'string') {
    if (!isRecord(body)) return body;
    const eventBody = codexProbeEventBody(body, fallback, '', requireCompleted);
    if (eventBody) return eventBody;
    const isResponseEvent = typeof body.type === 'string' && body.type.startsWith('response.');
    return isResponseEvent || codexResponseFailed(body, requireCompleted)
      ? codexProbeErrorBody(body, fallback)
      : body;
  }

  let sawStream = false;
  let completed: Record<string, unknown> | undefined;
  const streamBody = body.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (const frame of streamBody.split('\n\n')) {
    const data: string[] = [];
    let eventName = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('data:')) {
        sawStream = true;
        data.push(line.slice(5).replace(/^ /, ''));
      } else if (line.startsWith('event:')) {
        sawStream = true;
        eventName = line.slice(6).trim();
      }
    }
    if (!data.length) continue;
    const payload = data.join('\n');
    if (!payload.trim() || payload.trim() === '[DONE]') continue;

    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return codexProbeErrorBody(undefined, fallback);
    }
    if (!isRecord(event)) return codexProbeErrorBody(undefined, fallback);
    const eventBody = codexProbeEventBody(event, fallback, eventName, requireCompleted);
    if (eventBody?.error != null) return eventBody;
    if (eventBody) completed = eventBody;
  }

  // HTTP success and partial output alone do not establish stream completion.
  return sawStream ? completed || codexProbeErrorBody(undefined, fallback) : body;
};

const pickModel = (config: CodexProbeProviderConfig): string => {
  for (const model of config.models ?? []) {
    const name = (model.name ?? '').trim();
    if (name) return name;
  }
  return '';
};

const publicProbeModel = (config: CodexProbeProviderConfig, model: string): string => {
  const mapping = config.models?.find((candidate) => candidate.name.trim() === model);
  const routed = mapping?.alias?.trim() || model;
  const prefix = config.prefix?.trim();
  return prefix && !routed.startsWith(`${prefix}/`) ? `${prefix}/${routed}` : routed;
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
    : options.testAll
      ? allEntries
      : allEntries.slice(0, 1);

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

  const codexConfig = serializeCodexProviderDraft(config);

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
              model: publicProbeModel(config, model),
              codexConfig,
              ...(requestKey ? { apiKey: requestKey } : {}),
              baseUrl,
              proxyUrl: entry.proxyUrl || config.proxyUrl,
              headers: customHeaders,
              disableImageGeneration: config.disableImageGeneration === true,
            },
            { timeout: 0 }
          );
      const responseBody = codexProbeBody(
        result.body,
        messages.requestFailed,
        !options.request || options.requireCompleted !== false
      );
      if (
        result.statusCode < 200 ||
        result.statusCode >= 300 ||
        !isRecord(responseBody) ||
        responseBody.error != null
      ) {
        return {
          index: entry.index,
          state: 'error',
          message: getApiCallErrorMessage({ ...result, body: responseBody }),
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
