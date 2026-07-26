import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { apiKeyUsageApi } from '@/services/api';
import { useAuthStore } from '@/stores';
import {
  normalizeRecentRequestUsageEntry,
  type ApiKeyUsageResponse,
  type RecentRequestUsageEntry,
} from '@/utils/recentRequests';
import {
  PROVIDER_RECENT_REQUESTS_STALE_TIME_MS,
  beginProviderRecentRequestsLoad,
  createProviderRecentRequestsCacheState,
  failProviderRecentRequestsLoad,
  isProviderRecentRequestsCacheFresh,
  resolveProviderRecentRequestsLoad,
  type ProviderRecentRequestsCacheState,
} from './providerRecentRequestsCache';

export type ProviderRecentRequests = Map<string, Map<string, RecentRequestUsageEntry>>;

export type UseProviderRecentRequestsOptions = {
  enabled?: boolean;
};

const EMPTY_USAGE_BY_PROVIDER: ProviderRecentRequests = new Map();

type ProviderRecentRequestsCache = {
  cachedUsageByProvider: ProviderRecentRequests;
  cachedAt: number;
  inFlightRequest: Promise<ProviderRecentRequests> | null;
  state: ProviderRecentRequestsCacheState<ProviderRecentRequests>;
};

const createProviderRecentRequestsCache = (): ProviderRecentRequestsCache => {
  const state = createProviderRecentRequestsCacheState<ProviderRecentRequests>(
    EMPTY_USAGE_BY_PROVIDER
  );
  return {
    cachedUsageByProvider: state.data,
    cachedAt: state.cachedAt,
    inFlightRequest: null,
    state,
  };
};

export const createProviderRecentRequestsCacheController = () => {
  let currentApiBase = '';
  let currentManagementKey = '';
  let currentCache = createProviderRecentRequestsCache();

  return {
    forScope(apiBase: string, managementKey: string): ProviderRecentRequestsCache {
      if (apiBase !== currentApiBase || managementKey !== currentManagementKey) {
        currentApiBase = apiBase;
        currentManagementKey = managementKey;
        currentCache = createProviderRecentRequestsCache();
      }
      return currentCache;
    },
  };
};

const providerRecentRequestsCacheController = createProviderRecentRequestsCacheController();

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

const syncCacheStateFromLegacyFields = (cache: ProviderRecentRequestsCache) => {
  if (cache.state.data === cache.cachedUsageByProvider && cache.state.cachedAt === cache.cachedAt) {
    return;
  }
  cache.state = {
    ...cache.state,
    data: cache.cachedUsageByProvider,
    cachedAt: cache.cachedAt,
    hasLoaded: cache.cachedAt > 0,
  };
};

const syncLegacyFieldsFromCacheState = (cache: ProviderRecentRequestsCache) => {
  cache.cachedUsageByProvider = cache.state.data;
  cache.cachedAt = cache.state.cachedAt;
};

const fetchProviderRecentRequests = (
  cache: ProviderRecentRequestsCache
): Promise<ProviderRecentRequests> => {
  if (cache.inFlightRequest) return cache.inFlightRequest;

  syncCacheStateFromLegacyFields(cache);
  const started = beginProviderRecentRequestsLoad(cache.state);
  cache.state = started.state;
  syncLegacyFieldsFromCacheState(cache);

  const request = (async () => {
    try {
      const payload = await apiKeyUsageApi.getUsage();
      const normalized = normalizeApiKeyUsageResponse(payload);
      cache.state = resolveProviderRecentRequestsLoad(
        cache.state,
        started.requestId,
        normalized,
        Date.now()
      );
      syncLegacyFieldsFromCacheState(cache);
      return cache.state.data;
    } catch (error) {
      cache.state = failProviderRecentRequestsLoad(
        cache.state,
        started.requestId,
        error instanceof Error ? error.message : String(error)
      );
      syncLegacyFieldsFromCacheState(cache);
      throw error;
    }
  })();

  const tracked = request.finally(() => {
    if (cache.inFlightRequest === tracked) {
      cache.inFlightRequest = null;
    }
  });
  cache.inFlightRequest = tracked;
  return tracked;
};

export function useProviderRecentRequests(options: UseProviderRecentRequestsOptions = {}) {
  const enabled = options.enabled ?? true;
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const cache = useMemo(
    () => providerRecentRequestsCacheController.forScope(apiBase, managementKey),
    [apiBase, managementKey]
  );
  const [viewState, setViewState] = useState<{
    cache: ProviderRecentRequestsCache;
    state: ProviderRecentRequestsCacheState<ProviderRecentRequests>;
  }>(() => ({ cache, state: cache.state }));

  const setCurrentViewState = useCallback(
    (state: ProviderRecentRequestsCacheState<ProviderRecentRequests>) => {
      setViewState({ cache, state });
    },
    [cache]
  );

  const loadRecentRequests = useCallback(
    async (loadOptions: { force?: boolean } = {}) => {
      if (!enabled) return EMPTY_USAGE_BY_PROVIDER;

      syncCacheStateFromLegacyFields(cache);
      const hasFreshCache = isProviderRecentRequestsCacheFresh(cache.cachedAt, Date.now());
      if (!loadOptions.force && hasFreshCache) {
        setCurrentViewState(cache.state);
        return cache.state.data;
      }

      const request = fetchProviderRecentRequests(cache);
      setCurrentViewState(cache.state);
      try {
        await request;
      } catch {
        // Keep the last committed snapshot and expose the error through the cache state.
      }
      setCurrentViewState(cache.state);
      return cache.state.data;
    },
    [cache, enabled, setCurrentViewState]
  );

  const refreshRecentRequests = useCallback(
    async () => loadRecentRequests({ force: true }),
    [loadRecentRequests]
  );

  useEffect(() => {
    if (!enabled) {
      setCurrentViewState(createProviderRecentRequestsCacheState(EMPTY_USAGE_BY_PROVIDER));
      return;
    }
    void loadRecentRequests().catch(() => {});
  }, [cache, enabled, loadRecentRequests, setCurrentViewState]);

  useInterval(
    () => {
      void refreshRecentRequests().catch(() => {});
    },
    enabled ? PROVIDER_RECENT_REQUESTS_STALE_TIME_MS : null
  );

  const currentState = viewState.cache === cache ? viewState.state : cache.state;

  return {
    usageByProvider: enabled ? currentState.data : EMPTY_USAGE_BY_PROVIDER,
    hasLoaded: enabled ? currentState.hasLoaded : false,
    isLoading: enabled ? currentState.isLoading || !currentState.hasLoaded : false,
    error: enabled ? currentState.error : null,
    loadRecentRequests,
    refreshRecentRequests,
  };
}
