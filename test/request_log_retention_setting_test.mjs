import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseRequestLogRetentionDaysResponse,
  saveRequestLogSettings,
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

test('waits for all writes and applies server truth before reporting a partial save failure', async () => {
  const events = [];
  const retentionError = new Error('retention update failed');
  let finishRequestLogWrite;
  const requestLogWrite = new Promise((resolve) => {
    finishRequestLogWrite = () => {
      events.push('request-log:done');
      resolve();
    };
  });
  let appliedSettings;

  const savePromise = saveRequestLogSettings(
    { enabled: false, retentionDays: 7 },
    { enabled: true, retentionDays: 30 },
    {
      updateRequestLog: () => {
        events.push('request-log:start');
        return requestLogWrite;
      },
      updateRequestLogRetentionDays: async () => {
        events.push('retention:start');
        throw retentionError;
      },
      readServerSettings: async () => {
        events.push('read');
        return { enabled: true, retentionDays: 7 };
      },
      applyServerSettings: (settings) => {
        events.push('apply');
        appliedSettings = settings;
      },
    }
  );
  const rejected = assert.rejects(savePromise, (error) => error === retentionError);

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['request-log:start', 'retention:start']);

  finishRequestLogWrite();
  await rejected;
  assert.deepEqual(events, [
    'request-log:start',
    'retention:start',
    'request-log:done',
    'read',
    'apply',
  ]);
  assert.deepEqual(appliedSettings, { enabled: true, retentionDays: 7 });
});
