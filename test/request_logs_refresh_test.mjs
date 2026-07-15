import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRequestLogRefreshError,
  applyRequestLogRefreshSuccess,
  applyRequestLogSyncMetadata,
  createRequestLogRefreshCoordinator,
  createRequestLogRefreshState,
} from '../src/features/requestLogs/requestLogRefreshState.ts';

test('prevents overlapping request-log interval refreshes', () => {
  const coordinator = createRequestLogRefreshCoordinator();
  const first = coordinator.tryStart();
  const second = coordinator.tryStart();
  assert.equal(typeof first, 'number');
  assert.equal(second, null);
  coordinator.finish(first);
  assert.equal(typeof coordinator.tryStart(), 'number');
});

test('debounces request-log search to the latest query', () => {
  let nextId = 0;
  const scheduled = new Map();
  const scheduler = {
    setTimeout(callback) {
      nextId += 1;
      scheduled.set(nextId, callback);
      return nextId;
    },
    clearTimeout(id) {
      scheduled.delete(id);
    },
  };
  const emitted = [];
  const coordinator = createRequestLogRefreshCoordinator({ scheduler, searchDelayMs: 300 });
  coordinator.scheduleSearch('c', (value) => emitted.push(value));
  coordinator.scheduleSearch('cl', (value) => emitted.push(value));
  coordinator.scheduleSearch('claude', (value) => emitted.push(value));
  assert.equal(scheduled.size, 1);
  [...scheduled.values()][0]();
  assert.deepEqual(emitted, ['claude']);
});

test('preserves request-log rows on timeout', () => {
  const rows = [{ id: 'row-1' }];
  const state = createRequestLogRefreshState(rows, 1);
  const failed = applyRequestLogRefreshError(state, 'timeout');
  assert.equal(failed.items, rows);
  assert.equal(failed.total, 1);
  assert.equal(failed.error, 'timeout');
});

test('updates sync metadata independently from request-log row data', () => {
  const rows = [{ id: 'row-1' }];
  const state = createRequestLogRefreshState(rows, 1);
  const synced = applyRequestLogSyncMetadata(state, {
    syncing: true,
    last_synced_at: '2026-07-15T00:00:00Z',
    last_sync_error: 'scan delayed',
    retention_days: 0,
  });
  assert.equal(synced.items, rows);
  assert.equal(synced.syncing, true);
  assert.equal(synced.lastSyncedAt, '2026-07-15T00:00:00Z');
  assert.equal(synced.lastSyncError, 'scan delayed');
  assert.equal(synced.retentionDays, 0);

  const refreshed = applyRequestLogRefreshSuccess(synced, {
    items: [],
    total: 0,
    limit: 30,
    offset: 0,
    syncing: false,
    last_synced_at: '2026-07-15T00:00:05Z',
    retention_days: 7,
  });
  assert.equal(refreshed.items.length, 0);
  assert.equal(refreshed.syncing, false);
  assert.equal(refreshed.lastSyncedAt, '2026-07-15T00:00:05Z');
  assert.equal(refreshed.retentionDays, 7);
});
