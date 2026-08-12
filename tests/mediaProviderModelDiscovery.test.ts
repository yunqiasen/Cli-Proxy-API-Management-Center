import { afterEach, describe, expect, test } from 'bun:test';
import {
  MODEL_DISCOVERY_BRANDS,
  createModelDiscoveryRequestGuard,
} from '../src/features/providers/sheets/forms/useModelDiscovery';
import { mergeDiscoveredMediaModels } from '../src/features/providers/mediaProviderModelDiscovery';
import { normalizeModelIdentity } from '../src/utils/models';
import { apiCallApi } from '../src/services/api/apiCall';
import { modelsApi } from '../src/services/api/models';

const originalApiCallRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalApiCallRequest;
});

describe('media provider model discovery', () => {
  test('enables endpoint discovery for image, video, and audio providers', () => {
    expect(MODEL_DISCOVERY_BRANDS).toContain('image');
    expect(MODEL_DISCOVERY_BRANDS).toContain('video');
    expect(MODEL_DISCOVERY_BRANDS).toContain('audio');
  });

  test('invalidates stale model discovery requests after provider inputs change', () => {
    const guard = createModelDiscoveryRequestGuard();
    const signature = 'image||https://media.example/v1';
    const first = guard.begin(signature);
    expect(guard.isCurrent(first)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(first)).toBe(false);
    const second = guard.begin(signature);
    expect(guard.isCurrent(second)).toBe(true);
  });

  test('normalizes discovered model identity case-insensitively', () => {
    expect(normalizeModelIdentity('  Tongyi-MAI/Z-Image  ')).toBe('tongyi-mai/z-image');
    expect(normalizeModelIdentity('TONGYI-MAI/Z-IMAGE')).toBe('tongyi-mai/z-image');
  });

  test('fetches OpenAI-shaped models from baseUrl/models with the media credential contract', async () => {
    let requestPayload: Parameters<typeof apiCallApi.request>[0] | undefined;
    apiCallApi.request = (async (payload) => {
      requestPayload = payload;
      return {
        statusCode: 200,
        header: {},
        bodyText: '',
        body: {
          data: [
            { id: 'image-v2', display_name: 'Image V2' },
            { id: 'image-v2' },
            { id: 'image-edit-v1', capabilities: ['edit'] },
          ],
        },
      };
    }) as typeof apiCallApi.request;

    const models = await modelsApi.fetchMediaModelsViaApiCall(
      'https://media.example.com/v1',
      'media-secret',
      { 'X-Tenant': 'tenant-a' },
      undefined,
      'X-API-Key',
      '-'
    );

    expect(requestPayload).toEqual({
      method: 'GET',
      url: 'https://media.example.com/v1/models',
      header: {
        'X-Tenant': 'tenant-a',
        'X-API-Key': 'media-secret',
      },
    });
    expect(models).toEqual([
      { name: 'image-v2', displayName: 'Image V2' },
      { name: 'image-edit-v1', capabilities: ['edit'] },
    ]);
  });

  test('uses the saved auth index token in the configured header without replacing explicit headers', async () => {
    const requests: Array<Parameters<typeof apiCallApi.request>[0]> = [];
    apiCallApi.request = (async (payload) => {
      requests.push(payload);
      return { statusCode: 200, header: {}, bodyText: '', body: { data: [] } };
    }) as typeof apiCallApi.request;

    await modelsApi.fetchMediaModelsViaApiCall(
      'https://audio.example.com/v1',
      '',
      {},
      'media:audio:1',
      'X-API-Key',
      '-'
    );
    await modelsApi.fetchMediaModelsViaApiCall(
      'https://audio.example.com/v1',
      'ignored-secret',
      { 'x-api-key': 'explicit-secret' },
      undefined,
      'X-API-Key',
      '-'
    );

    expect(requests[0]).toEqual({
      authIndex: 'media:audio:1',
      method: 'GET',
      url: 'https://audio.example.com/v1/models',
      header: { 'X-API-Key': '$TOKEN$' },
    });
    expect(requests[1]?.header).toEqual({ 'x-api-key': 'explicit-secret' });
  });

  test('preserves duplicate existing rows while filtering duplicate discovered names', () => {
    const merged = mergeDiscoveredMediaModels(
      [
        { name: 'shared-upstream', alias: 'public-generate', capabilities: ['generate'] },
        { name: 'shared-upstream', alias: 'public-edit', capabilities: ['edit'] },
      ],
      [{ name: 'shared-upstream' }, { name: 'new-upstream' }]
    );

    expect(merged).toEqual([
      { name: 'shared-upstream', alias: 'public-generate', capabilities: ['generate'] },
      { name: 'shared-upstream', alias: 'public-edit', capabilities: ['edit'] },
      { name: 'new-upstream', alias: undefined, displayName: undefined, capabilities: [] },
    ]);
  });

  test('keeps existing aliases and capabilities when discovered models are appended', () => {
    const merged = mergeDiscoveredMediaModels(
      [
        {
          name: 'image-v2',
          alias: 'public-image',
          displayName: 'Production Image',
          capabilities: ['generate', 'edit'],
        },
      ],
      [
        { name: 'image-v2', alias: 'must-not-overwrite' },
        {
          name: 'image-upscale-v1',
          alias: 'Upscale',
          capabilities: ['upscale'],
          displayName: undefined,
        },
      ]
    );

    expect(merged).toEqual([
      {
        name: 'image-v2',
        alias: 'public-image',
        displayName: 'Production Image',
        capabilities: ['generate', 'edit'],
      },
      {
        name: 'image-upscale-v1',
        alias: 'Upscale',
        capabilities: ['upscale'],
        displayName: undefined,
      },
    ]);
  });
});
