export const PROVIDER_RECENT_REQUESTS_STALE_TIME_MS = 15_000;

export interface ProviderRecentRequestsCacheState<T> {
  data: T;
  cachedAt: number;
  hasLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  generation: number;
  activeRequestId: number | null;
}

export function createProviderRecentRequestsCacheState<T>(
  data: T,
  cachedAt = 0,
  hasLoaded = cachedAt > 0
): ProviderRecentRequestsCacheState<T> {
  return {
    data,
    cachedAt,
    hasLoaded,
    isLoading: false,
    error: null,
    generation: 0,
    activeRequestId: null,
  };
}

export function beginProviderRecentRequestsLoad<T>(state: ProviderRecentRequestsCacheState<T>): {
  state: ProviderRecentRequestsCacheState<T>;
  requestId: number;
} {
  const requestId = state.generation + 1;
  return {
    requestId,
    state: {
      ...state,
      isLoading: true,
      error: null,
      generation: requestId,
      activeRequestId: requestId,
    },
  };
}

export function resolveProviderRecentRequestsLoad<T>(
  state: ProviderRecentRequestsCacheState<T>,
  requestId: number,
  data: T,
  cachedAt: number
): ProviderRecentRequestsCacheState<T> {
  if (requestId !== state.activeRequestId) return state;
  return {
    ...state,
    data,
    cachedAt,
    hasLoaded: true,
    isLoading: false,
    error: null,
    activeRequestId: null,
  };
}

export function failProviderRecentRequestsLoad<T>(
  state: ProviderRecentRequestsCacheState<T>,
  requestId: number,
  error: string
): ProviderRecentRequestsCacheState<T> {
  if (requestId !== state.activeRequestId) return state;
  return {
    ...state,
    isLoading: false,
    error,
    activeRequestId: null,
  };
}

export const isProviderRecentRequestsCacheFresh = (cachedAt: number, now: number): boolean =>
  cachedAt > 0 && now - cachedAt < PROVIDER_RECENT_REQUESTS_STALE_TIME_MS;

export interface InFlightRequestDeduper<T> {
  run: (factory: () => Promise<T>) => Promise<T>;
  current: () => Promise<T> | null;
}

export function createInFlightRequestDeduper<T>(): InFlightRequestDeduper<T> {
  let inFlight: Promise<T> | null = null;
  return {
    run(factory) {
      if (inFlight) return inFlight;
      const request = factory();
      const tracked = request.finally(() => {
        if (inFlight === tracked) inFlight = null;
      });
      inFlight = tracked;
      return tracked;
    },
    current: () => inFlight,
  };
}

export interface ProviderRecentRequestsLoadCache<T> {
  state: ProviderRecentRequestsCacheState<T>;
  inFlightRequest: Promise<T> | null;
}

export interface ProviderRecentRequestsLoadOptions {
  force?: boolean;
  now?: () => number;
}

export function runProviderRecentRequestsLoad<T>(
  cache: ProviderRecentRequestsLoadCache<T>,
  factory: () => Promise<T>,
  options: ProviderRecentRequestsLoadOptions = {}
): Promise<T> {
  if (!options.force && cache.inFlightRequest) return cache.inFlightRequest;

  const started = beginProviderRecentRequestsLoad(cache.state);
  cache.state = started.state;
  const request = (async () => {
    try {
      const data = await factory();
      cache.state = resolveProviderRecentRequestsLoad(
        cache.state,
        started.requestId,
        data,
        (options.now ?? Date.now)()
      );
      return data;
    } catch (error) {
      cache.state = failProviderRecentRequestsLoad(
        cache.state,
        started.requestId,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  })();
  const tracked = request.finally(() => {
    if (cache.inFlightRequest === tracked) cache.inFlightRequest = null;
  });
  cache.inFlightRequest = tracked;
  return tracked;
}

export interface ProviderRecentRequestsSnapshot<T> {
  data: T;
  configReloadPending: boolean;
}

export interface ProviderRecentRequestsWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_CONFIG_RELOAD_WAIT_TIMEOUT_MS = 5_000;
const DEFAULT_CONFIG_RELOAD_POLL_INTERVAL_MS = 25;

export async function waitForProviderRecentRequestsReady<T>(
  fetchSnapshot: () => Promise<ProviderRecentRequestsSnapshot<T>>,
  options: ProviderRecentRequestsWaitOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIG_RELOAD_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_CONFIG_RELOAD_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
  const startedAt = now();

  for (;;) {
    const snapshot = await fetchSnapshot();
    if (!snapshot.configReloadPending) return snapshot.data;
    if (now() - startedAt >= timeoutMs) {
      throw new Error('Provider usage refresh timed out while config reload was pending');
    }
    await sleep(pollIntervalMs);
  }
}
