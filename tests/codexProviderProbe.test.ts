import { describe, expect, test } from 'bun:test';
import type { ApiCallRequest, ApiCallResult } from '@/services/api';
import {
  getCodexProbeEntryIndices,
  pickCodexProbeModel,
  simulateCodexProvider,
  type CodexProbeMessages,
} from '@/features/providers/codexProviderProbe';
import type { ProviderKeyConfig } from '@/types';

const messages: CodexProbeMessages = {
  baseUrlRequired: 'base-url-required',
  endpointInvalid: 'endpoint-invalid',
  apiKeyRequired: 'api-key-required',
  modelRequired: 'model-required',
  requestFailed: 'request-failed',
};

const okResult = (statusCode = 200): ApiCallResult => ({
  statusCode,
  header: {},
  bodyText: '{}',
  body: {},
});

const groupedConfig = (): ProviderKeyConfig => ({
  name: 'Codex relays',
  apiKey: '',
  baseUrl: 'https://relay.example/v1',
  headers: { 'X-Custom': 'kept' },
  models: [{ name: 'gpt-upstream', alias: 'cpa-model' }, { name: 'gpt-fallback' }],
  apiKeyEntries: [
    { apiKey: 'key-a', authIndex: 'auth-a' },
    { apiKey: 'key-b', authIndex: 'auth-b' },
  ],
});

describe('simulateCodexProvider', () => {

  test('selects all entries for the edit-sheet all-keys action', () => {
    expect(getCodexProbeEntryIndices(undefined, true)).toBeUndefined();
    expect(getCodexProbeEntryIndices(undefined, false)).toEqual([0]);
    expect(getCodexProbeEntryIndices(2, false)).toEqual([2]);
  });
  test('simulates every grouped key with an independent Codex Responses request', async () => {
    const requests: ApiCallRequest[] = [];

    const result = await simulateCodexProvider(groupedConfig(), messages, {
      request: async (payload) => {
        requests.push(payload);
        return okResult();
      },
    });

    expect(result.state).toBe('success');
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.authIndex)).toEqual(['auth-a', 'auth-b']);
    expect(requests.map((request) => request.url)).toEqual([
      'https://relay.example/v1/responses',
      'https://relay.example/v1/responses',
    ]);
    expect(requests[0]?.header?.Authorization).toBe('Bearer key-a');
    expect(requests[1]?.header?.Authorization).toBe('Bearer key-b');
    expect(requests[0]?.header?.['X-Custom']).toBe('kept');

    for (const request of requests) {
      const body = JSON.parse(request.data ?? '{}') as Record<string, unknown>;
      expect(body.model).toBe('gpt-upstream');
      expect(body.prompt_cache_key).toBe(request.header?.Session_id);
      expect(body.input).toEqual([
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hi' }],
        },
      ]);
    }
  });

  test('keeps testing remaining keys and summarizes partial failures', async () => {
    const result = await simulateCodexProvider(groupedConfig(), messages, {
      request: async (payload) =>
        payload.authIndex === 'auth-a'
          ? okResult()
          : {
              ...okResult(503),
              bodyText: '{"error":{"message":"relay busy"}}',
              body: { error: { message: 'relay busy' } },
            },
    });

    expect(result.state).toBe('error');
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.entries.map((entry) => entry.state)).toEqual(['success', 'error']);
    expect(result.message).toContain('503 relay busy');
  });

  test('supports testing one selected key and reports validation failures', async () => {
    const requests: ApiCallRequest[] = [];
    const result = await simulateCodexProvider(groupedConfig(), messages, {
      entryIndices: [1],
      request: async (payload) => {
        requests.push(payload);
        return okResult();
      },
    });

    expect(result.total).toBe(1);
    expect(result.entries[0]?.index).toBe(1);
    expect(requests[0]?.header?.Authorization).toBe('Bearer key-b');

    const invalid = await simulateCodexProvider(
      { apiKey: 'key', baseUrl: 'https://relay.example/v1', models: [] },
      messages,
      { request: async () => okResult() }
    );
    expect(invalid.state).toBe('error');
    expect(invalid.message).toBe('model-required');
  });

  test('limits concurrent key probes within one provider', async () => {
    let active = 0;
    let maxActive = 0;
    const config = groupedConfig();
    config.apiKeyEntries = Array.from({ length: 9 }, (_, index) => ({
      apiKey: `key-${index}`,
      authIndex: `auth-${index}`,
    }));

    const result = await simulateCodexProvider(config, messages, {
      request: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(5);
        active -= 1;
        return okResult();
      },
    });

    expect(result.successCount).toBe(9);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  test('rejects invalid endpoints before sending a request', async () => {
    let called = false;
    const config = groupedConfig();
    config.baseUrl = 'ftp://relay.example/v1';

    const result = await simulateCodexProvider(config, messages, {
      request: async () => {
        called = true;
        return okResult();
      },
    });

    expect(result.message).toBe('endpoint-invalid');
    expect(called).toBe(false);
  });

  test('honors the one-off test model selected in the edit sheet', async () => {
    let requestBody = '';
    await simulateCodexProvider(groupedConfig(), messages, {
      entryIndices: [0],
      model: 'gpt-selected',
      request: async (payload) => {
        requestBody = payload.data ?? '';
        return okResult();
      },
    });

    expect(JSON.parse(requestBody).model).toBe('gpt-selected');
  });

  test('uses the upstream model name instead of its public alias', () => {
    expect(pickCodexProbeModel(groupedConfig())).toBe('gpt-upstream');
  });
});

test('does not reuse a provider auth index for grouped entries without their own auth index', async () => {
  const config = groupedConfig();
  config.authIndex = 'provider-auth';
  config.apiKeyEntries = [
    { apiKey: 'key-a', authIndex: 'auth-a' },
    { apiKey: 'key-b' },
  ];
  const authIndices: Array<string | undefined> = [];

  await simulateCodexProvider(config, messages, {
    request: async (payload) => {
      authIndices.push(payload.authIndex);
      return okResult();
    },
  });

  expect(authIndices).toEqual(['auth-a', undefined]);
});

test('does not mark a successful HTML response as a valid Codex probe', async () => {
  const result = await simulateCodexProvider(groupedConfig(), messages, {
    entryIndices: [0],
    request: async () => ({
      ...okResult(200),
      bodyText: '<html>blocked</html>',
      body: '<html>blocked</html>',
    }),
  });

  expect(result.state).toBe('error');
  expect(result.failureCount).toBe(1);
  expect(result.entries[0]?.message).toContain('200 <html>blocked</html>');
});

test('reports no entries when a provider has neither a legacy nor grouped key', async () => {
  const result = await simulateCodexProvider(
    { baseUrl: 'https://relay.example/v1', models: [{ name: 'gpt-5.5' }], apiKey: '' },
    messages,
    { request: async () => okResult() }
  );

  expect(result.total).toBe(0);
  expect(result.failureCount).toBe(0);
  expect(result.message).toBe('api-key-required');
});
