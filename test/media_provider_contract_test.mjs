import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeMediaProviderPayload,
  serializeMediaProviderPayload,
} from '../src/services/api/mediaProviderContracts.ts';

const rawProvider = {
  name: ' Image Relay ',
  kind: 'image',
  'base-url': 'https://images.example/v1',
  priority: 7,
  disabled: false,
  'disable-cooling': true,
  prefix: 'media',
  'api-key-entries': [
    { 'api-key': ' key-a ', priority: 0, 'auth-index': 'auth-a' },
    { 'api-key': 'key-b', priority: 20, 'proxy-url': 'http://proxy.example' },
  ],
  headers: { 'X-Relay': 'image' },
  models: [
    {
      name: 'upstream-image',
      alias: 'public-image',
      'display-name': 'Public Image',
      'force-mapping': true,
      capabilities: ['generate', 'edit'],
    },
  ],
  operations: [
    {
      name: 'remove-background',
      capability: 'remove-background',
      method: 'POST',
      path: '/remove',
      'request-format': 'json',
      'model-mode': 'none',
      'response-format': 'json-url',
      'result-path': 'output.url',
      async: {
        'task-id-path': 'task_id',
        'poll-method': 'GET',
        'poll-path': '/tasks/{task_id}',
        'status-path': 'status',
        'success-values': ['completed'],
        'failure-values': ['failed'],
        'result-path': 'output.url',
        'poll-interval': '2s',
      },
    },
  ],
  'auth-index': 'provider-auth',
};

test('normalizes media provider payload including keys, models, operations, and async polling', () => {
  const normalized = normalizeMediaProviderPayload(rawProvider, 3);
  assert.ok(normalized);
  assert.equal(normalized.name, 'Image Relay');
  assert.equal(normalized.sourceIndex, 3);
  assert.equal(normalized.apiKeyEntries[0].priority, 0);
  assert.equal(normalized.apiKeyEntries[0].authIndex, 'auth-a');
  assert.equal(normalized.models?.[0].displayName, 'Public Image');
  assert.deepEqual(normalized.models?.[0].capabilities, ['generate', 'edit']);
  assert.equal(normalized.operations?.[0].modelMode, 'none');
  assert.equal(normalized.operations?.[0].async?.pollInterval, '2s');
});

test('serializes exact backend kebab-case contract and strips response-only auth indexes', () => {
  const normalized = normalizeMediaProviderPayload(rawProvider, 3);
  assert.ok(normalized);
  const serialized = serializeMediaProviderPayload(normalized);
  assert.deepEqual(serialized, {
    name: 'Image Relay',
    kind: 'image',
    'base-url': 'https://images.example/v1',
    'api-key-entries': [
      { 'api-key': 'key-a', priority: 0 },
      { 'api-key': 'key-b', priority: 20, 'proxy-url': 'http://proxy.example' },
    ],
    priority: 7,
    disabled: false,
    'disable-cooling': true,
    prefix: 'media',
    headers: { 'X-Relay': 'image' },
    models: [
      {
        name: 'upstream-image',
        alias: 'public-image',
        'display-name': 'Public Image',
        'force-mapping': true,
        capabilities: ['generate', 'edit'],
      },
    ],
    operations: [rawProvider.operations[0]],
  });
  assert.equal('auth-index' in serialized, false);
});

test('accepts model-free providers and rejects malformed media kinds and operations', () => {
  const noKey = normalizeMediaProviderPayload({
    name: 'Free Audio',
    kind: 'audio',
    'base-url': 'https://audio.example',
    'api-key-entries': [],
    operations: [
      {
        name: 'speech',
        method: 'POST',
        path: '/speech',
        'request-format': 'json',
        'model-mode': 'none',
        'response-format': 'binary',
      },
    ],
  });
  assert.ok(noKey);
  assert.deepEqual(noKey.apiKeyEntries, []);
  assert.equal(normalizeMediaProviderPayload({ ...rawProvider, kind: 'text' }), null);
  assert.deepEqual(
    normalizeMediaProviderPayload({ ...rawProvider, operations: [{ name: 'bad' }] })?.operations,
    []
  );
});

test('preserves unknown provider extensions while rewriting known fields', () => {
  const normalized = normalizeMediaProviderPayload({
    name: 'Relay',
    kind: 'video',
    'base-url': 'https://video.example',
    'vendor-mode': 'queue',
    'api-key-entries': [{ 'api-key': 'key', 'vendor-key-id': 'k1' }],
    models: [{ name: 'video-model', capabilities: ['text-to-video'], 'vendor-model': true }],
    operations: [
      {
        name: 'generate',
        method: 'post',
        path: 'generate',
        'request-format': 'json',
        'model-mode': 'optional',
        'response-format': 'passthrough',
        'vendor-operation': { queue: true },
        async: {
          'task-id-path': 'id',
          'poll-path': 'tasks/{task_id}',
          'status-path': 'status',
          'success-values': ['done'],
          'vendor-async': 'kept',
        },
      },
    ],
  });
  assert.ok(normalized);
  const serialized = serializeMediaProviderPayload(normalized);
  assert.equal(serialized['vendor-mode'], 'queue');
  assert.equal(serialized['api-key-entries'][0]['vendor-key-id'], 'k1');
  assert.equal(serialized.models[0]['vendor-model'], true);
  assert.deepEqual(serialized.operations[0]['vendor-operation'], { queue: true });
  assert.equal(serialized.operations[0].async['vendor-async'], 'kept');
});

test('drops duplicate media keys and operations without changing list order', () => {
  const normalized = normalizeMediaProviderPayload({
    name: 'Relay',
    kind: 'image',
    'base-url': 'https://images.example',
    'api-key-entries': [{ 'api-key': 'same' }, { 'api-key': 'same' }, { 'api-key': 'other' }],
    operations: [
      {
        name: 'EDIT',
        method: 'POST',
        path: '/edit',
        'request-format': 'json',
        'model-mode': 'optional',
        'response-format': 'passthrough',
      },
      {
        name: 'edit',
        method: 'POST',
        path: '/other',
        'request-format': 'json',
        'model-mode': 'optional',
        'response-format': 'passthrough',
      },
    ],
  });
  assert.ok(normalized);
  assert.deepEqual(
    normalized.apiKeyEntries.map((entry) => entry.apiKey),
    ['same', 'other']
  );
  assert.deepEqual(
    normalized.operations.map((operation) => operation.path),
    ['/edit']
  );
});

test('round-trips media auth indexes for edit mutations', () => {
  const normalized = normalizeMediaProviderPayload(rawProvider, 3);
  assert.ok(normalized);
  const serialized = serializeMediaProviderPayload(normalized, { includeAuthIndexes: true });
  assert.equal(serialized['auth-index'], 'provider-auth');
  assert.equal(serialized['api-key-entries'][0]['auth-index'], 'auth-a');
});

test('round-trips the top-level auth index for a provider without keys', () => {
  const normalized = normalizeMediaProviderPayload({
    name: 'Public Audio',
    kind: 'audio',
    'base-url': 'https://audio.example/v1',
    'api-key-entries': [],
    'auth-index': 'public-auth-index',
  });
  assert.ok(normalized);
  const serialized = serializeMediaProviderPayload(normalized, { includeAuthIndexes: true });
  assert.equal(serialized['auth-index'], 'public-auth-index');
  assert.deepEqual(serialized['api-key-entries'], []);
});

test('clears a fixed model when model mode is none', () => {
  const normalized = normalizeMediaProviderPayload({
    name: 'Image Tools',
    kind: 'image',
    'base-url': 'https://images.example/v1',
    operations: [
      {
        name: 'remove-background',
        capability: 'remove-background',
        method: 'POST',
        path: '/remove-background',
        'request-format': 'json',
        'model-mode': 'none',
        model: 'must-not-survive',
        'response-format': 'passthrough',
      },
    ],
  });
  assert.ok(normalized);
  assert.equal(normalized.operations?.[0].model, undefined);
  const serialized = serializeMediaProviderPayload(normalized);
  assert.equal('model' in serialized.operations[0], false);
});

test('drops operations with incomplete normalization or async contracts', () => {
  const baseOperation = {
    name: 'upscale',
    capability: 'upscale',
    method: 'POST',
    path: '/upscale',
    'request-format': 'json',
    'model-mode': 'optional',
    'response-format': 'json-url',
  };
  const normalized = normalizeMediaProviderPayload({
    name: 'Image Tools',
    kind: 'image',
    'base-url': 'https://images.example/v1',
    operations: [
      baseOperation,
      {
        ...baseOperation,
        name: 'async-upscale',
        'result-path': 'output.url',
        async: {
          'task-id-path': 'task_id',
          'poll-path': '/tasks/{task_id}',
          'status-path': '',
          'success-values': ['completed'],
        },
      },
    ],
  });
  assert.ok(normalized);
  assert.deepEqual(normalized.operations, []);
});
