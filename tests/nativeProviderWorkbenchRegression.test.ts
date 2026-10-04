import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { providersApi, type ProviderFamily } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { BaseProviderForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import { buildNativeProviderConfig, buildNativeProviderFormInput } from '@/features/providers/nativeProviderForm';
import en from '@/i18n/locales/en.json';
import type { ProviderKeyConfig, GeminiKeyConfig } from '@/types';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

const render = (component: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, component));

function backend(family: ProviderFamily, groups: Record<string, unknown>[] = []) {
  let state = structuredClone(groups);
  const writes: unknown[] = [];
  apiClient.get = (async (url: string) => {
    expect(url).toBe('/config');
    return { 'api-keys': { [family]: structuredClone(state) } };
  }) as typeof apiClient.get;
  apiClient.put = (async (url: string, data: unknown) => {
    expect(url).toBe(`/config/api-keys/${family}`);
    writes.push(data);
    state = structuredClone(data as Record<string, unknown>[]);
  }) as typeof apiClient.put;
  return { groups: () => state, writes };
}

const rows = (groups: unknown) => normalizeProviderGroups(groups) as ProviderKeyConfig[];
const key = (group: Record<string, unknown>) => (group.keys as Record<string, unknown>[])[0];

const nativeBrands = ['gemini', 'codex', 'claude'] as const;

/* ------------------------------------------------------------------ */
/* SSR: create form must have key inputs for native brands             */
/* ------------------------------------------------------------------ */
describe('native provider create form SSR', () => {
  for (const brand of nativeBrands) {
    test(`${brand} create form has at least one key input in the entries section`, () => {
      const html = render(
        createElement(BaseProviderForm, {
          brand,
          resource: null,
          mode: 'create' as const,
          mutating: false,
          formId: 'test-form',
          onSubmit: async () => {},
        })
      );
      // Blank entry is auto-expanded, so password input is visible.
      const passwordInputs = html.match(/<input[^>]*type="password"[^>]*>/g) ?? [];
      expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    });
  }
});

/* ------------------------------------------------------------------ */
/* SSR: edit form preserves grouped keys                               */
/* ------------------------------------------------------------------ */
describe('native provider edit form SSR', () => {
  test('codex edit with grouped keys shows all existing entry cards', () => {
    const group = {
      name: 'team',
      keys: [
        {
          'api-key': '',
          'api-key-entries': [
            { 'api-key': 'key-a', weight: 1 },
            { 'api-key': 'key-b', weight: 2 },
          ],
          'base-url': 'https://example.test',
        },
      ],
    };
    const [resource] = rows([group]);
    const html = render(
      createElement(BaseProviderForm, {
        brand: 'codex',
        resource: { raw: resource } as never,
        mode: 'edit' as const,
        mutating: false,
        formId: 'test-form',
        onSubmit: async () => {},
      })
    );
    // Entry cards show "Key #N" labels. Two entries = two key labels.
    const keyLabels = html.match(/Key #(\d+)/g) ?? [];
    expect(keyLabels.length).toBeGreaterThanOrEqual(2);
  });

  test('gemini edit with single key shows one entry card', () => {
    const group = {
      name: 'team',
      keys: [{ 'api-key': 'existing-key', 'base-url': 'https://example.test' }],
    };
    const [resource] = rows([group]);
    const html = render(
      createElement(BaseProviderForm, {
        brand: 'gemini',
        resource: { raw: resource } as never,
        mode: 'edit' as const,
        mutating: false,
        formId: 'test-form',
        onSubmit: async () => {},
      })
    );
    // Entry card shows "Key #1" label.
    expect(html).toContain('Key #1');
  });

  test('claude edit with grouped keys shows entries with masked keys', () => {
    const group = {
      name: 'team',
      keys: [
        {
          'api-key': '',
          'api-key-entries': [{ 'api-key': 'sk-ant-test-key' }],
          'base-url': 'https://example.test',
        },
      ],
    };
    const [resource] = rows([group]);
    const html = render(
      createElement(BaseProviderForm, {
        brand: 'claude',
        resource: { raw: resource } as never,
        mode: 'edit' as const,
        mutating: false,
        formId: 'test-form',
        onSubmit: async () => {},
      })
    );
    // The masked key and entry label should appear in the summary.
    expect(html).toContain('Key #1');
    expect(html).toContain('sk');
  });
});

/* ------------------------------------------------------------------ */
/* API serializer: grouped keys survive the V8 save path               */
/* ------------------------------------------------------------------ */
describe('native provider V8 grouped key serialization', () => {
  test('createCodexConfig serializes api-key-entries when config has apiKeyEntries', async () => {
    const b = backend('codex');
    const config: ProviderKeyConfig = {
      apiKey: '',
      apiKeyEntries: [
        { apiKey: 'key-a', weight: 1 },
        { apiKey: 'key-b', weight: 2 },
      ],
      baseUrl: 'https://example.test',
    };
    await providersApi.createCodexConfig(config);
    const created = key(b.groups()[0]);
    expect(created['api-key-entries']).toEqual([
      { 'api-key': 'key-a', weight: 1 },
      { 'api-key': 'key-b', weight: 2 },
    ]);
  });

  test('createGeminiKey serializes api-key-entries when config has apiKeyEntries', async () => {
    const b = backend('gemini');
    const config: GeminiKeyConfig = {
      apiKey: '',
      apiKeyEntries: [
        { apiKey: 'gem-a' },
        { apiKey: 'gem-b' },
      ],
      baseUrl: 'https://example.test',
    };
    await providersApi.createGeminiKey(config);
    const created = key(b.groups()[0]);
    expect(created['api-key-entries']).toEqual([
      { 'api-key': 'gem-a' },
      { 'api-key': 'gem-b' },
    ]);
  });

  test('createClaudeConfig serializes api-key-entries when config has apiKeyEntries', async () => {
    const b = backend('claude');
    const config: ProviderKeyConfig = {
      apiKey: '',
      apiKeyEntries: [{ apiKey: 'claude-a' }],
      baseUrl: 'https://example.test',
    };
    await providersApi.createClaudeConfig(config);
    const created = key(b.groups()[0]);
    expect(created['api-key-entries']).toEqual([{ 'api-key': 'claude-a' }]);
  });

  test('updateCodexConfig preserves grouped entries through edit roundtrip', async () => {
    const group = {
      name: 'team',
      keys: [
        {
          'api-key': '',
          'api-key-entries': [
            { 'api-key': 'old-a', weight: 1 },
            { 'api-key': 'old-b', weight: 2 },
          ],
        },
      ],
    };
    const b = backend('codex', [group]);
    const [existing] = rows(b.groups());
    // Build form from existing config (simulating edit form load)
    const form = buildNativeProviderFormInput('codex', existing);
    // Simulate user editing weight on first key
    form.apiKeyEntries![0].weight = 5;
    const updated = buildNativeProviderConfig('codex', form, existing);
    await providersApi.updateCodexConfig(existing.apiKey, existing.baseUrl, updated);
    const savedKey = key(b.groups()[0]);
    expect(savedKey['api-key-entries']).toEqual([
      { 'api-key': 'old-a', weight: 5 },
      { 'api-key': 'old-b', weight: 2 },
    ]);
  });

  test('single-key codex create does not add api-key-entries', async () => {
    const b = backend('codex');
    await providersApi.createCodexConfig({ apiKey: 'single-key', baseUrl: 'https://example.test' });
    const created = key(b.groups()[0]);
    expect(created['api-key-entries']).toBeUndefined();
    expect(created['api-key']).toBe('single-key');
  });

  test('single-key codex edit preserves apiKey without adding entries', async () => {
    const group = {
      name: 'team',
      keys: [{ 'api-key': 'single', 'base-url': 'https://example.test', weight: 3 }],
    };
    const b = backend('codex', [group]);
    const [existing] = rows(b.groups());
    const form = buildNativeProviderFormInput('codex', existing);
    form.apiKeyEntries![0].apiKey = 'rotated';
    const updated = buildNativeProviderConfig('codex', form, existing);
    await providersApi.updateCodexConfig(existing.apiKey, existing.baseUrl, updated);
    const savedKey = key(b.groups()[0]);
    expect(savedKey['api-key-entries']).toBeUndefined();
    expect(savedKey['api-key']).toBe('rotated');
  });
});
