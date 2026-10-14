import { describe, expect, test } from 'bun:test';
import * as probe from '../src/services/api/providerConnectivityRequest';
import {
  buildMediaProviderFormInput,
  buildMediaProviderConfig,
} from '../src/features/providers/mediaProviderForm';
import { serializeMediaProviderPayload } from '../src/services/api/mediaProviderContracts';
import {
  requestMediaGatewayConnectivity,
  buildMediaConnectivityRequest,
  buildMediaGatewayConnectivityRequest,
} from '../src/services/api/mediaProviderConnectivity';
import type { MediaProviderConfig } from '../src/types';

const cfg: MediaProviderConfig = {
  name: 'fixture',
  kind: 'image',
  baseUrl: 'https://example.test/api/v2?base=one',
  prefix: 'vendor',
  apiKeyEntries: [
    { apiKey: 'first', proxyUrl: 'direct', authIndex: 'id-1' },
    { apiKey: 'never-send' },
  ],
  models: [{ name: 'raw', alias: 'public', capabilities: ['generate'] }],
  operations: [
    {
      name: 'generate',
      method: 'POST',
      path: '/api/v2/run?op=two',
      requestFormat: 'json',
      modelMode: 'required',
      responseFormat: 'json-url',
      resultPath: 'result.image',
    },
  ],
};

describe('media probe uses the native execution contract', () => {
  test('serializes the saved draft without credential pools and includes explicit proxy clears', () => {
    const form = buildMediaProviderFormInput('image', cfg);
    form.apiKeyEntries![0].proxyUrl = 'http://draft-proxy.test:8000';
    const draft = buildMediaProviderConfig('image', form, cfg);
    const input = {
      providerConfig: draft,
      operation: 'generate',
      model: 'vendor/public',
      apiKey: 'first',
      authIndex: 'id-1',
      proxyUrl: form.apiKeyEntries![0].proxyUrl,
    };
    const payload = probe.buildMediaProviderConnectivityPayload(input);
    const saved = serializeMediaProviderPayload(draft);
    delete saved['api-key-entries'];
    delete saved['auth-index'];
    expect(payload.media_config).toEqual(saved);
    expect(payload.proxy_url).toBe('http://draft-proxy.test:8000');
    expect(JSON.stringify(payload)).not.toContain('never-send');
    expect(payload).not.toHaveProperty('url');
    expect(probe.buildMediaProviderConnectivityPayload({ ...input, proxyUrl: '' }).proxy_url).toBe(
      ''
    );
  });
  test('joins non-v1 overlaps and queries for public gateway requests', () => {
    const request = buildMediaConnectivityRequest({
      kind: 'image',
      baseUrl: cfg.baseUrl,
      operation: cfg.operations![0],
    });
    expect(request.url).toBe('https://example.test/api/v2/run?base=one&op=two');
  });
  test('preserves caller cancellation for an established media request', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled by caller');
    const pending = requestMediaGatewayConnectivity(
      { method: 'POST', url: 'https://cpa.test/v1/audio/speech', header: {}, data: '{}' },
      {
        signal: controller.signal,
        fetchImpl: (_url, options) => {
          expect(options?.signal).toBe(controller.signal);
          return new Promise<Response>((_resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
              once: true,
            });
          });
        },
      }
    );
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
  for (const [name, body, type] of [
    ['empty-json', '{}', 'application/json'],
    ['pending', '{"status":"pending","task_id":"one"}', 'application/json'],
    ['empty-audio', '', 'audio/wav'],
    ['invalid-base64', '{"data":[{"b64_json":"bad!"}]}', 'application/json'],
  ]) {
    test(`does not report success for ${name}`, async () => {
      await expect(
        requestMediaGatewayConnectivity(
          {
            method: 'POST',
            url: 'https://cpa.test/v1/media/image/generate',
            header: {},
            data: '{}',
          },
          {
            fetchImpl: async () =>
              new Response(body, { status: 200, headers: { 'Content-Type': type } }),
          }
        )
      ).rejects.toThrow();
    });
  }
  test('waits for a completed body and trusts the production executor result marker', async () => {
    const result = await requestMediaGatewayConnectivity(
      { method: 'POST', url: 'https://cpa.test/v1/media/image/generate', header: {}, data: '{}' },
      {
        fetchImpl: async () =>
          new Response('{"data":[{"url":"https://example.test/result.png"}]}', {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-CPA-Media-Result': 'completed' },
          }),
      }
    );
    expect(result.statusCode).toBe(200);
  });
});

test('saved form gateway and single-key probe preserve identical multipart values', async () => {
  const original: MediaProviderConfig = {
    name: 'audio-fixture',
    kind: 'audio',
    baseUrl: 'https://example.test',
    apiKeyEntries: [{ apiKey: 'first' }],
    operations: [
      {
        name: 'speech',
        method: 'POST',
        path: '/speech',
        requestFormat: 'multipart',
        modelMode: 'none',
        responseFormat: 'binary',
        testRequest: { multipartFields: { text: '  Hello, world=friend  ', voice: 'fixture' } },
      },
    ],
  };
  const form = buildMediaProviderFormInput('audio', original);
  const saved = buildMediaProviderConfig('audio', form, original);
  const direct = probe.buildMediaProviderConnectivityPayload({
    providerConfig: saved,
    operation: 'speech',
    model: '',
    apiKey: 'first',
    proxyUrl: 'direct',
  });
  const gateway = buildMediaGatewayConnectivityRequest({
    kind: 'audio',
    gatewayBaseUrl: 'https://cpa.test',
    gatewayApiKey: 'gateway-key',
    operation: form.operations![0],
  });
  const data = await new Response(Buffer.from(gateway.dataBase64!, 'base64'), {
    headers: gateway.header,
  }).formData();
  expect(data.get('text')).toBe('  Hello, world=friend  ');
  expect(gateway.dataBase64).toBe(direct.media_request.data_base64);
});
