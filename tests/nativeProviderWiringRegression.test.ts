import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { providersApi, type ProviderFamily } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import type { ProviderKeyConfig } from '@/types';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});



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
const formSource = () =>
  readFileSync('src/features/providers/sheets/forms/BaseProviderForm.tsx', 'utf8');

/* ------------------------------------------------------------------ */
/* Source wiring: native onTest uses runNativeKey, not runOpenAIKey    */
/* ------------------------------------------------------------------ */
describe('native provider probe wiring source checks', () => {
  const src = formSource();

  test('ApiKeyEntriesEditor onTest uses runNativeKey for native brands', () => {
    // The current code calls connectivity.runOpenAIKey unconditionally in the
    // collapsible. That sends an OpenAI chat-completion probe for
    // gemini/codex/claude, which is the wrong endpoint.
    expect(src).toContain('runNativeKey');
    expect(src).not.toContain('onTest={(idx) => void connectivity.runOpenAIKey(idx)}');
  });

  test('ApiKeyEntriesEditor onTestAll uses runNativeAllKeys for native brands', () => {
    expect(src).toContain('runNativeAllKeys');
    expect(src).not.toContain('onTestAll={() => void connectivity.runOpenAIAllKeys()}');
  });

  test('BaseProviderForm passes cloak/rebuildMidSystemMessage/disableImageGeneration to useConnectivityTest', () => {
    // These props control probe payloads; without them the probe ignores
    // provider-specific settings.
    expect(src).toMatch(/cloak:\s*form\.cloak/);
    expect(src).toMatch(/rebuildMidSystemMessage:\s*form\.rebuildMidSystemMessage/);
    expect(src).toMatch(/disableImageGeneration:\s*form\.disableImageGeneration/);
  });

  test('BaseProviderForm defines buildCodexDraft and buildOpenAIDraft callbacks', () => {
    expect(src).toMatch(/buildCodexDraft/);
    expect(src).toMatch(/buildOpenAIDraft/);
  });

  test('BaseProviderForm passes openAISettingsSignature for OpenAI retrieval probes', () => {
    expect(src).toMatch(/openAISettingsSignature/);
  });
});

/* ------------------------------------------------------------------ */
/* serializeProviderKey/serializeGeminiKey preserve config.name        */
/* ------------------------------------------------------------------ */
describe('native provider name serialization roundtrip', () => {
  test('createCodexConfig emits name field to the V8 wire format', async () => {
    const b = backend('codex');
    await providersApi.createCodexConfig({
      apiKey: 'fixture',
      name: 'My Codex Provider',
      baseUrl: 'https://example.test',
    });
    const created = key(b.groups()[0]);
    expect(created.name).toBe('My Codex Provider');
  });

  test('createGeminiKey emits name field to the V8 wire format', async () => {
    const b = backend('gemini');
    await providersApi.createGeminiKey({
      apiKey: 'fixture',
      name: 'My Gemini Provider',
      baseUrl: 'https://example.test',
    });
    const created = key(b.groups()[0]);
    expect(created.name).toBe('My Gemini Provider');
  });

  test('createClaudeConfig emits name field to the V8 wire format', async () => {
    const b = backend('claude');
    await providersApi.createClaudeConfig({
      apiKey: 'fixture',
      name: 'My Claude Provider',
      baseUrl: 'https://example.test',
    });
    const created = key(b.groups()[0]);
    expect(created.name).toBe('My Claude Provider');
  });

  test('updateCodexConfig preserves a renamed name through the roundtrip', async () => {
    const group = {
      name: 'team',
      keys: [{ 'api-key': 'fixture', name: 'original-name' }],
    };
    const b = backend('codex', [group]);
    const [existing] = rows(b.groups());
    await providersApi.updateCodexConfig(existing.apiKey, undefined, {
      ...existing,
      name: 'renamed-provider',
    });
    const savedKey = key(b.groups()[0]);
    expect(savedKey.name).toBe('renamed-provider');
  });
});

/* ------------------------------------------------------------------ */
/* upstream V8 row with group.name but no key.name: form gets fallback  */
/* ------------------------------------------------------------------ */
describe('upstream V8 group.name fallback for UI editing', () => {
  test('normalizeProviderGroups preserves group.name when key has no own name', () => {
    const group = {
      name: 'upstream-group',
      keys: [{ 'api-key': 'fixture' }],
    };
    const [row] = rows([group]);
    expect(row.name).toBe('upstream-group');
  });

  test('normalizeProviderGroups preserves per-key name override when key has its own name', () => {
    const group = {
      name: 'upstream-group',
      keys: [{ 'api-key': 'fixture', name: 'per-key-name' }],
    };
    const [row] = rows([group]);
    expect(row.name).toBe('per-key-name');
  });

  test('upstream single-key edit with group.name fallback retains raw hidden fields', async () => {
    const group = {
      name: 'upstream-group',
      'base-url': 'https://example.test',
      priority: 5,
      headers: { 'X-Group-Only': 'group-value' },
      keys: [
        { 'api-key': 'fixture', weight: 3, future: 'keep', 'disable-cooling': true },
      ],
    };
    const b = backend('codex', [group]);
    const [existing] = rows(b.groups());
    // Simulate a form edit that changes only weight.
    await providersApi.updateCodexConfig(existing.apiKey, undefined, {
      ...existing,
      weight: 7,
    });
    const savedKey = key(b.groups()[0]);
    expect(savedKey.weight).toBe(7);
    expect(savedKey.future).toBe('keep');
    expect(savedKey['disable-cooling']).toBe(true);
    // Group-level fields are preserved on the group, not moved to the key.
    expect(b.groups()[0]['base-url']).toBe('https://example.test');
    expect(b.groups()[0].priority).toBe(5);
    expect(b.groups()[0].headers).toEqual({ 'X-Group-Only': 'group-value' });
  });
});
