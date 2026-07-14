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
