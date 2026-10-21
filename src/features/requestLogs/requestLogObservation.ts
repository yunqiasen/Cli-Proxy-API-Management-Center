/**
 * Pure observation logic for request-log state derivation, merge, filtering and export params.
 * No React dependencies — safe for unit testing.
 */

import type {
  RequestLogItem,
  RequestLogAttempt,
  RequestLogDetail,
  RequestLogMetadataDetail,
} from '@/services/api';

export type ObservationState =
  'active' | 'succeeded' | 'failed' | 'canceled' | 'interrupted' | 'recovered';

export type ErrorKind =
  | 'authentication'
  | 'permission'
  | 'quota'
  | 'rate_limit'
  | 'compatibility'
  | 'connection'
  | 'upstream'
  | 'canceled'
  | 'interrupted'
  | 'unknown';

export const OBSERVATION_STATE_VALUES = [
  'active',
  'succeeded',
  'failed',
  'canceled',
  'interrupted',
  'recovered',
] as const;

export const ERROR_KIND_VALUES = [
  'authentication',
  'permission',
  'quota',
  'rate_limit',
  'compatibility',
  'connection',
  'upstream',
  'canceled',
  'interrupted',
  'unknown',
] as const;

/** States valid for i18n label lookup (includes attempt-only state 'retried'). */
const VALID_LABEL_STATES = new Set<string>([...OBSERVATION_STATE_VALUES, 'retried']);

export const STATE_FILTER_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: 'all', labelKey: 'logs.observation_state_all' },
  { value: 'active', labelKey: 'logs.observation_state_active' },
  { value: 'succeeded', labelKey: 'logs.observation_state_succeeded' },
  { value: 'failed', labelKey: 'logs.observation_state_failed' },
  { value: 'canceled', labelKey: 'logs.observation_state_canceled' },
  { value: 'interrupted', labelKey: 'logs.observation_state_interrupted' },
  { value: 'recovered', labelKey: 'logs.observation_state_recovered' },
];

/**
 * Derive observation state from a possibly-legacy item that lacks the `state` field.
 * Legacy raw rows use `success` boolean; recovered flag means it failed then succeeded.
 * When no state, recovered, or success is available, returns 'unknown' — not 'active'.
 */
export function deriveItemState(
  item: Pick<RequestLogItem, 'state' | 'recovered' | 'success'>
): string {
  if (item.state) return item.state;
  if (item.recovered) return 'recovered';
  if (item.success === true) return 'succeeded';
  if (item.success === false) return 'failed';
  return 'unknown';
}

export function isActiveState(state: string): boolean {
  return state === 'active';
}

export function isTerminalState(state: string): boolean {
  return ['succeeded', 'failed', 'canceled', 'interrupted', 'recovered'].includes(state);
}

/**
 * Reconcile bounded metadata poll results by ID without putting whole bodies in polling.
 * For each item in `next`, if it exists in `prev`, merge so prev preview fields are
 * preserved when absent in the polled metadata snapshot.
 */
export function mergeObservationItems(
  prev: RequestLogItem[],
  next: RequestLogItem[]
): RequestLogItem[] {
  const prevMap = new Map<string, RequestLogItem>();
  for (const item of prev) prevMap.set(item.id, item);
  return next.map((item) => {
    const existing = prevMap.get(item.id);
    return existing
      ? { ...existing, ...item, phase: item.phase, error_kind: item.error_kind }
      : item;
  });
}

/**
 * Merge metadata-only poll result into an existing detail without replacing
 * full prompt/output/tool bodies that may have been fetched previously.
 */
export function mergeMetadataIntoDetail(
  prev: RequestLogDetail,
  meta: RequestLogMetadataDetail
): RequestLogDetail {
  if (prev.id !== meta.id) return prev;
  return {
    ...prev,
    state: meta.state ?? prev.state,
    phase: meta.phase,
    error_kind: meta.error_kind,
    recovered: meta.recovered ?? prev.recovered,
    trace_id: meta.trace_id ?? prev.trace_id,
    raw_log_id: meta.raw_log_id ?? prev.raw_log_id,
    raw_log_pending: meta.raw_log_pending ?? false,
    provider: meta.provider ?? prev.provider,
    model: meta.model ?? prev.model,
    upstream_model: meta.upstream_model ?? prev.upstream_model,
    channel_model: meta.channel_model ?? prev.channel_model,
    auth_id: meta.auth_id ?? prev.auth_id,
    attempt_count: meta.attempt_count ?? prev.attempt_count,
    attempts_truncated: meta.attempts_truncated ?? prev.attempts_truncated,
    attempts: meta.attempts ?? prev.attempts,
    status: meta.status ?? prev.status,
    success: meta.success ?? prev.success,
    has_error: meta.has_error ?? prev.has_error,
  };
}

/**
 * Client-side state filter fallback for legacy items that lack the `state` field.
 * Primary filtering is server-side via the `state` query param.
 */
export function filterByState(items: RequestLogItem[], state: string): RequestLogItem[] {
  if (!state || state === 'all') return items;
  if (state === 'recovered') {
    return items.filter((i) => i.recovered === true || deriveItemState(i) === 'recovered');
  }
  return items.filter((i) => deriveItemState(i) === state);
}

/**
 * Build export params preserving view/state/query/page parameters.
 */
export function buildExportParams(params: {
  q?: string;
  state?: string;
  limit?: number;
  offset?: number;
  pages?: number;
  format?: string;
}): Record<string, string | number | undefined> {
  return {
    view: 'routes',
    q: params.q || undefined,
    state: params.state && params.state !== 'all' ? params.state : undefined,
    limit: params.limit,
    offset: params.offset,
    pages: params.pages,
    format: params.format,
  };
}

/**
 * Sort attempts by index to show ordered physical attempts (including same-key retries).
 */
export function sortAttempts(attempts: RequestLogAttempt[]): RequestLogAttempt[] {
  return [...attempts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/**
 * Check if any item in the list is currently active (needs faster polling).
 */
export function hasActiveItems(items: RequestLogItem[]): boolean {
  return items.some((item) => deriveItemState(item) === 'active');
}

/**
 * Determine the poll interval: active items poll faster (1-2s), history stays 5s.
 */
export function resolvePollInterval(
  stateFilter: string,
  items: RequestLogItem[],
  baseMs = 5000,
  activeMs = 1500
): number {
  if (stateFilter === 'active') return activeMs;
  if (hasActiveItems(items)) return activeMs;
  return baseMs;
}

/**
 * Safe state label key for i18n. Returns the key suffix, caller prepends 'logs.observation_state_'.
 */
export function stateLabelKey(state: string): string {
  return VALID_LABEL_STATES.has(state) ? state : 'unknown';
}

/**
 * Safe error kind label key for i18n. Returns the key suffix.
 */
export function errorKindLabelKey(errorKind: string): string {
  const valid = ERROR_KIND_VALUES.includes(errorKind as ErrorKind);
  return valid ? errorKind : 'unknown';
}

/**
 * Safe phase label key for i18n.
 */
export function phaseLabelKey(phase: string): string {
  const valid = ['waiting', 'routing', 'responding', 'retrying'].includes(phase);
  return valid ? phase : 'unknown';
}

// === Polling decision helpers (pure, testable) ===

/**
 * Determine if list background polling should continue.
 * Active state filter is always live (respects hidden/detail/scroll only).
 * Non-active filters pause when searching or browsing history pages.
 */
export function shouldPollList(opts: {
  autoRefresh: boolean;
  visibilityHidden: boolean;
  querySettled: boolean;
  queryNonempty: boolean;
  pageNotFirst: boolean;
  hasDetail: boolean;
  scrolled: boolean;
  stateFilter: string;
}): boolean {
  if (!opts.autoRefresh) return false;
  if (opts.visibilityHidden) return false;
  if (opts.hasDetail) return false;
  if (opts.scrolled) return false;
  if (opts.stateFilter === 'active') return true;
  if (opts.queryNonempty) return false;
  if (opts.pageNotFirst) return false;
  if (!opts.querySettled) return false;
  return true;
}

/**
 * Determine if detail metadata polling should continue.
 * Only polls while the item is active or waiting for raw content.
 */
export function shouldPollDetailMetadata(opts: {
  autoRefresh: boolean;
  visibilityHidden: boolean;
  isActive: boolean;
  pendingRawContent: boolean;
}): boolean {
  if (!opts.autoRefresh) return false;
  if (opts.visibilityHidden) return false;
  return opts.isActive || opts.pendingRawContent;
}

/**
 * Determine if a one-shot full detail fetch is needed after terminal state.
 * Requires terminal state AND raw_log_id available AND not already fetched.
 */
export function needsFullDetailFetch(opts: {
  isTerminal: boolean;
  hasRawLogId: boolean;
  alreadyFetched: boolean;
}): boolean {
  return opts.isTerminal && opts.hasRawLogId && !opts.alreadyFetched;
}
