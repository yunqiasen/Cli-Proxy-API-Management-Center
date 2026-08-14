import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  aggregateClaudeConnectivityStatuses,
  apiCallApi,
  getApiCallErrorMessage,
  providerConnectivityApi,
  resolveClaudeConnectivityCredential,
} from '@/services/api';
import {
  buildGeminiGenerateContentEndpoint,
  buildInteractionsEndpoint,
  buildInteractionsProbePayload,
  INTERACTIONS_API_REVISION,
  buildOpenAIChatCompletionsEndpoint,
} from '@/components/providers/utils';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import { getErrorMessage } from '@/utils/helpers';
import type { ApiKeyEntryInput, ModelEntryInput, ProviderBrand } from '../../types';
import { getCodexProbeEntryIndices, simulateCodexProvider } from '../../codexProviderProbe';
import { createRequestGeneration } from '../../requestGeneration';

const DEFAULT_TIMEOUT_MS = 30_000;

export type ConnectivityState = 'idle' | 'loading' | 'success' | 'error';

export interface ConnectivityStatus {
  state: ConnectivityState;
  message: string;
}

const IDLE: ConnectivityStatus = { state: 'idle', message: '' };

const requestFailureMessage = (err: unknown, messages: ConnectivityErrorMessages): string => {
  const raw = getErrorMessage(err);
  const isTimeout =
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      String((err as { code?: string }).code) === 'ECONNABORTED') ||
    raw.toLowerCase().includes('timeout');

  return isTimeout ? messages.timeout(DEFAULT_TIMEOUT_MS / 1000) : raw || messages.requestFailed;
};

const pickModel = (testModel: string | undefined, models: ModelEntryInput[]): string => {
  const trimmed = (testModel ?? '').trim();
  if (trimmed) return trimmed;
  for (const m of models) {
    const name = (m.name ?? '').trim();
    if (name) return name;
  }
  return '';
};

export interface UseConnectivityTestArgs {
  brand: ProviderBrand;
  baseUrl: string;
  proxyUrl?: string;
  testModel?: string;
  models: ModelEntryInput[];
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
  cloak?: {
    mode: string;
    strictMode: boolean;
    sensitiveWordsText: string;
    cacheUserId: boolean;
  };
  rebuildMidSystemMessage?: boolean;
}

export interface ConnectivityErrorMessages {
  baseUrlRequired: string;
  endpointInvalid: string;
  apiKeyRequired: string;
  modelRequired: string;
  timeout: (seconds: number) => string;
  requestFailed: string;
}

export interface UseConnectivityTestResult {
  openaiStatuses: ConnectivityStatus[];
  codexStatus: ConnectivityStatus;
  geminiStatus: ConnectivityStatus;
  claudeStatus: ConnectivityStatus;
  isTestingAny: boolean;
  runOpenAIKey: (idx: number) => Promise<boolean>;
  runOpenAIAllKeys: () => Promise<void>;
  runNativeKey: (idx: number) => Promise<void>;
  runNativeAllKeys: () => Promise<void>;
  runCodex: (entryIndex?: number, testAll?: boolean) => Promise<void>;
  runGemini: () => Promise<void>;
  runClaude: (entryIndex?: number, updateGlobal?: boolean) => Promise<ConnectivityStatus>;
}

export function useConnectivityTest(
  args: UseConnectivityTestArgs,
  messages: ConnectivityErrorMessages
): UseConnectivityTestResult {
  const {
    brand,
    baseUrl,
    proxyUrl,
    testModel,
    models,
    formHeaders,
    apiKeyEntries,
    apiKey,
    fallbackApiKey,
    authIndex,
    cloak,
    rebuildMidSystemMessage,
  } = args;

  const entriesCount = apiKeyEntries?.length ?? 0;

  const [openaiStatuses, setOpenaiStatuses] = useState<ConnectivityStatus[]>(() =>
    Array.from({ length: entriesCount }, () => IDLE)
  );
  const [codexStatus, setCodexStatus] = useState<ConnectivityStatus>(IDLE);
  const [geminiStatus, setGeminiStatus] = useState<ConnectivityStatus>(IDLE);
  const [claudeStatus, setClaudeStatus] = useState<ConnectivityStatus>(IDLE);
  const [inFlight, setInFlight] = useState(0);
  const requestGenerationRef = useRef(createRequestGeneration());

  const entrySignatures = useMemo(
    () =>
      (apiKeyEntries ?? []).map((entry) =>
        [
          entry.apiKey ?? '',
          entry.existingApiKey ?? '',
          entry.authIndex ?? '',
          entry.proxyUrl ?? '',
        ].join('||')
      ),
    [apiKeyEntries]
  );

  const lastEntrySignaturesRef = useRef<string[]>(entrySignatures);
  useEffect(() => {
    requestGenerationRef.current.invalidate();
    const prev = lastEntrySignaturesRef.current;
    const curr = entrySignatures;
    lastEntrySignaturesRef.current = curr;

    const entriesChanged =
      prev.length !== curr.length || curr.some((entry, index) => entry !== prev[index]);
    setOpenaiStatuses((statuses) => {
      const nextLen = curr.length;
      let mutated = statuses.length !== nextLen;
      const next = statuses.slice(0, nextLen);
      while (next.length < nextLen) next.push(IDLE);
      for (let i = 0; i < nextLen; i++) {
        if (prev[i] !== undefined && prev[i] !== curr[i] && next[i].state !== 'idle') {
          next[i] = IDLE;
          mutated = true;
        }
      }
      return mutated ? next : statuses;
    });
    if (entriesChanged) {
      setCodexStatus(IDLE);
      setGeminiStatus(IDLE);
      setClaudeStatus(IDLE);
    }
  }, [entrySignatures]);

  const signature = useMemo(() => {
    const h = formHeaders.map((it) => `${it.key}:${it.value}`).join('|');
    const m = models.map((it) => `${it.name}:${it.alias ?? ''}`).join('|');
    return [
      brand,
      baseUrl,
      proxyUrl ?? '',
      (testModel ?? '').trim(),
      apiKey ?? '',
      fallbackApiKey ?? '',
      authIndex ?? '',
      cloak?.mode ?? '',
      String(cloak?.strictMode ?? false),
      cloak?.sensitiveWordsText ?? '',
      String(cloak?.cacheUserId ?? false),
      String(rebuildMidSystemMessage ?? false),
      h,
      m,
    ].join('||');
  }, [
    apiKey,
    authIndex,
    baseUrl,
    brand,
    cloak,
    proxyUrl,
    fallbackApiKey,
    formHeaders,
    models,
    rebuildMidSystemMessage,
    testModel,
  ]);

  const lastSignatureRef = useRef(signature);
  useEffect(() => {
    if (lastSignatureRef.current === signature) return;
    requestGenerationRef.current.invalidate();
    lastSignatureRef.current = signature;
    setOpenaiStatuses((prev) => prev.map(() => IDLE));
    setCodexStatus(IDLE);
    setGeminiStatus(IDLE);
    setClaudeStatus(IDLE);
  }, [signature]);

  const updateOpenaiStatus = useCallback((idx: number, value: ConnectivityStatus) => {
    setOpenaiStatuses((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }, []);

  const runOpenAIKey = useCallback(
    async (idx: number): Promise<boolean> => {
      if (brand !== 'openaiCompatibility') return false;

      const generation = requestGenerationRef.current.begin();
      const trimmedBase = baseUrl.trim();
      if (!trimmedBase) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.baseUrlRequired,
        });
        return false;
      }
      const endpoint = buildOpenAIChatCompletionsEndpoint(trimmedBase);
      if (!endpoint) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.endpointInvalid,
        });
        return false;
      }
      const entry = apiKeyEntries?.[idx];
      const entryKey = (entry?.apiKey ?? '').trim() || (entry?.existingApiKey ?? '').trim();
      const resolvedAuthIndex =
        (entry?.authIndex ?? '').trim() || (authIndex ?? '').trim() || undefined;
      if (!entryKey && !resolvedAuthIndex) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.apiKeyRequired,
        });
        return false;
      }
      const model = pickModel(testModel, models);
      if (!model) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.modelRequired,
        });
        return false;
      }

      const headerObj: Record<string, string> = {
        'Content-Type': 'application/json',
        ...buildHeaderObject(formHeaders),
      };
      if (!hasHeader(headerObj, 'authorization')) {
        if (entryKey) {
          headerObj.Authorization = `Bearer ${entryKey}`;
        } else if (resolvedAuthIndex) {
          headerObj.Authorization = 'Bearer $TOKEN$';
        }
      }

      updateOpenaiStatus(idx, { state: 'loading', message: '' });
      setInFlight((n) => n + 1);
      try {
        const result = await apiCallApi.request(
          {
            authIndex: resolvedAuthIndex,
            method: 'POST',
            url: endpoint,
            header: headerObj,
            data: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'Hi' }],
              stream: false,
              max_tokens: 5,
            }),
          },
          { timeout: DEFAULT_TIMEOUT_MS }
        );
        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(getApiCallErrorMessage(result));
        }
        if (!requestGenerationRef.current.isCurrent(generation)) return false;
        updateOpenaiStatus(idx, { state: 'success', message: '' });
        return true;
      } catch (err) {
        if (requestGenerationRef.current.isCurrent(generation)) {
          updateOpenaiStatus(idx, {
            state: 'error',
            message: requestFailureMessage(err, messages),
          });
        }
        return false;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [
      apiKeyEntries,
      authIndex,
      baseUrl,
      brand,
      formHeaders,
      messages,
      models,
      testModel,
      updateOpenaiStatus,
    ]
  );

  const runOpenAIAllKeys = useCallback(async (): Promise<void> => {
    if (brand !== 'openaiCompatibility') return;
    const entries = apiKeyEntries ?? [];
    if (!entries.length) return;
    await Promise.all(entries.map((_, idx) => runOpenAIKey(idx)));
  }, [apiKeyEntries, brand, runOpenAIKey]);

  const runCodex = useCallback(
    async (entryIndex?: number, testAll = false): Promise<void> => {
      if (brand !== 'codex' && brand !== 'xai') return;

      const generation = requestGenerationRef.current.begin();
      const normalizedEntries = (apiKeyEntries ?? []).map((entry, index) => ({
        apiKey:
          (entry.apiKey ?? '').trim() ||
          (entry.existingApiKey ?? '').trim() ||
          (index === 0 ? (fallbackApiKey ?? '').trim() : ''),
        priority: entry.priority,
        proxyUrl: entry.proxyUrl?.trim() || undefined,
        authIndex: entry.authIndex?.trim() || (index === 0 ? authIndex?.trim() : '') || undefined,
      }));
      const legacyKey = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
      const selectedIndices = getCodexProbeEntryIndices(entryIndex, testAll);

      setCodexStatus({ state: 'loading', message: '' });
      if (testAll) {
        (apiKeyEntries ?? []).forEach((_, index) =>
          updateOpenaiStatus(index, { state: 'loading', message: '' })
        );
      } else if (entryIndex !== undefined) {
        updateOpenaiStatus(entryIndex, { state: 'loading', message: '' });
      }
      setInFlight((n) => n + 1);
      try {
        const result = await simulateCodexProvider(
          {
            apiKey: legacyKey,
            apiKeyEntries: normalizedEntries.length ? normalizedEntries : undefined,
            baseUrl,
            headers: buildHeaderObject(formHeaders),
            models: models.map((model) => ({
              name: model.name,
              alias: model.alias,
              priority: model.priority,
              testModel: model.testModel,
            })),
            authIndex: authIndex?.trim() || undefined,
          },
          messages,
          {
            entryIndices: selectedIndices,
            model: (testModel ?? '').trim() || undefined,
            timeoutMs: DEFAULT_TIMEOUT_MS,
          }
        );
        const status: ConnectivityStatus = {
          state: result.state,
          message: result.message,
        };
        if (!requestGenerationRef.current.isCurrent(generation)) return;
        setCodexStatus(status);
        if (testAll) {
          result.entries.forEach((entry) =>
            updateOpenaiStatus(entry.index, { state: entry.state, message: entry.message })
          );
        } else if (entryIndex !== undefined) {
          updateOpenaiStatus(entryIndex, status);
        }
      } catch (error) {
        if (!requestGenerationRef.current.isCurrent(generation)) return;
        const status: ConnectivityStatus = {
          state: 'error',
          message: requestFailureMessage(error, messages),
        };
        setCodexStatus(status);
        if (testAll) {
          (apiKeyEntries ?? []).forEach((_, index) => updateOpenaiStatus(index, status));
        } else if (entryIndex !== undefined) {
          updateOpenaiStatus(entryIndex, status);
        }
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [
      apiKey,
      apiKeyEntries,
      authIndex,
      baseUrl,
      brand,
      fallbackApiKey,
      formHeaders,
      messages,
      models,
      testModel,
      updateOpenaiStatus,
    ]
  );

  const runGemini = useCallback(
    async (entryIndex?: number): Promise<void> => {
      if (brand !== 'gemini' && brand !== 'interactions') return;

      const generation = requestGenerationRef.current.begin();
      const model = pickModel(testModel, models);
      if (!model) {
        setGeminiStatus({ state: 'error', message: messages.modelRequired });
        return;
      }

      const endpoint =
        brand === 'interactions'
          ? buildInteractionsEndpoint(baseUrl ?? '')
          : buildGeminiGenerateContentEndpoint(baseUrl ?? '', model);
      if (!endpoint) {
        setGeminiStatus({ state: 'error', message: messages.endpointInvalid });
        return;
      }

      const customHeaders = buildHeaderObject(formHeaders);
      const selectedEntry = entryIndex === undefined ? undefined : apiKeyEntries?.[entryIndex];
      const explicitKey = (selectedEntry?.apiKey ?? apiKey ?? '').trim();
      const persistedKey = (selectedEntry?.existingApiKey ?? fallbackApiKey ?? '').trim();
      const hasApiKeyHeader = hasHeader(customHeaders, 'x-goog-api-key');
      const resolvedKey = explicitKey || persistedKey;
      const resolvedAuthIndex =
        (selectedEntry?.authIndex ?? '').trim() || (authIndex ?? '').trim() || undefined;

      if (!resolvedKey && !hasApiKeyHeader && !resolvedAuthIndex) {
        setGeminiStatus({ state: 'error', message: messages.apiKeyRequired });
        return;
      }

      const headerObj: Record<string, string> = {
        'Content-Type': 'application/json',
        ...customHeaders,
      };
      if (!hasHeader(headerObj, 'x-goog-api-key')) {
        if (resolvedKey) headerObj['x-goog-api-key'] = resolvedKey;
        else if (resolvedAuthIndex) headerObj['x-goog-api-key'] = '$TOKEN$';
      }
      if (brand === 'interactions' && !hasHeader(headerObj, 'api-revision')) {
        headerObj['Api-Revision'] = INTERACTIONS_API_REVISION;
      }

      setGeminiStatus({ state: 'loading', message: '' });
      setInFlight((n) => n + 1);
      try {
        const result = await apiCallApi.request(
          {
            authIndex: resolvedAuthIndex,
            method: 'POST',
            url: endpoint,
            header: headerObj,
            data: JSON.stringify(
              brand === 'interactions'
                ? buildInteractionsProbePayload(model)
                : {
                    contents: [{ parts: [{ text: 'Hi' }] }],
                    generationConfig: { maxOutputTokens: 8 },
                  }
            ),
          },
          { timeout: DEFAULT_TIMEOUT_MS }
        );
        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(getApiCallErrorMessage(result));
        }
        if (!requestGenerationRef.current.isCurrent(generation)) return;
        setGeminiStatus({ state: 'success', message: '' });
        if (entryIndex !== undefined)
          updateOpenaiStatus(entryIndex, { state: 'success', message: '' });
      } catch (err) {
        if (!requestGenerationRef.current.isCurrent(generation)) return;
        const failure = { state: 'error' as const, message: requestFailureMessage(err, messages) };
        setGeminiStatus(failure);
        if (entryIndex !== undefined) updateOpenaiStatus(entryIndex, failure);
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [
      apiKey,
      apiKeyEntries,
      authIndex,
      baseUrl,
      brand,
      fallbackApiKey,
      formHeaders,
      messages,
      models,
      testModel,
      updateOpenaiStatus,
    ]
  );

  const runClaude = useCallback(
    async (entryIndex?: number, updateGlobal = true): Promise<ConnectivityStatus> => {
      if (brand !== 'claude' && brand !== 'claudeApi') return IDLE;

      const generation = requestGenerationRef.current.begin();
      const failValidation = (message: string): ConnectivityStatus => {
        const failure = { state: 'error' as const, message };
        if (updateGlobal) setClaudeStatus(failure);
        if (entryIndex !== undefined) updateOpenaiStatus(entryIndex, failure);
        return failure;
      };
      const model = pickModel(testModel, models);
      if (!model) return failValidation(messages.modelRequired);

      const { explicitKey, resolvedKey, resolvedAuthIndex, resolvedProxyUrl } =
        resolveClaudeConnectivityCredential({
          entryIndex,
          apiKeyEntries,
          apiKey,
          fallbackApiKey,
          authIndex,
          proxyUrl,
        });
      if (!resolvedKey && !resolvedAuthIndex) return failValidation(messages.apiKeyRequired);

      if (updateGlobal) setClaudeStatus({ state: 'loading', message: '' });
      if (entryIndex !== undefined) {
        updateOpenaiStatus(entryIndex, { state: 'loading', message: '' });
      }
      setInFlight((n) => n + 1);
      try {
        const result = await providerConnectivityApi.requestClaude(
          {
            authIndex: resolvedAuthIndex,
            model,
            ...((explicitKey || !resolvedAuthIndex) && resolvedKey
              ? { apiKey: explicitKey || resolvedKey }
              : {}),
            baseUrl,
            proxyUrl: resolvedProxyUrl,
            headers: buildHeaderObject(formHeaders),
            ...(cloak
              ? {
                  cloak: {
                    mode: cloak.mode,
                    strictMode: cloak.strictMode,
                    sensitiveWords: cloak.sensitiveWordsText
                      .split(/[\n,]+/)
                      .map((word) => word.trim())
                      .filter(Boolean),
                    cacheUserId: cloak.cacheUserId,
                  },
                }
              : {}),
            ...(rebuildMidSystemMessage !== undefined ? { rebuildMidSystemMessage } : {}),
          },
          { timeout: DEFAULT_TIMEOUT_MS }
        );
        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(getApiCallErrorMessage(result));
        }
        const success = { state: 'success' as const, message: '' };
        if (!requestGenerationRef.current.isCurrent(generation)) return success;
        if (updateGlobal) setClaudeStatus(success);
        if (entryIndex !== undefined) updateOpenaiStatus(entryIndex, success);
        return success;
      } catch (err) {
        const failure = { state: 'error' as const, message: requestFailureMessage(err, messages) };
        if (!requestGenerationRef.current.isCurrent(generation)) return failure;
        if (updateGlobal) setClaudeStatus(failure);
        if (entryIndex !== undefined) updateOpenaiStatus(entryIndex, failure);
        return failure;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [
      apiKey,
      apiKeyEntries,
      authIndex,
      baseUrl,
      brand,
      cloak,
      fallbackApiKey,
      formHeaders,
      messages,
      models,
      proxyUrl,
      rebuildMidSystemMessage,
      testModel,
      updateOpenaiStatus,
    ]
  );

  const runNativeKey = useCallback(
    async (idx: number): Promise<void> => {
      updateOpenaiStatus(idx, { state: 'loading', message: '' });
      if (brand === 'codex' || brand === 'xai') await runCodex(idx);
      else if (brand === 'gemini') await runGemini(idx);
      else if (brand === 'claude') await runClaude(idx, true);
    },
    [brand, runClaude, runCodex, runGemini, updateOpenaiStatus]
  );

  const runNativeAllKeys = useCallback(async (): Promise<void> => {
    if (brand === 'codex' || brand === 'xai') {
      await runCodex(undefined, true);
      return;
    }
    const entries = apiKeyEntries ?? [];
    if (brand === 'claude') {
      if (!entries.length) return;
      const generation = requestGenerationRef.current.begin();
      setClaudeStatus({ state: 'loading', message: '' });
      const statuses = await Promise.all(entries.map((_, idx) => runClaude(idx, false)));
      if (requestGenerationRef.current.isCurrent(generation)) {
        setClaudeStatus(aggregateClaudeConnectivityStatuses(statuses));
      }
      return;
    }
    await Promise.all(entries.map((_, idx) => runNativeKey(idx)));
  }, [apiKeyEntries, brand, runClaude, runCodex, runNativeKey]);

  return {
    openaiStatuses,
    codexStatus,
    geminiStatus,
    claudeStatus,
    isTestingAny: inFlight > 0,
    runOpenAIKey,
    runOpenAIAllKeys,
    runNativeKey,
    runNativeAllKeys,
    runCodex,
    runGemini,
    runClaude,
  };
}
