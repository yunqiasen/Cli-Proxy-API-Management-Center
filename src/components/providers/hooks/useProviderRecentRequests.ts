import { useCallback, useEffect, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { apiKeyUsageApi } from '@/services/api';
import {
  normalizeRecentRequestUsageEntry,
  type ApiKeyUsageResponse,
  type RecentRequestUsageEntry,
} from '@/utils/recentRequests';
import {
  PROVIDER_RECENT_REQUESTS_STALE_TIME_MS,
  beginProviderRecentRequestsLoad,
  createInFlightRequestDeduper,
  createProviderRecentRequestsCacheState,
  failProviderRecentRequestsLoad,
  isProviderRecentRequestsCacheFresh,
  resolveProviderRecentRequestsLoad,
} from './providerRecentRequestsCache';

export type ProviderRecentRequests = Map<string, Map<string, RecentRequestUsageEntry>>;

export type UseProviderRecentRequestsOptions = {
  enabled?: boolean;
};

const EMPTY_USAGE_BY_PROVIDER: ProviderRecentRequests = new Map();

let cacheState =
  createProviderRecentRequestsCacheState<ProviderRecentRequests>(EMPTY_USAGE_BY_PROVIDER);
const requestDeduper = createInFlightRequestDeduper<ProviderRecentRequests>();

const normalizeProviderKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeApiKeyUsageResponse = (payload: ApiKeyUsageResponse): ProviderRecentRequests => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return EMPTY_USAGE_BY_PROVIDER;
  }

  const usageByProvider: ProviderRecentRequests = new Map();
  Object.entries(payload).forEach(([provider, entries]) => {
    const providerKey = normalizeProviderKey(provider);
    if (!providerKey || !entries || typeof entries !== 'object' || Array.isArray(entries)) return;

    const usageByCompositeKey = new Map<string, RecentRequestUsageEntry>();
    Object.entries(entries).forEach(([compositeKey, entry]) => {
      usageByCompositeKey.set(compositeKey, normalizeRecentRequestUsageEntry(entry));
    });
    usageByProvider.set(providerKey, usageByCompositeKey);
  });
  return usageByProvider;
};

const fetchProviderRecentRequests = (): Promise<ProviderRecentRequests> => {
  const currentRequest = requestDeduper.current();
  if (currentRequest) return currentRequest;

  const started = beginProviderRecentRequestsLoad(cacheState);
  cacheState = started.state;
  return requestDeduper.run(async () => {
    try {
      const payload = await apiKeyUsageApi.getUsage();
      const normalized = normalizeApiKeyUsageResponse(payload);
      cacheState = resolveProviderRecentRequestsLoad(
        cacheState,
        started.requestId,
        normalized,
        Date.now()
      );
      return cacheState.data;
    } catch (error) {
      cacheState = failProviderRecentRequestsLoad(
        cacheState,
        started.requestId,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  });
};

export function useProviderRecentRequests(options: UseProviderRecentRequestsOptions = {}) {
  const enabled = options.enabled ?? true;
  const [viewState, setViewState] = useState(cacheState);

  const loadRecentRequests = useCallback(
    async (loadOptions: { force?: boolean } = {}) => {
      if (!enabled) return EMPTY_USAGE_BY_PROVIDER;

      const hasFreshCache = isProviderRecentRequestsCacheFresh(cacheState.cachedAt, Date.now());
      if (!loadOptions.force && hasFreshCache) {
        setViewState(cacheState);
        return cacheState.data;
      }

      const request = fetchProviderRecentRequests();
      setViewState(cacheState);
      try {
        await request;
      } catch {
        // The cache transition retains the last committed snapshot.
      }
      setViewState(cacheState);
      return cacheState.data;
    },
    [enabled]
  );

  const refreshRecentRequests = useCallback(
    async () => loadRecentRequests({ force: true }),
    [loadRecentRequests]
  );

  useEffect(() => {
    if (!enabled) {
      setViewState(createProviderRecentRequestsCacheState(EMPTY_USAGE_BY_PROVIDER));
      return;
    }
    void loadRecentRequests();
  }, [enabled, loadRecentRequests]);

  useInterval(
    () => {
      void refreshRecentRequests();
    },
    enabled ? PROVIDER_RECENT_REQUESTS_STALE_TIME_MS : null
  );

  return {
    usageByProvider: enabled ? viewState.data : EMPTY_USAGE_BY_PROVIDER,
    hasLoaded: enabled ? viewState.hasLoaded : false,
    isLoading: enabled ? viewState.isLoading || !viewState.hasLoaded : false,
    error: enabled ? viewState.error : null,
    loadRecentRequests,
    refreshRecentRequests,
  };
}
