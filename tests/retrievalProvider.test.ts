import { expect, test } from 'bun:test';
import { normalizeOpenAIProvider } from '@/services/api/transformers';
import { providersApi } from '@/services/api/providers';
import { apiClient } from '@/services/api/client';

const raw = {
  name: 'retrieval',
  'base-url': 'https://example.test/v1',
  'api-key-entries': [{ 'api-key': 'selected' }],
  models: [{ name: 'vector-v1', alias: 'vector', type: 'embeddings', 'upstream-path': '/custom' }],
};

test('OpenAI retrieval model type and path survive loading and saving', async () => {
  const provider = normalizeOpenAIProvider(raw)!;
  expect(provider.models?.[0]).toMatchObject({ type: 'embeddings', upstreamPath: '/custom' });
  const get = apiClient.get;
  const put = apiClient.put;
  const saved: unknown[] = [];
  apiClient.get = (async () => []) as typeof get;
  apiClient.put = (async (_url: string, payload: unknown) => {
    saved.push(payload);
  }) as typeof put;
  try {
    await providersApi.createOpenAIProvider(provider);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject([{ models: raw.models }]);
  } finally {
    apiClient.get = get;
    apiClient.put = put;
  }
});

test('retrieval probes send the save draft and only the selected credential', async () => {
  const { providerConnectivityApi } = await import('@/services/api/providerConnectivity');
  const { serializeOpenAIProviderDraft } = await import('@/services/api/openAIProviderContracts');
  const provider = normalizeOpenAIProvider(raw)!;
  provider.apiKeyEntries.push({ apiKey: 'other-paid-key' });
  const post = apiClient.post;
  const calls: { url: string; payload: unknown }[] = [];
  apiClient.post = (async (url: string, payload: unknown) => {
    calls.push({ url, payload });
    return { status_code: 200, header: {}, body: '{"data":[{"index":0,"embedding":[1]}]}' };
  }) as typeof post;
  try {
    await providerConnectivityApi.requestOpenAI({
      providerConfig: provider,
      model: 'vector',
      apiKey: 'selected',
      proxyUrl: 'direct',
    });
    const draft = serializeOpenAIProviderDraft(provider);
    expect(calls).toEqual([
      {
        url: '/provider-connectivity-test',
        payload: {
          provider: 'openai-compatibility',
          model: 'vector',
          api_key: 'selected',
          proxy_url: 'direct',
          openai_config: draft,
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('other-paid-key');
  } finally {
    apiClient.post = post;
  }
});

test('the shared form builder edits and clears retrieval fields for saves and probes', async () => {
  const { buildOpenAIConfig } = await import('@/features/providers/providerFormSerialization');
  const { serializeOpenAIProvider } = await import('@/services/api/providers');
  const input: Parameters<typeof buildOpenAIConfig>[0] = {
    apiKey: '',
    name: 'retrieval',
    baseUrl: 'https://example.test/v1',
    prefix: '',
    proxyUrl: '',
    disabled: false,
    excludedModelsText: '',
    headers: [],
    apiKeyEntries: [{ apiKey: '', existingApiKey: 'selected', proxyUrl: '' }],
    models: [{ name: 'rank-v1', alias: 'rank', type: 'rerank', upstreamPath: '/rank' }],
  };
  expect(serializeOpenAIProvider(buildOpenAIConfig(input)).models).toEqual([
    { name: 'rank-v1', alias: 'rank', type: 'rerank', 'upstream-path': '/rank' },
  ]);
  input.models[0].type = undefined;
  expect(serializeOpenAIProvider(buildOpenAIConfig(input)).models).toEqual([
    { name: 'rank-v1', alias: 'rank' },
  ]);
});

test('retrieval probe clears removed settings and preserves unedited server options', async () => {
  const { buildOpenAIProviderConnectivityPayload } =
    await import('@/services/api/providerConnectivity');
  const provider = normalizeOpenAIProvider({
    ...raw,
    prefix: 'old-prefix',
    headers: { 'X-Stale': 'old' },
    'disable-cooling': true,
    'support-prompt-cache-key': true,
    models: [{ ...raw.models[0], 'force-mapping': true }],
  })!;
  provider.prefix = undefined;
  provider.headers = undefined;
  provider.disableCooling = false;
  const payload = buildOpenAIProviderConnectivityPayload({
    providerConfig: provider,
    model: 'vector',
    apiKey: 'selected',
  });
  expect(payload.openai_config).toMatchObject({
    prefix: null,
    headers: null,
    'disable-cooling': null,
    'support-prompt-cache-key': true,
    models: [
      {
        name: 'vector-v1',
        alias: 'vector',
        type: 'embeddings',
        'upstream-path': '/custom',
        'force-mapping': true,
      },
    ],
  });
  expect(payload.openai_config).not.toHaveProperty('api-key-entries');
});

test('retrieval form edits retain model options without applying hidden chat settings', async () => {
  const { buildOpenAIConfig } = await import('@/features/providers/providerFormSerialization');
  const { serializeOpenAIProvider } = await import('@/services/api/providers');
  const input: Parameters<typeof buildOpenAIConfig>[0] = {
    apiKey: '',
    name: 'retrieval',
    baseUrl: 'https://example.test/v1',
    prefix: '',
    proxyUrl: '',
    disabled: false,
    excludedModelsText: '',
    headers: [],
    apiKeyEntries: [{ apiKey: 'selected', proxyUrl: '' }],
    models: [
      {
        name: 'vector',
        type: 'embeddings',
        image: true,
        thinkingJson: '{',
        wireExtras: { 'force-mapping': true },
      },
    ],
  };
  expect(serializeOpenAIProvider(buildOpenAIConfig(input)).models).toEqual([
    { name: 'vector', type: 'embeddings', 'force-mapping': true },
  ]);
});

test('OpenAI saves keep the latest hidden options instead of replaying stale form snapshots', async () => {
  const loaded = {
    ...raw,
    'support-prompt-cache-key': false,
    'removed-provider-option': 'stale',
    models: [{ ...raw.models[0], 'force-mapping': false, 'removed-model-option': 'stale' }],
  };
  const latest = {
    ...raw,
    'support-prompt-cache-key': true,
    models: [{ ...raw.models[0], 'force-mapping': true }],
  };
  const provider = normalizeOpenAIProvider(loaded)!;
  provider.models![0].alias = 'edited-vector';
  const get = apiClient.get;
  const put = apiClient.put;
  let written: Array<Record<string, unknown>> = [];
  apiClient.get = (async () => ({ 'openai-compatibility': [latest] })) as typeof get;
  apiClient.put = (async (_url: string, payload: unknown) => {
    written = payload as Array<Record<string, unknown>>;
  }) as typeof put;
  try {
    await providersApi.updateOpenAIProvider('retrieval', 0, provider);
    expect(written).toMatchObject([
      {
        'support-prompt-cache-key': true,
        models: [
          {
            name: 'vector-v1',
            alias: 'edited-vector',
            type: 'embeddings',
            'upstream-path': '/custom',
            'force-mapping': true,
          },
        ],
      },
    ]);
    expect(written[0]).not.toHaveProperty('removed-provider-option');
    expect((written[0].models as Record<string, unknown>[])[0]).not.toHaveProperty(
      'removed-model-option'
    );
  } finally {
    apiClient.get = get;
    apiClient.put = put;
  }
});

test('retrieval key probes use the public alias and prefix for production payload rules', async () => {
  const { providerConnectivityApi } = await import('@/services/api/providerConnectivity');
  const provider = normalizeOpenAIProvider({ ...raw, prefix: 'team' })!;
  const post = apiClient.post;
  const calls: Record<string, unknown>[] = [];
  apiClient.post = (async (_url: string, payload: unknown) => {
    calls.push(payload as Record<string, unknown>);
    return { status_code: 200, header: {}, body: '{"data":[{"index":0,"embedding":[1]}]}' };
  }) as typeof post;
  try {
    for (const selected of ['vector-v1', 'vector', 'team/vector']) {
      await providerConnectivityApi.requestOpenAI({
        providerConfig: provider,
        model: selected,
        apiKey: 'selected',
      });
    }
    expect(calls.map((payload) => payload.model)).toEqual([
      'team/vector',
      'team/vector',
      'team/vector',
    ]);
    expect(calls.every((payload) => payload.api_key === 'selected')).toBe(true);
  } finally {
    apiClient.post = post;
  }
});
