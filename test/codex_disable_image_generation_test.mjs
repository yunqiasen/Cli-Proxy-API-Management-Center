import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  normalizeNativeProviderPayload,
  serializeNativeProviderPayload,
} from '../src/services/api/nativeProviderContracts.ts';
import {
  buildNativeProviderConfig,
  buildNativeProviderFormInput,
} from '../src/features/providers/nativeProviderForm.ts';

test('round-trips the Codex provider disable image generation wire field', () => {
  const config = normalizeNativeProviderPayload({
    name: 'relay',
    'api-key': 'key',
    'base-url': 'https://relay.example/v1',
    'disable-image-generation': true,
  });

  assert.ok(config);
  assert.equal(config.disableImageGeneration, true);
  assert.equal(serializeNativeProviderPayload(config)['disable-image-generation'], true);
});

test('loads and saves the Codex provider disable image generation form field', () => {
  const existing = {
    name: 'relay',
    apiKey: 'key',
    baseUrl: 'https://relay.example/v1',
    disableImageGeneration: true,
  };

  const form = buildNativeProviderFormInput('codex', existing);
  assert.equal(form.disableImageGeneration, true);

  const saved = buildNativeProviderConfig('codex', form, existing);
  assert.equal(saved.disableImageGeneration, true);
});

test('defaults the Codex provider disable image generation form field to false', () => {
  const form = buildNativeProviderFormInput('codex', {
    apiKey: 'key',
    baseUrl: 'https://relay.example/v1',
  });
  assert.equal(form.disableImageGeneration, false);
});

test('marks the Codex wire field as managed so turning the switch off removes stale config', async () => {
  const source = await readFile(
    new URL('../src/services/api/providers.ts', import.meta.url),
    'utf8'
  );
  const codexFields = source.match(/const CODEX_KEY_FIELDS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';

  assert.match(codexFields, /'disable-image-generation'/);
});
