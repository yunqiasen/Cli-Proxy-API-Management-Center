export interface RequestLogSyncMetadata {
  syncing?: boolean;
  last_synced_at?: string;
  last_sync_error?: string;
  retention_days?: number;
}

export interface RequestLogRefreshPayload<T> extends RequestLogSyncMetadata {
  items: T[];
  total: number;
}

export interface RequestLogRefreshState<T> {
  items: T[];
  total: number;
  loading: boolean;
  error: string;
  syncing: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string;
  retentionDays: number | null;
}

export function createRequestLogRefreshState<T>(
  items: T[] = [],
  total = 0
): RequestLogRefreshState<T> {
  return {
    items,
    total,
    loading: false,
    error: '',
    syncing: false,
    lastSyncedAt: null,
    lastSyncError: '',
    retentionDays: null,
  };
}

export function applyRequestLogSyncMetadata<T>(
  state: RequestLogRefreshState<T>,
  metadata: RequestLogSyncMetadata
): RequestLogRefreshState<T> {
  return {
    ...state,
    syncing: metadata.syncing ?? state.syncing,
    lastSyncedAt: metadata.last_synced_at ?? state.lastSyncedAt,
    lastSyncError: metadata.last_sync_error ?? state.lastSyncError,
    retentionDays: metadata.retention_days ?? state.retentionDays,
  };
}

export function beginRequestLogRefresh<T>(
  state: RequestLogRefreshState<T>,
  silent: boolean
): RequestLogRefreshState<T> {
  return {
    ...state,
    loading: silent ? state.loading : true,
    error: '',
  };
}

export function applyRequestLogRefreshSuccess<T>(
  state: RequestLogRefreshState<T>,
  payload: RequestLogRefreshPayload<T>
): RequestLogRefreshState<T> {
  return applyRequestLogSyncMetadata(
    {
      ...state,
      items: Array.isArray(payload.items) ? payload.items : [],
      total: Number(payload.total) || 0,
      loading: false,
      error: '',
    },
    payload
  );
}

export function applyRequestLogRefreshError<T>(
  state: RequestLogRefreshState<T>,
  error: string
): RequestLogRefreshState<T> {
  return {
    ...state,
    loading: false,
    error,
  };
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

interface RequestLogRefreshScheduler {
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}

export interface RequestLogRefreshCoordinator {
  tryStart: () => number | null;
  finish: (requestId: number | null) => void;
  scheduleSearch: (value: string, emit: (value: string) => void) => void;
  cancelSearch: () => void;
}

export function createRequestLogRefreshCoordinator(options?: {
  scheduler?: RequestLogRefreshScheduler;
  searchDelayMs?: number;
}): RequestLogRefreshCoordinator {
  const scheduler: RequestLogRefreshScheduler = options?.scheduler ?? {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  };
  const searchDelayMs = options?.searchDelayMs ?? 300;
  let activeRequestId: number | null = null;
  let generation = 0;
  let searchTimer: TimerHandle | null = null;

  return {
    tryStart() {
      if (activeRequestId !== null) return null;
      generation += 1;
      activeRequestId = generation;
      return activeRequestId;
    },
    finish(requestId) {
      if (requestId === activeRequestId) activeRequestId = null;
    },
    scheduleSearch(value, emit) {
      if (searchTimer !== null) scheduler.clearTimeout(searchTimer);
      searchTimer = scheduler.setTimeout(() => {
        searchTimer = null;
        emit(value);
      }, searchDelayMs);
    },
    cancelSearch() {
      if (searchTimer !== null) scheduler.clearTimeout(searchTimer);
      searchTimer = null;
    },
  };
}
