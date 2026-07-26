import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_CAPABILITIES_BY_KIND,
  validateMediaProviderFormInput,
} from '../src/features/providers/mediaProviderFormValidation.ts';

const baseForm = (operation) => ({
  name: 'Image Relay',
  baseUrl: 'https://images.example/v1',
  models: [{ name: 'image-model', capabilities: ['generate'] }],
  operations: [operation],
});

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

test('exposes kind-specific operation capabilities', () => {
  assert.deepEqual(MEDIA_CAPABILITIES_BY_KIND.image, [
    'generate',
    'edit',
    'upscale',
    'super-resolution',
    'remove-background',
  ]);
  assert.equal(MEDIA_CAPABILITIES_BY_KIND.video.includes('image-to-video'), true);
  assert.equal(MEDIA_CAPABILITIES_BY_KIND.audio.includes('voice-convert'), true);
});

test('validates operation capability and required model against the selected media kind', () => {
  assert.deepEqual(
    validateMediaProviderFormInput(baseForm(operation({ capability: 'voice-convert' })), 'image'),
    { code: 'operationCapabilityInvalid', operationIndex: 0 }
  );
  assert.deepEqual(
    validateMediaProviderFormInput(
      { ...baseForm(operation({ capability: 'upscale' })), models: [] },
      'image'
    ),
    { code: 'operationModelRequired', operationIndex: 0 }
  );
});

test('validates normalized result paths and complete async polling fields', () => {
  assert.deepEqual(
    validateMediaProviderFormInput(
      baseForm(operation({ modelMode: 'optional', responseFormat: 'json-url' })),
      'image'
    ),
    { code: 'operationResultPathRequired', operationIndex: 0 }
  );
  assert.deepEqual(
    validateMediaProviderFormInput(
      baseForm(
        operation({
          modelMode: 'optional',
          responseFormat: 'json-url',
          asyncEnabled: true,
          taskIdPath: 'task_id',
          pollPath: '/tasks/{task_id}',
          statusPath: '',
          successValuesText: 'completed',
          asyncResultPath: 'output.url',
        })
      ),
      'image'
    ),
    { code: 'operationAsyncIncomplete', operationIndex: 0 }
  );
});

test('accepts model-free and fully configured async operations', () => {
  assert.equal(
    validateMediaProviderFormInput(
      baseForm(
        operation({
          name: 'remove-background',
          capability: 'remove-background',
          modelMode: 'none',
          model: 'ignored-fixed-model',
          responseFormat: 'json-url',
          asyncEnabled: true,
          taskIdPath: 'task_id',
          pollPath: '/tasks/{task_id}',
          statusPath: 'status',
          successValuesText: 'completed',
          asyncResultPath: 'output.url',
        })
      ),
      'image'
    ),
    null
  );
});
