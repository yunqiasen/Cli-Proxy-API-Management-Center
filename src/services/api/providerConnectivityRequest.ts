import type { ApiCallResult } from './apiCall.ts';

export interface ClaudeConnectivityCredentialEntry {
  apiKey?: string;
  existingApiKey?: string;
  authIndex?: string;
  proxyUrl?: string;
}

export interface ClaudeConnectivityCredentialInput {
  entryIndex?: number;
  apiKeyEntries?: ClaudeConnectivityCredentialEntry[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
  proxyUrl?: string;
}

export interface ResolvedClaudeConnectivityCredential {
  explicitKey: string;
  persistedKey: string;
  resolvedKey: string;
  resolvedAuthIndex?: string;
  resolvedProxyUrl: string;
}

export interface ClaudeConnectivityStatus {
  state: 'idle' | 'loading' | 'success' | 'error';
  message: string;
}

export const resolveClaudeConnectivityCredential = (
  input: ClaudeConnectivityCredentialInput
): ResolvedClaudeConnectivityCredential => {
  const selectedEntry =
    input.entryIndex === undefined ? undefined : input.apiKeyEntries?.[input.entryIndex];
  const explicitKey = (selectedEntry ? selectedEntry.apiKey : input.apiKey)?.trim() ?? '';
  const persistedKey =
    (selectedEntry ? selectedEntry.existingApiKey : input.fallbackApiKey)?.trim() ?? '';
  const resolvedAuthIndex =
    (selectedEntry ? selectedEntry.authIndex : input.authIndex)?.trim() || undefined;
  const entryProxy = selectedEntry?.proxyUrl?.trim() ?? '';

  return {
    explicitKey,
    persistedKey,
    resolvedKey: explicitKey || persistedKey,
    resolvedAuthIndex,
    resolvedProxyUrl: entryProxy || input.proxyUrl?.trim() || '',
  };
};

export const aggregateClaudeConnectivityStatuses = (
  statuses: ClaudeConnectivityStatus[]
): ClaudeConnectivityStatus => {
  const failure = statuses.find((status) => status.state === 'error');
  if (failure) return failure;
  if (statuses.length > 0 && statuses.every((status) => status.state === 'success')) {
    return { state: 'success', message: '' };
  }
  return { state: 'idle', message: '' };
};

export interface ClaudeProviderConnectivityInput {
  authIndex?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  proxyUrl?: string;
  headers?: Record<string, string>;
  cloak?: {
    mode?: string;
    strictMode?: boolean;
    sensitiveWords?: string[];
    cacheUserId?: boolean;
  };
  rebuildMidSystemMessage?: boolean;
}

export interface ProviderConnectivityPayload {
  provider: 'claude';
  auth_index?: string;
  model: string;
  api_key?: string;
  base_url?: string;
  proxy_url?: string;
  header?: Record<string, string>;
  cloak?: {
    mode?: string;
    strict_mode?: boolean;
    sensitive_words?: string[];
    cache_user_id?: boolean;
  };
  rebuild_mid_system_message?: boolean;
}

export const buildClaudeProviderConnectivityPayload = (
  input: ClaudeProviderConnectivityInput
): ProviderConnectivityPayload => ({
  provider: 'claude',
  ...(input.authIndex?.trim() ? { auth_index: input.authIndex.trim() } : {}),
  model: input.model.trim(),
  ...(input.apiKey !== undefined ? { api_key: input.apiKey.trim() } : {}),
  ...(input.baseUrl !== undefined ? { base_url: input.baseUrl.trim() } : {}),
  ...(input.proxyUrl !== undefined ? { proxy_url: input.proxyUrl.trim() } : {}),
  ...(input.headers !== undefined ? { header: input.headers } : {}),
  ...(input.cloak
    ? {
        cloak: {
          mode: input.cloak.mode?.trim(),
          strict_mode: input.cloak.strictMode === true,
          sensitive_words: input.cloak.sensitiveWords ?? [],
          cache_user_id: input.cloak.cacheUserId === true,
        },
      }
    : {}),
  ...(input.rebuildMidSystemMessage !== undefined
    ? { rebuild_mid_system_message: input.rebuildMidSystemMessage }
    : {}),
});

export interface CodexProviderConnectivityInput {
  authIndex?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  proxyUrl?: string;
  headers?: Record<string, string>;
  disableImageGeneration?: boolean;
}

export interface CodexProviderConnectivityPayload {
  provider: 'codex';
  auth_index?: string;
  model: string;
  api_key?: string;
  base_url?: string;
  proxy_url?: string;
  header?: Record<string, string>;
  disable_image_generation?: boolean;
}

export const buildCodexProviderConnectivityPayload = (
  input: CodexProviderConnectivityInput
): CodexProviderConnectivityPayload => ({
  provider: 'codex',
  ...(input.authIndex?.trim() ? { auth_index: input.authIndex.trim() } : {}),
  model: input.model.trim(),
  ...(input.apiKey !== undefined ? { api_key: input.apiKey.trim() } : {}),
  ...(input.baseUrl !== undefined ? { base_url: input.baseUrl.trim() } : {}),
  ...(input.proxyUrl !== undefined ? { proxy_url: input.proxyUrl.trim() } : {}),
  ...(input.headers !== undefined ? { header: input.headers } : {}),
  ...(input.disableImageGeneration !== undefined
    ? { disable_image_generation: input.disableImageGeneration }
    : {}),
});

const normalizeBody = (input: unknown): { bodyText: string; body: unknown | null } => {
  if (input === undefined || input === null) return { bodyText: '', body: null };
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return { bodyText: input, body: null };
    try {
      return { bodyText: input, body: JSON.parse(trimmed) };
    } catch {
      return { bodyText: input, body: input };
    }
  }
  try {
    return { bodyText: JSON.stringify(input), body: input };
  } catch {
    return { bodyText: String(input), body: input };
  }
};

export const normalizeProviderConnectivityResult = (
  response: Record<string, unknown> | undefined
): ApiCallResult => {
  const { bodyText, body } = normalizeBody(response?.body);
  return {
    statusCode: Number(response?.status_code ?? 0),
    header: (response?.header ?? {}) as Record<string, string[]>,
    bodyText,
    body,
  };
};
