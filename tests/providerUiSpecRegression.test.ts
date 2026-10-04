import { afterEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiClient } from '@/services/api/client';
import { serializeOpenAIProvider } from '@/services/api/openAIProviderContracts';
import { useConfigStore } from '@/stores';
import {
  buildProviderGroups,
  useProviderWorkbench,
} from '@/features/providers/useProviderWorkbench';
import { buildInitialForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import { buildOpenAIConfig } from '@/features/providers/providerFormSerialization';
import { buildNativeProviderFormInput } from '@/features/providers/nativeProviderForm';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { useConnectivityTest } from '@/features/providers/sheets/forms/useConnectivityTest';
import type { Config, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { ProviderResource } from '@/features/providers/types';

function capture<T>(hook: () => T): T {
  let value: T;
  function Harness() {
    value = hook();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return value!;
}
const restore: Array<() => void> = [];
afterEach(() => {
  restore
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
});
function backend(config: Record<string, unknown> = {}) {
  const writes: Array<{ url: string; data: unknown }> = [];
  for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
    const mock = spyOn(apiClient, method).mockImplementation((async (
      url: string,
      data: unknown
    ) => {
      if (method === 'get') return url === '/config' ? config : {};
      writes.push({ url, data });
      return { status_code: 200, body: '{}' };
    }) as never);
    restore.push(() => mock.mockRestore());
  }
  const previous = useConfigStore.getState();
  useConfigStore.getState().clearCache();
  restore.push(() => {
    useConfigStore.getState().clearCache();
    useConfigStore.setState(previous, true);
  });
  return writes;
}
for (const brand of ['image', 'video', 'audio'] as const) {
  test(`${brand} real workbench creates, groups, edits, toggles and deletes media`, async () => {
    const writes = backend();
    const hook = capture(useProviderWorkbench);
    const form = {
      ...buildInitialForm('openaiCompatibility', null, 'create'),
      name: brand,
      baseUrl: 'https://fixture.test',
      models: [{ name: 'media-model', capabilities: [brand] }],
      apiKeyEntries: [{ apiKey: 'fixture-key', proxyUrl: '' }],
    };
    await hook.createProvider(brand, form);
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe('/media-providers');
    expect(writes[0].data).toMatchObject({ kind: brand, name: brand });
    const groups = buildProviderGroups({
      mediaProviders: [
        {
          name: 'other',
          kind: brand === 'image' ? 'audio' : 'image',
          baseUrl: 'https://other.test',
        },
        {
          name: brand,
          kind: brand,
          baseUrl: form.baseUrl,
          apiKeyEntries: [{ apiKey: 'fixture-key' }],
        },
      ],
    } as Config);
    const resource = groups.find((group) => group.id === brand)!.resources[0];
    expect(resource.selector).toMatchObject({ brand, index: 1 });
    await hook.updateProvider(resource, { ...form, name: 'edited' });
    expect(writes[1].data).toMatchObject({ index: 1, value: { name: 'edited' } });
    await hook.toggleDisabled(resource, true);
    expect(writes[2].data).toMatchObject({ index: 1, value: { disabled: true } });
    await hook.deleteProvider(resource);
    expect(writes[3].url).toBe('/media-providers?index=1');
  });
}
for (const type of ['embeddings', 'rerank'] as const) {
  test(`${type} edit initializer -> workbench save and production probe preserve metadata`, async () => {
    const raw: OpenAIProviderConfig = {
      name: 'retrieval',
      baseUrl: 'https://fixture.test',
      prefix: 'team',
      apiKeyEntries: [{ apiKey: 'fixture-key' }],
      models: [
        {
          name: 'model',
          alias: 'public',
          type,
          upstreamPath: '/custom/retrieval',
          sourceIndex: 0,
          displayName: 'Vectors',
          maxContextLength: 8192,
          inputModalities: ['text'],
          outputModalities: [],
          useMaxCompletionTokens: false,
          wireExtras: { 'future-option': true },
        },
      ],
    };
    const resource = {
      raw,
      brand: 'openaiCompatibility',
      selector: { brand: 'openaiCompatibility', name: raw.name, index: 0 },
    } as ProviderResource;
    const form = buildInitialForm('openaiCompatibility', resource, 'edit');
    expect(form.models[0]).toMatchObject({ type, upstreamPath: '/custom/retrieval' });
    const writes = backend({
      'api-keys': { 'openai-compatibility': [serializeOpenAIProvider(raw)] },
    });
    await capture(useProviderWorkbench).createProvider('openaiCompatibility', form);
    const model = ((writes[0].data as Record<string, unknown>[])[0].models as unknown[])[0];
    expect(model).toMatchObject({
      type,
      'upstream-path': '/custom/retrieval',
      'display-name': 'Vectors',
      'max-context-length': 8192,
      'input-modalities': ['text'],
      'output-modalities': [],
      'use-max-completion-tokens': false,
      'future-option': true,
    });
    await capture(useProviderWorkbench).updateProvider(resource, form);
    expect(((writes[1].data as Record<string, unknown>[])[0].models as unknown[])[0]).toEqual(
      model
    );
    const hook = capture(() =>
      useConnectivityTest(
        {
          brand: 'openaiCompatibility',
          baseUrl: form.baseUrl,
          models: form.models,
          formHeaders: form.headers,
          apiKeyEntries: form.apiKeyEntries,
          buildOpenAIDraft: () => buildOpenAIConfig(form, raw),
        },
        {
          baseUrlRequired: 'base',
          endpointInvalid: 'endpoint',
          apiKeyRequired: 'key',
          modelRequired: 'model',
          timeout: () => 'timeout',
          requestFailed: 'failed',
        }
      )
    );
    expect(await hook.runOpenAIKey(0)).toBe(true);
    expect(writes[2].url).toBe('/provider-connectivity-test');
    expect(JSON.stringify(writes[2].data)).toContain('/custom/retrieval');
    expect(JSON.stringify(writes[2].data)).toContain('future-option');
  });
}
for (const brand of ['gemini', 'codex', 'claude'] as const) {
  for (const cooling of ['disabled', 'enabled', 'inherit'] as const) {
    test(`${brand} workbench cooling ${cooling} overrides stale boolean`, async () => {
      const group = {
        name: 'group',
        'disable-cooling': true,
        keys: [{ 'api-key': 'fixture-key', 'disable-cooling': false }],
      };
      const raw = normalizeProviderGroups([group])[0] as ProviderKeyConfig;
      const form = buildNativeProviderFormInput(brand, raw);
      form.disableCooling = cooling === 'enabled';
      form.runtimePolicy!.cooling = cooling;
      const writes = backend({ 'api-keys': { [brand]: [group] } });
      await capture(useProviderWorkbench).updateProvider(
        { raw, brand, selector: { brand, apiKey: raw.apiKey, index: 0 } } as ProviderResource,
        form
      );
      const saved = (
        (writes[0].data as Record<string, unknown>[])[0].keys as Record<string, unknown>[]
      )[0];
      expect(saved['disable-cooling']).toBe(
        cooling === 'inherit' ? undefined : cooling === 'disabled'
      );
    });
  }
}
