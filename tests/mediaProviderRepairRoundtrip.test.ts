import { describe, expect, test } from 'bun:test';
import type { MediaProviderConfig } from '../src/types';
import {
  buildMediaProviderFormInput,
  buildMediaProviderConfig,
} from '../src/features/providers/mediaProviderForm';
import {
  normalizeMediaProviderPayload,
  serializeMediaProviderPayload,
} from '../src/services/api/mediaProviderContracts';
import { validateMediaProviderFormInput } from '../src/features/providers/mediaProviderFormValidation';

const provider = (): MediaProviderConfig => ({
  name: 'fixture',
  kind: 'audio',
  baseUrl: 'https://example.test',
  apiKeyEntries: [
    { apiKey: 'fixture-key', priority: 3, weight: 5, proxyUrl: 'direct', authIndex: 'fixture-id' },
  ],
  operations: [
    {
      name: 'speech',
      capability: 'speech',
      method: 'POST',
      path: '/tts',
      requestFormat: 'multipart',
      modelMode: 'none',
      responseFormat: 'binary',
      testRequest: { multipartFields: { text: 'Hello, world=friend', voice: 'fixture' } },
    },
  ],
});

describe('media provider repair round trip', () => {
  test('weight edits and explicit clears preserve priority and key identity', () => {
    const original = provider();
    const form = buildMediaProviderFormInput('audio', original);
    expect(form.apiKeyEntries![0].weight).toBe(5);
    form.apiKeyEntries![0].weight = 37;
    form.apiKeyEntries![0].priority = 12;
    const saved = serializeMediaProviderPayload(buildMediaProviderConfig('audio', form, original), {
      includeAuthIndexes: true,
    });
    expect(saved['api-key-entries']).toEqual([
      {
        'api-key': 'fixture-key',
        priority: 12,
        weight: 37,
        'proxy-url': 'direct',
        'auth-index': 'fixture-id',
      },
    ]);
    const normalized = normalizeMediaProviderPayload(saved)!;
    const cleared = buildMediaProviderFormInput('audio', normalized);
    cleared.apiKeyEntries![0].weight = undefined;
    const payload = serializeMediaProviderPayload(
      buildMediaProviderConfig('audio', cleared, normalized)
    );
    expect(payload['api-key-entries']).toEqual([
      { 'api-key': 'fixture-key', priority: 12, 'proxy-url': 'direct' },
    ]);
  });
  test('unchanged multipart text preserves commas and equals signs', () => {
    const original = provider();
    const saved = buildMediaProviderConfig(
      'audio',
      buildMediaProviderFormInput('audio', original),
      original
    );
    expect(saved.operations![0].testRequest).toEqual(original.operations![0].testRequest);
  });
  test('incompatible test template is caught before sending the save', () => {
    const form = buildMediaProviderFormInput('audio', provider());
    form.operations![0].testRequestJson = '{"text":"Hi"}';
    expect(validateMediaProviderFormInput(form, 'audio')?.code).toBe('operationTestFormatInvalid');
  });
  test('malformed test JSON is caught in the operation row', () => {
    const form = buildMediaProviderFormInput('audio', provider());
    Object.assign(form.operations![0], {
      requestFormat: 'json',
      testRequestJson: '{broken',
      testRequestMultipartFieldsText: '',
    });
    expect(validateMediaProviderFormInput(form, 'audio')).toEqual({
      code: 'operationTestJSONInvalid',
      operationIndex: 0,
    });
  });
});

test('an explicit media adapter is editable and clearable in the saved draft', () => {
  const original = { ...provider(), adapter: 'mimo-audio' as const };
  const form = buildMediaProviderFormInput('audio', original);
  expect(form.mediaAdapter).toBe('mimo-audio');
  form.mediaAdapter = 'passthrough';
  expect(
    serializeMediaProviderPayload(buildMediaProviderConfig('audio', form, original)).adapter
  ).toBe('passthrough');
  form.mediaAdapter = '';
  expect(
    serializeMediaProviderPayload(buildMediaProviderConfig('audio', form, original))
  ).not.toHaveProperty('adapter');
});
