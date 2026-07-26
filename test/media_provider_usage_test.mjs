import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateProviderUsageByApiKeys } from '../src/components/providers/providerUsageAggregation.ts';

test('aggregates usage for a media provider without an API key', () => {
  const usage = aggregateProviderUsageByApiKeys([''], (apiKey) => {
    assert.equal(apiKey, '');
    return {
      success: 2,
      failed: 1,
      recentRequests: [],
      successDetails: [],
      failureDetails: [],
    };
  });
  assert.deepEqual(usage.totalStats, { success: 2, failure: 1 });
});
