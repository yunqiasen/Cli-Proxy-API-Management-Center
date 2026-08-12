import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROVIDER_RECENT_REQUESTS_STALE_TIME_MS,
  beginProviderRecentRequestsLoad,
  createInFlightRequestDeduper,
  createProviderRecentRequestsCacheState,
  failProviderRecentRequestsLoad,
  isProviderRecentRequestsCacheFresh,
  resolveProviderRecentRequestsLoad,
  runProviderRecentRequestsLoad,
  waitForProviderRecentRequestsReady,
} from '../src/components/providers/hooks/providerRecentRequestsCache.ts';
import { configReloadPendingFromHeaders } from '../src/services/api/apiKeyUsageHeaders.ts';

test('distinguishes initial loading from a loaded empty result', () => {
  const initial = createProviderRecentRequestsCacheState(new Map());
  const started = beginProviderRecentRequestsLoad(initial);
  assert.equal(started.state.hasLoaded, false);
  assert.equal(started.state.isLoading, true);

  const loaded = resolveProviderRecentRequestsLoad(
    started.state,
    started.requestId,
    new Map(),
    100
  );
  assert.equal(loaded.hasLoaded, true);
  assert.equal(loaded.isLoading, false);
  assert.equal(loaded.data.size, 0);
});

test('deduplicates concurrent provider usage requests', async () => {
  const deduper = createInFlightRequestDeduper();
  let calls = 0;
  let resolveRequest;
  const factory = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  };

  const first = deduper.run(factory);
  const second = deduper.run(factory);
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveRequest('done');
  assert.equal(await first, 'done');
});

test('failed refresh preserves prior data while a successful empty refresh clears it', () => {
  const previous = new Map([['claude', new Map([['key', { success: 2 }]])]]);
  const initial = createProviderRecentRequestsCacheState(previous, 10, true);
  const failedStart = beginProviderRecentRequestsLoad(initial);
  const failed = failProviderRecentRequestsLoad(
    failedStart.state,
    failedStart.requestId,
    'timeout'
  );
  assert.equal(failed.data, previous);
  assert.equal(failed.hasLoaded, true);
  assert.equal(failed.error, 'timeout');

  const successStart = beginProviderRecentRequestsLoad(failed);
  const cleared = resolveProviderRecentRequestsLoad(
    successStart.state,
    successStart.requestId,
    new Map(),
    200
  );
  assert.equal(cleared.data.size, 0);
  assert.equal(cleared.error, null);
});

test('ignores an older failure after a newer provider usage success', () => {
  const first = beginProviderRecentRequestsLoad(createProviderRecentRequestsCacheState(new Map()));
  const second = beginProviderRecentRequestsLoad(first.state);
  const freshData = new Map([['codex', new Map()]]);
  const succeeded = resolveProviderRecentRequestsLoad(
    second.state,
    second.requestId,
    freshData,
    300
  );
  const staleFailure = failProviderRecentRequestsLoad(succeeded, first.requestId, 'old failure');
  assert.equal(staleFailure.data, freshData);
  assert.equal(staleFailure.error, null);
});

test('uses a provider usage stale window shorter than 240 seconds', () => {
  assert.ok(PROVIDER_RECENT_REQUESTS_STALE_TIME_MS < 240_000);
  assert.equal(isProviderRecentRequestsCacheFresh(1_000, 1_000), true);
  assert.equal(
    isProviderRecentRequestsCacheFresh(1_000, 1_000 + PROVIDER_RECENT_REQUESTS_STALE_TIME_MS),
    false
  );
});

import { completeProviderMutation } from '../src/features/providers/providerMutationLifecycle.ts';

test('completes a provider mutation only after usage refresh settles', async () => {
  const events = [];
  await completeProviderMutation(
    async () => {
      events.push('refresh-start');
      await Promise.resolve();
      events.push('refresh-end');
    },
    () => events.push('complete')
  );
  assert.deepEqual(events, ['refresh-start', 'refresh-end', 'complete']);
});

test('does not block a successful provider mutation when usage refresh fails', async () => {
  let completed = false;
  await completeProviderMutation(
    async () => {
      throw new Error('usage endpoint unavailable');
    },
    () => {
      completed = true;
    }
  );
  assert.equal(completed, true);
});

test('waits for the runtime config reload before accepting provider usage', async () => {
  const snapshots = [
    { data: 'old-name', configReloadPending: true },
    { data: 'old-name', configReloadPending: true },
    { data: 'new-name', configReloadPending: false },
  ];
  let calls = 0;
  let now = 0;
  const result = await waitForProviderRecentRequestsReady(
    async () => snapshots[calls++],
    {
      timeoutMs: 100,
      pollIntervalMs: 10,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    }
  );
  assert.equal(result, 'new-name');
  assert.equal(calls, 3);
});

test('rejects a provider usage refresh when config reload stays pending', async () => {
  let now = 0;
  await assert.rejects(
    waitForProviderRecentRequestsReady(
      async () => ({ data: 'stale', configReloadPending: true }),
      {
        timeoutMs: 20,
        pollIntervalMs: 10,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      }
    ),
    /config reload/i
  );
});

test('reads the config reload pending response header case-insensitively', () => {
  assert.equal(configReloadPendingFromHeaders({ 'x-config-reload-pending': 'true' }), true);
  assert.equal(configReloadPendingFromHeaders({ 'X-Config-Reload-Pending': 'false' }), false);
  assert.equal(
    configReloadPendingFromHeaders({ get: (name) => (name === 'X-Config-Reload-Pending' ? 'true' : null) }),
    true
  );
});


test('non-force provider usage loads share one in-flight request', async () => {
  const cache = {
    state: createProviderRecentRequestsCacheState('initial'),
    inFlightRequest: null,
  };
  let calls = 0;
  let resolveRequest;
  const factory = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  };
  const first = runProviderRecentRequestsLoad(cache, factory);
  const second = runProviderRecentRequestsLoad(cache, factory);
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveRequest('loaded');
  assert.equal(await first, 'loaded');
  assert.equal(cache.state.data, 'loaded');
});

test('force provider usage refresh starts a new generation and ignores the older result', async () => {
  const cache = {
    state: createProviderRecentRequestsCacheState('initial'),
    inFlightRequest: null,
  };
  const resolvers = [];
  const factory = () => new Promise((resolve) => resolvers.push(resolve));

  const first = runProviderRecentRequestsLoad(cache, factory);
  const second = runProviderRecentRequestsLoad(cache, factory, { force: true });
  assert.notEqual(first, second);
  assert.equal(resolvers.length, 2);

  resolvers[1]('new');
  assert.equal(await second, 'new');
  resolvers[0]('old');
  await first;
  assert.equal(cache.state.data, 'new');
  assert.equal(cache.state.error, null);
});
