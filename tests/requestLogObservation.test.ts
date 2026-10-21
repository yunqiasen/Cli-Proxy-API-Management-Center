import { describe, expect, test } from 'bun:test';
import {
  buildExportParams,
  deriveItemState,
  errorKindLabelKey,
  filterByState,
  hasActiveItems,
  isActiveState,
  isTerminalState,
  mergeMetadataIntoDetail,
  mergeObservationItems,
  needsFullDetailFetch,
  phaseLabelKey,
  resolvePollInterval,
  shouldPollDetailMetadata,
  shouldPollList,
  sortAttempts,
  stateLabelKey,
} from '../src/features/requestLogs/requestLogObservation';
import type {
  RequestLogItem,
  RequestLogAttempt,
  RequestLogDetail,
  RequestLogMetadataDetail,
} from '../src/services/api';

const mkItem = (over: Partial<RequestLogItem> = {}): RequestLogItem => ({
  id: 'r1',
  timestamp: '2026-01-01T00:00:00Z',
  url: '/v1/chat/completions',
  method: 'POST',
  model: 'gpt-4',
  ...over,
});

describe('deriveItemState', () => {
  test('uses explicit state when present', () => {
    expect(deriveItemState(mkItem({ state: 'succeeded' }))).toBe('succeeded');
    expect(deriveItemState(mkItem({ state: 'failed' }))).toBe('failed');
    expect(deriveItemState(mkItem({ state: 'canceled' }))).toBe('canceled');
  });

  test('derives recovered from flag when state absent', () => {
    expect(deriveItemState(mkItem({ recovered: true }))).toBe('recovered');
  });

  test('derives succeeded/failed from success boolean for legacy rows', () => {
    expect(deriveItemState(mkItem({ success: true }))).toBe('succeeded');
    expect(deriveItemState(mkItem({ success: false }))).toBe('failed');
  });

  test('falls back to unknown (not active) when no data', () => {
    expect(deriveItemState(mkItem())).toBe('unknown');
  });

  test('state takes priority over recovered and success', () => {
    expect(deriveItemState(mkItem({ state: 'interrupted', recovered: true, success: true }))).toBe(
      'interrupted'
    );
  });
});

describe('isActiveState / isTerminalState', () => {
  test('active is active, not terminal', () => {
    expect(isActiveState('active')).toBe(true);
    expect(isTerminalState('active')).toBe(false);
  });

  test('succeeded/failed/canceled/interrupted/recovered are terminal', () => {
    for (const s of ['succeeded', 'failed', 'canceled', 'interrupted', 'recovered']) {
      expect(isTerminalState(s)).toBe(true);
      expect(isActiveState(s)).toBe(false);
    }
  });
});

describe('mergeObservationItems', () => {
  test('merges by ID preserving prev preview fields absent in polled snapshot', () => {
    const prev = [
      mkItem({ id: 'a', prompt_preview: 'prev prompt', state: 'active' }),
      mkItem({ id: 'b', prompt_preview: 'prev b', state: 'active' }),
    ];
    const next = [
      mkItem({ id: 'a', state: 'succeeded', recovered: true }),
      mkItem({ id: 'c', state: 'active' }),
    ];
    const merged = mergeObservationItems(prev, next);
    expect(merged).toHaveLength(2);
    expect(merged[0].state).toBe('succeeded');
    expect(merged[0].recovered).toBe(true);
    expect(merged[0].prompt_preview).toBe('prev prompt');
    expect(merged[1].id).toBe('c');
  });

  test('next fields override existing prev fields', () => {
    const prev = [mkItem({ id: 'a', model: 'old-model', state: 'active' })];
    const next = [mkItem({ id: 'a', model: 'new-model', state: 'succeeded' })];
    const merged = mergeObservationItems(prev, next);
    expect(merged[0].model).toBe('new-model');
    expect(merged[0].state).toBe('succeeded');
  });

  test('a completed snapshot clears transient phase and error classification', () => {
    const previous = [mkItem({ state: 'active', phase: 'retrying', error_kind: 'compatibility' })];
    const next = [mkItem({ state: 'succeeded', success: true, recovered: true })];
    const [result] = mergeObservationItems(previous, next);
    expect(result.phase).toBeUndefined();
    expect(result.error_kind).toBeUndefined();
    expect(result.recovered).toBe(true);
  });

  test('empty prev returns next as-is', () => {
    const next = [mkItem({ id: 'x', state: 'active' })];
    expect(mergeObservationItems([], next)).toEqual(next);
  });

  test('empty next returns empty', () => {
    const prev = [mkItem({ id: 'x', state: 'active' })];
    expect(mergeObservationItems(prev, [])).toEqual([]);
  });
});

describe('mergeMetadataIntoDetail', () => {
  const baseDetail: RequestLogDetail = {
    id: 'obs-1',
    state: 'active',
    phase: 'routing',
    prompt: 'full prompt body',
    output: 'full output body',
    attempts: [{ index: 1, state: 'active' }],
    trace_id: 'trace-1',
  };

  test('merges metadata without replacing full bodies', () => {
    const meta: RequestLogMetadataDetail = {
      id: 'obs-1',
      state: 'succeeded',
      phase: '',
      recovered: true,
      raw_log_id: 'raw-123',
      attempts: [
        { index: 1, state: 'succeeded', auth_id: 'key-a' },
        { index: 2, state: 'retried', auth_id: 'key-a' },
      ],
      attempt_count: 2,
    };
    const result = mergeMetadataIntoDetail(baseDetail, meta);
    expect(result.prompt).toBe('full prompt body');
    expect(result.output).toBe('full output body');
    expect(result.state).toBe('succeeded');
    expect(result.raw_log_id).toBe('raw-123');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.[1].auth_id).toBe('key-a');
  });

  test('does not clear existing full detail fields when meta field is absent', () => {
    const meta: RequestLogMetadataDetail = { id: 'obs-1', state: 'failed' };
    const result = mergeMetadataIntoDetail(baseDetail, meta);
    expect(result.prompt).toBe('full prompt body');
    expect(result.trace_id).toBe('trace-1');
  });
});

describe('filterByState', () => {
  const items = [
    mkItem({ id: 'a', state: 'active' }),
    mkItem({ id: 'b', state: 'succeeded' }),
    mkItem({ id: 'c', state: 'failed' }),
    mkItem({ id: 'd', recovered: true }),
    mkItem({ id: 'e' }), // legacy no data → unknown
  ];

  test('all returns all items', () => {
    expect(filterByState(items, 'all')).toHaveLength(5);
  });

  test('active filter only matches explicitly active', () => {
    expect(filterByState(items, 'active').map((i) => i.id)).toEqual(['a']);
  });

  test('succeeded filter', () => {
    expect(filterByState(items, 'succeeded').map((i) => i.id)).toEqual(['b']);
  });

  test('recovered filter uses recovered flag', () => {
    expect(filterByState(items, 'recovered').map((i) => i.id)).toEqual(['d']);
  });
});

describe('buildExportParams', () => {
  test('always includes view=routes', () => {
    expect(buildExportParams({}).view).toBe('routes');
  });

  test('preserves state/query/page/format', () => {
    const params = buildExportParams({
      q: 'gpt',
      state: 'active',
      limit: 30,
      offset: 0,
      pages: 2,
      format: 'csv',
    });
    expect(params.state).toBe('active');
    expect(params.q).toBe('gpt');
  });

  test('all state becomes undefined', () => {
    expect(buildExportParams({ state: 'all' }).state).toBeUndefined();
  });
});

describe('sortAttempts', () => {
  const mkAttempt = (over: Partial<RequestLogAttempt> = {}): RequestLogAttempt => ({
    index: 0,
    state: 'succeeded',
    ...over,
  });

  test('sorts by index ascending', () => {
    const sorted = sortAttempts([
      mkAttempt({ index: 3 }),
      mkAttempt({ index: 1 }),
      mkAttempt({ index: 2 }),
    ]);
    expect(sorted.map((a) => a.index)).toEqual([1, 2, 3]);
  });

  test('same auth_id different index shows key switch vs same-key retry', () => {
    const sorted = sortAttempts([
      mkAttempt({ index: 2, auth_id: 'key1', state: 'retried' }),
      mkAttempt({ index: 3, auth_id: 'key2', state: 'succeeded' }),
      mkAttempt({ index: 1, auth_id: 'key1', state: 'failed' }),
    ]);
    expect(sorted[0].auth_id).toBe('key1');
    expect(sorted[1].auth_id).toBe('key1');
    expect(sorted[1].state).toBe('retried');
    expect(sorted[2].auth_id).toBe('key2');
  });
});

describe('hasActiveItems / resolvePollInterval', () => {
  test('detects active items', () => {
    expect(hasActiveItems([mkItem({ state: 'succeeded' })])).toBe(false);
    expect(hasActiveItems([mkItem({ state: 'active' })])).toBe(true);
    expect(hasActiveItems([mkItem()])).toBe(false);
  });

  test('active state filter forces fast poll', () => {
    expect(resolvePollInterval('active', [])).toBe(1500);
  });

  test('no active items uses base interval', () => {
    expect(resolvePollInterval('all', [mkItem({ state: 'succeeded' })])).toBe(5000);
  });
});

describe('label key helpers', () => {
  test('stateLabelKey accepts retried attempt state', () => {
    expect(stateLabelKey('retried')).toBe('retried');
  });

  test('stateLabelKey returns unknown for invalid', () => {
    expect(stateLabelKey('nonsense')).toBe('unknown');
  });

  test('errorKindLabelKey returns valid kinds', () => {
    expect(errorKindLabelKey('authentication')).toBe('authentication');
    expect(errorKindLabelKey('nonsense')).toBe('unknown');
  });

  test('phaseLabelKey returns valid phases', () => {
    expect(phaseLabelKey('routing')).toBe('routing');
    expect(phaseLabelKey('nonsense')).toBe('unknown');
  });
});

describe('shouldPollList', () => {
  const base = {
    autoRefresh: true,
    visibilityHidden: false,
    querySettled: true,
    queryNonempty: false,
    pageNotFirst: false,
    hasDetail: false,
    scrolled: false,
    stateFilter: 'all',
  };

  test('polls on active filter even when page > 1', () => {
    expect(shouldPollList({ ...base, stateFilter: 'active', pageNotFirst: true })).toBe(true);
  });

  test('active filter polls even with nonempty search', () => {
    expect(shouldPollList({ ...base, stateFilter: 'active', queryNonempty: true })).toBe(true);
  });

  test('nonempty settled query pauses polling on non-active filter', () => {
    expect(shouldPollList({ ...base, queryNonempty: true })).toBe(false);
  });

  test('page > 1 pauses polling on non-active filter', () => {
    expect(shouldPollList({ ...base, pageNotFirst: true })).toBe(false);
  });

  test('detail open pauses polling', () => {
    expect(shouldPollList({ ...base, hasDetail: true })).toBe(false);
  });

  test('scrolled pauses polling', () => {
    expect(shouldPollList({ ...base, scrolled: true })).toBe(false);
  });

  test('hidden pauses polling', () => {
    expect(shouldPollList({ ...base, visibilityHidden: true })).toBe(false);
  });

  test('autoRefresh off stops polling', () => {
    expect(shouldPollList({ ...base, autoRefresh: false })).toBe(false);
  });

  test('unsettled query pauses polling', () => {
    expect(shouldPollList({ ...base, querySettled: false })).toBe(false);
  });
});

describe('shouldPollDetailMetadata', () => {
  test('polls when active', () => {
    expect(
      shouldPollDetailMetadata({
        autoRefresh: true,
        visibilityHidden: false,
        isActive: true,
        pendingRawContent: false,
      })
    ).toBe(true);
  });

  test('polls when raw content is pending but not active', () => {
    expect(
      shouldPollDetailMetadata({
        autoRefresh: true,
        visibilityHidden: false,
        isActive: false,
        pendingRawContent: true,
      })
    ).toBe(true);
  });

  test('stops for terminal with no pending content', () => {
    expect(
      shouldPollDetailMetadata({
        autoRefresh: true,
        visibilityHidden: false,
        isActive: false,
        pendingRawContent: false,
      })
    ).toBe(false);
  });

  test('stops when hidden', () => {
    expect(
      shouldPollDetailMetadata({
        autoRefresh: true,
        visibilityHidden: true,
        isActive: true,
        pendingRawContent: false,
      })
    ).toBe(false);
  });

  test('stops when autoRefresh off', () => {
    expect(
      shouldPollDetailMetadata({
        autoRefresh: false,
        visibilityHidden: false,
        isActive: true,
        pendingRawContent: false,
      })
    ).toBe(false);
  });
});

describe('needsFullDetailFetch', () => {
  test('fetches once when terminal and raw_log_id available', () => {
    expect(
      needsFullDetailFetch({ isTerminal: true, hasRawLogId: true, alreadyFetched: false })
    ).toBe(true);
  });

  test('does not re-fetch after already fetched', () => {
    expect(
      needsFullDetailFetch({ isTerminal: true, hasRawLogId: true, alreadyFetched: true })
    ).toBe(false);
  });

  test('does not fetch without raw_log_id', () => {
    expect(
      needsFullDetailFetch({ isTerminal: true, hasRawLogId: false, alreadyFetched: false })
    ).toBe(false);
  });

  test('does not fetch while active', () => {
    expect(
      needsFullDetailFetch({ isTerminal: false, hasRawLogId: true, alreadyFetched: false })
    ).toBe(false);
  });
});

describe('metadata completion reconciliation', () => {
  test('updates the current route and clears transient failure fields without replacing bodies', () => {
    const original: RequestLogDetail = {
      id: 'call',
      state: 'active',
      phase: 'retrying',
      error_kind: 'compatibility',
      provider: 'first-site',
      auth_id: 'key-1',
      model: 'alias',
      upstream_model: 'first-model',
      prompt: 'keep prompt',
      output: 'keep output',
    };
    const result = mergeMetadataIntoDetail(original, {
      id: 'call',
      state: 'succeeded',
      recovered: true,
      success: true,
      has_error: false,
      provider: 'second-site',
      auth_id: 'key-2',
      upstream_model: 'second-model',
    });
    expect(result.provider).toBe('second-site');
    expect(result.upstream_model).toBe('second-model');
    expect(result.phase).toBeUndefined();
    expect(result.error_kind).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.has_error).toBe(false);
    expect(result.prompt).toBe('keep prompt');
    expect(result.output).toBe('keep output');
  });

  test('a late different-request snapshot leaves the selected detail unchanged', () => {
    const original = { id: 'selected', state: 'active', prompt: 'readable' };
    expect(mergeMetadataIntoDetail(original, { id: 'stale', state: 'failed' })).toBe(original);
  });
});
