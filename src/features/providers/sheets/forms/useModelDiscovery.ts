import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { modelsApi } from '@/services/api';
import { buildHeaderObject } from '@/utils/headers';
import { getErrorMessage } from '@/utils/helpers';
import type { ModelInfo } from '@/utils/models';
import type { ApiKeyEntryInput, ProviderBrand } from '../../types';

export const MODEL_DISCOVERY_BRANDS: ReadonlyArray<ProviderBrand> = [
  'gemini',
  'interactions',
  'codex',
  'xai',
  'claude',
  'claudeApi',
  'openaiCompatibility',
  'image',
  'video',
  'audio',
];

export const isModelDiscoveryBrand = (brand: ProviderBrand): boolean =>
  MODEL_DISCOVERY_BRANDS.includes(brand);

export interface UseModelDiscoveryArgs {
  brand: ProviderBrand;
  baseUrl: string;
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
}

export const createModelDiscoveryInputSignature = (
  input: Pick<
    UseModelDiscoveryArgs,
    | 'brand'
    | 'baseUrl'
    | 'formHeaders'
    | 'apiKeyEntries'
    | 'apiKey'
    | 'fallbackApiKey'
    | 'authIndex'
    | 'apiKeyHeader'
    | 'apiKeyPrefix'
  >
): string =>
  JSON.stringify({
    brand: input.brand,
    baseUrl: input.baseUrl,
    formHeaders: input.formHeaders.map(({ key, value }) => ({ key, value })),
    apiKeyEntries: (input.apiKeyEntries ?? []).map((entry) => ({
      apiKey: entry.apiKey ?? '',
      existingApiKey: entry.existingApiKey ?? '',
      authIndex: entry.authIndex ?? '',
      priority: entry.priority ?? null,
      proxyUrl: entry.proxyUrl ?? '',
      weight: entry.weight ?? null,
    })),
    apiKey: input.apiKey ?? '',
    fallbackApiKey: input.fallbackApiKey ?? '',
    authIndex: input.authIndex ?? '',
    apiKeyHeader: input.apiKeyHeader ?? '',
    apiKeyPrefix: input.apiKeyPrefix ?? '',
  });

export interface ModelDiscoveryRequest {
  id: number;
  signature: string;
}

export interface ModelDiscoveryRequestGuard {
  begin: (signature: string) => ModelDiscoveryRequest;
  updateSignature: (signature: string) => void;
  invalidate: () => void;
  isCurrent: (request: ModelDiscoveryRequest) => boolean;
}

export const createModelDiscoveryRequestGuard = (): ModelDiscoveryRequestGuard => {
  let currentRequestID = 0;
  let currentSignature = '';
  return {
    begin: (signature) => {
      currentSignature = signature;
      return { id: ++currentRequestID, signature };
    },
    updateSignature: (signature) => {
      currentSignature = signature;
    },
    invalidate: () => {
      currentRequestID += 1;
    },
    isCurrent: (request) =>
      request.id === currentRequestID && request.signature === currentSignature,
  };
};

export interface UseModelDiscoveryResult {
  available: boolean;
  loading: boolean;
  error: string | null;
  models: ModelInfo[];
  hasFetched: boolean;
  fetch: () => Promise<void>;
  reset: () => void;
}

export function useModelDiscovery(args: UseModelDiscoveryArgs): UseModelDiscoveryResult {
  const {
    brand,
    baseUrl,
    formHeaders,
    apiKeyEntries,
    apiKey,
    fallbackApiKey,
    authIndex,
    apiKeyHeader,
    apiKeyPrefix,
  } = args;

  const available = isModelDiscoveryBrand(brand);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [requestGuard] = useState(createModelDiscoveryRequestGuard);

  const inputSignature = useMemo(
    () =>
      createModelDiscoveryInputSignature({
        brand,
        baseUrl,
        formHeaders,
        apiKeyEntries,
        apiKey,
        fallbackApiKey,
        authIndex,
        apiKeyHeader,
        apiKeyPrefix,
      }),
    [
      apiKey,
      apiKeyEntries,
      apiKeyHeader,
      apiKeyPrefix,
      authIndex,
      baseUrl,
      brand,
      fallbackApiKey,
      formHeaders,
    ]
  );

  requestGuard.updateSignature(inputSignature);

  const fetch = useCallback(async () => {
    if (!available) return;
    const request = requestGuard.begin(inputSignature);
    setLoading(true);
    setError(null);
    try {
      const baseHeaders = buildHeaderObject(formHeaders);
      const resolvedAuthIndex = (authIndex ?? '').trim() || undefined;
      let next: ModelInfo[] = [];
      if (brand === 'gemini' || brand === 'interactions') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchGeminiModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex
        );
      } else if (brand === 'codex' || brand === 'xai') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchV1ModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex
        );
      } else if (brand === 'claude' || brand === 'claudeApi') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchClaudeModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex
        );
      } else if (
        brand === 'openaiCompatibility' ||
        brand === 'image' ||
        brand === 'video' ||
        brand === 'audio'
      ) {
        const firstEntry = (apiKeyEntries ?? []).find(
          (e) =>
            (e.apiKey ?? '').trim() || (e.existingApiKey ?? '').trim() || (e.authIndex ?? '').trim()
        );
        const entryKey =
          (firstEntry?.apiKey ?? '').trim() || (firstEntry?.existingApiKey ?? '').trim();
        const entryAuthIndex = (firstEntry?.authIndex ?? '').trim() || resolvedAuthIndex;
        const fetchModels = () =>
          brand === 'openaiCompatibility'
            ? modelsApi.fetchModelsViaApiCall(baseUrl, entryKey, baseHeaders, entryAuthIndex)
            : modelsApi.fetchMediaModelsViaApiCall(
                baseUrl,
                entryKey,
                baseHeaders,
                entryAuthIndex,
                apiKeyHeader,
                apiKeyPrefix
              );
        try {
          next = await fetchModels();
        } catch (firstErr) {
          // Some compatible endpoints expose /models without auth. Retry once
          // without provider credentials before surfacing the original error.
          try {
            next = await modelsApi.fetchModelsViaApiCall(baseUrl);
          } catch {
            throw firstErr;
          }
        }
      }
      if (!requestGuard.isCurrent(request)) return;
      setModels(next ?? []);
      setHasFetched(true);
    } catch (err) {
      if (!requestGuard.isCurrent(request)) return;
      setModels([]);
      setError(getErrorMessage(err) || 'Failed to fetch models');
      setHasFetched(true);
    } finally {
      if (requestGuard.isCurrent(request)) setLoading(false);
    }
  }, [
    available,
    apiKey,
    apiKeyEntries,
    apiKeyHeader,
    apiKeyPrefix,
    authIndex,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    inputSignature,
    requestGuard,
  ]);

  const reset = useCallback(() => {
    requestGuard.invalidate();
    setModels([]);
    setError(null);
    setLoading(false);
    setHasFetched(false);
  }, [requestGuard]);

  const lastSignatureRef = useRef(inputSignature);
  useEffect(() => {
    if (lastSignatureRef.current === inputSignature) return;
    lastSignatureRef.current = inputSignature;
    reset();
  }, [inputSignature, reset]);

  return { available, loading, error, models, hasFetched, fetch, reset };
}
