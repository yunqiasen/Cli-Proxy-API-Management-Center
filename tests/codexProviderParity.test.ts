import { expect, test } from 'bun:test';
import { providerConnectivityApi, type ApiCallResult } from '@/services/api';
import { simulateCodexProvider } from '@/features/providers/codexProviderProbe';

const messages = {
  baseUrlRequired: 'base-url-required',
  endpointInvalid: 'endpoint-invalid',
  apiKeyRequired: 'api-key-required',
  modelRequired: 'model-required',
  requestFailed: 'request-failed',
};
const success: ApiCallResult = {
  statusCode: 200,
  header: {},
  bodyText: '',
  body: { status: 'completed', output: [] },
};

test('default Codex probe tests one key through the executor and sends model draft settings', async () => {
  const previous = providerConnectivityApi.requestCodex;
  const calls: Parameters<typeof previous>[0][] = [];
  providerConnectivityApi.requestCodex = async (input) => {
    calls.push(input);
    return success;
  };
  try {
    const result = await simulateCodexProvider(
      {
        apiKey: '',
        baseUrl: 'https://agentrouter.org/v1',
        disableImageGeneration: true,
        models: [{ name: 'gpt-6-astra', alias: 'cpa-6a', thinking: { levels: ['low', 'high'] } }],
        apiKeyEntries: [
          { apiKey: 'first', authIndex: 'auth-a' },
          { apiKey: 'second', authIndex: 'auth-b' },
        ],
      },
      messages
    );
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(1);
    const payload = calls[0] as unknown as { codexConfig: Record<string, unknown> };
    expect(payload.codexConfig.models).toEqual([
      { name: 'gpt-6-astra', alias: 'cpa-6a', thinking: { levels: ['low', 'high'] } },
    ]);
    expect(payload.codexConfig['api-key-entries']).toBeUndefined();
    expect(payload.codexConfig['api-key']).toBeUndefined();
  } finally {
    providerConnectivityApi.requestCodex = previous;
  }
});

test('a bare HTTP 200 JSON object is not a completed probe', async () => {
  const result = await simulateCodexProvider(
    { apiKey: 'test', baseUrl: 'https://example.test', models: [{ name: 'm' }] },
    messages,
    {
      request: async () => ({ ...success, body: {} }),
    }
  );
  expect(result.state).toBe('error');
});

test('saving and probing retain the configured first-output watch', async () => {
  const { normalizeNativeProviderPayload, serializeNativeProviderPayload } =
    await import('@/services/api/nativeProviderContracts');
  const { buildNativeProviderFormInput, buildNativeProviderConfig } =
    await import('@/features/providers/nativeProviderForm');
  const saved = normalizeNativeProviderPayload({
    'api-key': 'selected',
    'base-url': 'https://agentrouter.org/v1',
    'responses-first-output-timeout-seconds': 120,
    models: [{ name: 'gpt-6-astra', thinking: { levels: ['low', 'high'] } }],
  })!;
  const edited = buildNativeProviderConfig(
    'codex',
    buildNativeProviderFormInput('codex', saved),
    saved
  );
  expect(serializeNativeProviderPayload(edited)['responses-first-output-timeout-seconds']).toBe(
    120
  );
});

test('the edit-sheet probe uses the save draft without testing other incomplete keys', async () => {
  const { buildNativeProviderFormInput, buildNativeProviderDraft, buildNativeProviderConfig } =
    await import('@/features/providers/nativeProviderForm');
  const { serializeNativeProviderPayload } = await import('@/services/api/nativeProviderContracts');
  const saved = {
    apiKey: '',
    apiKeyEntries: [{ apiKey: 'selected', authIndex: 'auth-a' }],
    baseUrl: 'https://agentrouter.org/v1',
    models: [{ name: 'gpt-6-astra', alias: 'cpa-6a', thinking: { levels: ['low', 'high'] } }],
  };
  const form = buildNativeProviderFormInput('codex', saved);
  form.models[0].thinkingJson = '{"levels":["high"]}';
  const serializedSave = serializeNativeProviderPayload(
    buildNativeProviderConfig('codex', form, saved)
  );
  delete serializedSave['api-key-entries'];
  delete serializedSave['api-key'];
  form.apiKeyEntries!.push({ apiKey: '', proxyUrl: '' });
  const previous = providerConnectivityApi.requestCodex;
  const calls: Parameters<typeof previous>[0][] = [];
  providerConnectivityApi.requestCodex = async (input) => {
    calls.push(input);
    return success;
  };
  try {
    await simulateCodexProvider(buildNativeProviderDraft('codex', form, saved), messages);
    expect(calls).toHaveLength(1);
    expect(calls[0].codexConfig).toMatchObject(serializedSave);
    expect(calls[0].codexConfig?.models).toEqual([
      { name: 'gpt-6-astra', alias: 'cpa-6a', thinking: { levels: ['high'] } },
    ]);
  } finally {
    providerConnectivityApi.requestCodex = previous;
  }
});

test('a failed selected key never causes another key to be tested', async () => {
  const previous = providerConnectivityApi.requestCodex;
  const calls: Parameters<typeof previous>[0][] = [];
  providerConnectivityApi.requestCodex = async (input) => {
    calls.push(input);
    throw new Error('selected key failed');
  };
  try {
    const result = await simulateCodexProvider(
      {
        apiKey: '',
        baseUrl: 'https://agentrouter.org/v1',
        models: [{ name: 'gpt-6-astra' }],
        apiKeyEntries: [
          { apiKey: 'first', authIndex: 'auth-a' },
          { apiKey: 'second', authIndex: 'auth-b' },
        ],
      },
      messages,
      { entryIndices: [1] }
    );
    expect(result.state).toBe('error');
    expect(calls).toHaveLength(1);
    expect(calls[0].authIndex).toBe('auth-b');
  } finally {
    providerConnectivityApi.requestCodex = previous;
  }
});

test('probe drafts retain opaque provider and model settings exactly like a save', async () => {
  const { normalizeNativeProviderPayload, serializeNativeProviderPayload } =
    await import('@/services/api/nativeProviderContracts');
  const { buildNativeProviderFormInput, buildNativeProviderDraft } =
    await import('@/features/providers/nativeProviderForm');
  const config = normalizeNativeProviderPayload({
    'api-key': 'selected',
    'base-url': 'https://agentrouter.org/v1',
    'alpha-search': true,
    models: [
      { name: 'gpt-6-astra', alias: 'cpa-6a', 'is-compat': true, 'max-context-length': 256000 },
    ],
  })!;
  const draft = buildNativeProviderDraft(
    'codex',
    buildNativeProviderFormInput('codex', config),
    config
  );
  const serialized = serializeNativeProviderPayload(draft);
  expect(serialized['alpha-search']).toBe(true);
  expect(serialized.models).toEqual([
    { name: 'gpt-6-astra', alias: 'cpa-6a', 'is-compat': true, 'max-context-length': 256000 },
  ]);
});

test('a probe clears the same removed fields as a provider save', async () => {
  const { serializeCodexProviderDraft } = await import('@/services/api/nativeProviderContracts');
  const { buildNativeProviderFormInput, buildNativeProviderDraft } =
    await import('@/features/providers/nativeProviderForm');
  const saved = {
    apiKey: 'fixture',
    baseUrl: 'https://agentrouter.org/v1',
    proxyUrl: 'http://old-proxy',
    prefix: 'old-prefix',
    disableCooling: true,
    models: [{ name: 'gpt-6-astra' }],
  };
  const form = buildNativeProviderFormInput('codex', saved);
  form.proxyUrl = '';
  form.prefix = '';
  form.disableCooling = false;
  form.models = [];
  const payload = serializeCodexProviderDraft(buildNativeProviderDraft('codex', form, saved));
  expect(payload['proxy-url']).toBeNull();
  expect(payload.prefix).toBeNull();
  expect(payload['disable-cooling']).toBeNull();
  expect(payload.models).toBeNull();
});

test('executor probes do not impose a separate browser whole-response deadline', async () => {
  const previous = providerConnectivityApi.requestCodex;
  let requestTimeout: number | undefined;
  providerConnectivityApi.requestCodex = async (_input, options) => {
    requestTimeout = options?.timeout;
    return success;
  };
  try {
    await simulateCodexProvider(
      {
        apiKey: 'selected',
        baseUrl: 'https://agentrouter.org/v1',
        models: [{ name: 'gpt-6-astra' }],
        responsesFirstOutputTimeoutSeconds: 120,
      },
      messages
    );
    expect(requestTimeout).toBe(0);
  } finally {
    providerConnectivityApi.requestCodex = previous;
  }
});

test('the executor probe uses the public alias so alias-scoped payload rules also run', async () => {
  const previous = providerConnectivityApi.requestCodex;
  let model = '';
  providerConnectivityApi.requestCodex = async (input) => {
    model = input.model;
    return success;
  };
  try {
    await simulateCodexProvider(
      {
        apiKey: 'fixture',
        baseUrl: 'https://agentrouter.org/v1',
        prefix: 'team',
        models: [{ name: 'gpt-6-astra', alias: 'cpa-6a' }],
      },
      messages
    );
    expect(model).toBe('team/cpa-6a');
  } finally {
    providerConnectivityApi.requestCodex = previous;
  }
});

test('Codex probe propagates caller cancellation without adding a response deadline', async () => {
  const previous = providerConnectivityApi.requestCodex;
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  let timeout: number | undefined;
  providerConnectivityApi.requestCodex = async (_input, config) => {
    received = config?.signal as AbortSignal;
    timeout = config?.timeout;
    controller.abort();
    return success;
  };
  try {
    await expect(
      simulateCodexProvider(
        { apiKey: 'selected', baseUrl: 'https://relay.test', models: [{ name: 'm' }] },
        messages,
        { signal: controller.signal }
      )
    ).rejects.toThrow();
    expect(received).toBe(controller.signal);
    expect(timeout).toBe(0);
  } finally {
    providerConnectivityApi.requestCodex = previous;
  }
});

test('already canceled Codex probes never send requests', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await expect(
    simulateCodexProvider(
      { apiKey: 'selected', baseUrl: 'https://relay.test', models: [{ name: 'm' }] },
      messages,
      {
        signal: controller.signal,
        request: async () => {
          calls++;
          return success;
        },
      }
    )
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

test('canceling an explicit all-key probe stops queued keys rather than rotating', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  await expect(
    simulateCodexProvider(
      {
        apiKey: '',
        baseUrl: 'https://relay.test',
        models: [{ name: 'm' }],
        apiKeyEntries: Array.from({ length: 8 }, (_, i) => ({ apiKey: `key-${i}` })),
      },
      messages,
      {
        signal: controller.signal,
        testAll: true,
        request: async (payload) => {
          calls.push(payload.header?.Authorization ?? '');
          controller.abort();
          return success;
        },
      }
    )
  ).rejects.toThrow();
  expect(calls).toEqual(['Bearer key-0']);
});
