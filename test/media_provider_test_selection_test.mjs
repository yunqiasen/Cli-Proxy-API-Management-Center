import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampMediaTestOperationIndex,
  createMediaConnectivityResultGuard,
  createMediaConnectivityResultGuardMap,
  getDefaultMediaTestOperationIndex,
  getMediaGatewayPath,
  getMediaTestModelOptions,
  mediaConnectivityTestSignature,
  resolveMediaTestModels,
} from '../src/features/providers/mediaProviderTestSelection.ts';

const models = [
  { name: 'upstream-generate', alias: 'public-generate', capabilities: ['generate'] },
  { name: 'upstream-edit', alias: 'public-edit', capabilities: ['edit'] },
  { name: 'upstream-both', alias: '', capabilities: ['generate', 'edit'] },
];

const operation = (patch = {}) => ({
  name: 'generate',
  capability: 'generate',
  method: 'POST',
  path: '/images/generations',
  requestFormat: 'json',
  modelMode: 'required',
  model: '',
  responseFormat: 'passthrough',
  resultPath: '',
  testRequestJson: '',
  testRequestMultipartFieldsText: '',
  asyncEnabled: false,
  taskIdPath: '',
  pollMethod: 'GET',
  pollPath: '',
  statusPath: '',
  successValuesText: 'completed',
  failureValuesText: 'failed',
  asyncResultPath: '',
  pollInterval: '3s',
  ...patch,
});

test('defaults media testing to the primary operation instead of an arbitrary first row', () => {
  const operations = [
    operation({ name: 'remove-background', capability: 'remove-background' }),
    operation({ name: 'generate', capability: 'generate' }),
  ];
  assert.equal(getDefaultMediaTestOperationIndex(operations), 1);
});

test('filters selectable test models by the chosen operation capability', () => {
  const options = getMediaTestModelOptions(operation({ name: 'edit', capability: 'edit' }), models);
  assert.deepEqual(
    options.map((item) => item.name),
    ['upstream-edit', 'upstream-both']
  );
});

test('resolves raw upstream model and public CPA alias separately', () => {
  assert.deepEqual(resolveMediaTestModels(operation(), models, 'upstream-generate'), {
    upstreamModel: 'upstream-generate',
    gatewayModel: 'public-generate',
  });
  assert.deepEqual(resolveMediaTestModels(operation(), models, 'upstream-both'), {
    upstreamModel: 'upstream-both',
    gatewayModel: 'upstream-both',
  });
});

test('model-free operations do not invent a model', () => {
  assert.deepEqual(
    resolveMediaTestModels(operation({ modelMode: 'none' }), models, 'upstream-generate'),
    { upstreamModel: '', gatewayModel: '' }
  );
});

test('maps configured operations to stable CPA public routes', () => {
  assert.equal(getMediaGatewayPath('image', operation()), '/v1/images/generations');
  assert.equal(
    getMediaGatewayPath('image', operation({ name: 'edit', capability: 'edit' })),
    '/v1/images/edits'
  );
  assert.equal(
    getMediaGatewayPath('video', operation({ name: 'text-to-video', capability: 'text-to-video' })),
    '/v1/videos/text-to-video'
  );
  assert.equal(
    getMediaGatewayPath('audio', operation({ name: 'transcribe', capability: 'transcribe' })),
    '/v1/audio/transcriptions'
  );
  assert.equal(
    getMediaGatewayPath('audio', operation({ name: 'custom-audio', capability: '' })),
    '/v1/media/audio/custom-audio'
  );
});

test('fixed-model operations only expose their configured model', () => {
  const fixed = operation({
    name: 'voice-design',
    capability: 'speech',
    model: 'upstream-edit',
  });
  const options = getMediaTestModelOptions(fixed, [
    { name: 'upstream-generate', alias: 'public-generate', capabilities: ['speech'] },
    { name: 'upstream-edit', alias: 'public-edit', capabilities: ['speech'] },
  ]);
  assert.deepEqual(
    options.map((item) => item.name),
    ['upstream-edit']
  );
  assert.deepEqual(resolveMediaTestModels(fixed, options, 'upstream-generate'), {
    upstreamModel: 'upstream-edit',
    gatewayModel: 'public-edit',
  });
});

test('custom operation names keep their generic CPA route even when sharing a standard capability', () => {
  assert.equal(
    getMediaGatewayPath(
      'audio',
      operation({ name: 'voice-design', capability: 'speech', model: 'mimo-v2.5-tts-voicedesign' })
    ),
    '/v1/media/audio/voice-design'
  );
});

test('clamps a removed media test operation to an existing row', () => {
  assert.equal(clampMediaTestOperationIndex(2, 2), 1);
  assert.equal(clampMediaTestOperationIndex(1, 3), 1);
  assert.equal(clampMediaTestOperationIndex(0, 0), 0);
});

test('connectivity status signature changes with credential and request inputs', () => {
  const base = {
    baseUrl: 'https://media.example/v1',
    apiKeyHeader: 'Authorization',
    apiKeyPrefix: 'Bearer',
    headers: [{ key: 'X-Tenant', value: 'a' }],
    apiKeyEntries: [{ apiKey: 'key-a', existingApiKey: '', authIndex: '' }],
    operation: operation(),
    model: 'upstream-generate',
  };
  const original = mediaConnectivityTestSignature(base);
  assert.notEqual(
    mediaConnectivityTestSignature({
      ...base,
      apiKeyEntries: [{ apiKey: 'key-b', existingApiKey: '', authIndex: '' }],
    }),
    original
  );
  assert.notEqual(mediaConnectivityTestSignature({ ...base, model: 'upstream-both' }), original);
});

test('batch connectivity guard keeps concurrent key tests independent', () => {
  const guards = createMediaConnectivityResultGuardMap();
  const keyA = guards.guardFor('key-a');
  const keyB = guards.guardFor('key-b');
  const requestA = keyA.begin('same-form');
  const requestB = keyB.begin('same-form');

  assert.equal(keyA.isCurrent(requestA, 'same-form'), true);
  assert.equal(keyB.isCurrent(requestB, 'same-form'), true);
  keyA.invalidate();
  assert.equal(keyA.isCurrent(requestA, 'same-form'), false);
  assert.equal(keyB.isCurrent(requestB, 'same-form'), true);
});

test('connectivity result guards reject stale signatures and superseded requests', () => {
  const guard = createMediaConnectivityResultGuard();
  const first = guard.begin('signature-a');
  assert.equal(guard.isCurrent(first, 'signature-a'), true);
  assert.equal(guard.isCurrent(first, 'signature-b'), false);

  const second = guard.begin('signature-a');
  assert.equal(guard.isCurrent(first, 'signature-a'), false);
  assert.equal(guard.isCurrent(second, 'signature-a'), true);

  guard.invalidate();
  assert.equal(guard.isCurrent(second, 'signature-a'), false);
});
