import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseRequestLogRetentionDaysResponse,
  serializeRequestLogRetentionDays,
} from '../src/services/api/requestLogRetention.ts';

test('serializes request-log retention values without changing 0 or positive integers', () => {
  assert.deepEqual(serializeRequestLogRetentionDays(0), { value: 0 });
  assert.deepEqual(serializeRequestLogRetentionDays(7), { value: 7 });
  assert.deepEqual(serializeRequestLogRetentionDays(45), { value: 45 });
});

test('rejects negative and non-integer request-log retention values', () => {
  assert.throws(() => serializeRequestLogRetentionDays(-1), /non-negative integer/);
  assert.throws(() => serializeRequestLogRetentionDays(7.5), /non-negative integer/);
  assert.throws(() => serializeRequestLogRetentionDays('7'), /non-negative integer/);
});

test('parses the management retention response including permanent retention', () => {
  assert.equal(parseRequestLogRetentionDaysResponse({ 'request-log-retention-days': 0 }), 0);
  assert.equal(parseRequestLogRetentionDaysResponse({ 'request-log-retention-days': 30 }), 30);
  assert.throws(
    () => parseRequestLogRetentionDaysResponse({ 'request-log-retention-days': -2 }),
    /invalid request-log retention response/
  );
});
