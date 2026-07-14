import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeNativeProviderPayload,
  serializeNativeProviderPayload,
} from '../src/services/api/nativeProviderContracts.ts';
import {
  buildNativeProviderResourceData,
} from '../src/features/providers/nativeProviderResource.ts';

const mask = (value) => `masked:${value}`;

test('normalizes legacy native provider payload without inventing grouped entries', () => {
  const config = normalizeNativeProviderPayload({
    'api-key': ' legacy-key ',
    priority: 8,
    'proxy-url': 'http://provider-proxy',
    'base-url': 'https://claude.example',
    cloak: { mode: 'always', 'strict-mode': true },
    'experimental-cch-signing': true,
    'rebuild-mid-system-message': true,
  });

  assert.ok(config);
  assert.equal(config.apiKey, 'legacy-key');
  assert.equal(config.priority, 8);
  assert.equal(config.proxyUrl, 'http://provider-proxy');
  assert.equal(config.apiKeyEntries, undefined);
  assert.equal(config.cloak?.mode, 'always');
  assert.equal(config.cloak?.strictMode, true);
  assert.equal(config.experimentalCchSigning, true);
  assert.equal(config.rebuildMidSystemMessage, true);

  assert.deepEqual(serializeNativeProviderPayload(config), {
    'api-key': 'legacy-key',
    priority: 8,
    'base-url': 'https://claude.example',
    'proxy-url': 'http://provider-proxy',
    cloak: { mode: 'always', 'strict-mode': true },
    'experimental-cch-signing': true,
    'rebuild-mid-system-message': true,
  });
});

test('normalizes and serializes named grouped native provider keys', () => {
  const config = normalizeNativeProviderPayload({
    name: ' relay-a ',
    'api-key': 'legacy-key',
    priority: 7,
    'proxy-url': 'http://provider-proxy',
    'api-key-entries': [
      { 'api-key': ' key-a ', priority: 0, 'auth-index': 'auth-a' },
      { 'api-key': 'key-b', priority: 20, 'proxy-url': 'http://key-proxy' },
    ],
    websockets: true,
    models: [{ name: 'gpt-5.6', alias: 'codex-main' }],
  });

  assert.ok(config);
  assert.equal(config.name, 'relay-a');
  assert.equal(config.apiKey, 'legacy-key');
  assert.equal(config.apiKeyEntries?.[0]?.priority, 0);
  assert.equal(config.apiKeyEntries?.[0]?.authIndex, 'auth-a');
  assert.equal(config.apiKeyEntries?.[1]?.proxyUrl, 'http://key-proxy');
  assert.equal(config.websockets, true);
  assert.equal(config.models?.[0]?.alias, 'codex-main');

  assert.deepEqual(serializeNativeProviderPayload(config), {
    name: 'relay-a',
    'api-key': 'legacy-key',
    priority: 7,
    'proxy-url': 'http://provider-proxy',
    websockets: true,
    'api-key-entries': [
      { 'api-key': 'key-a', priority: 0 },
      { 'api-key': 'key-b', priority: 20, 'proxy-url': 'http://key-proxy' },
    ],
    models: [{ name: 'gpt-5.6', alias: 'codex-main' }],
  });
});

test('builds grouped native provider identity, key previews, search terms, and selector', () => {
  const data = buildNativeProviderResourceData(
    {
      name: 'relay-a',
      apiKey: 'legacy-key',
      apiKeyEntries: [
        { apiKey: 'key-a', priority: 0 },
        { apiKey: 'key-b', proxyUrl: 'http://key-proxy' },
      ],
    },
    3,
    mask
  );

  assert.equal(data.identifier, 'relay-a');
  assert.equal(data.keyCount, 2);
  assert.deepEqual(data.apiKeys, ['key-a', 'key-b']);
  assert.deepEqual(data.keyPreviews, ['masked:key-a', 'masked:key-b']);
  assert.deepEqual(data.searchTerms, ['relay-a', 'key-a', 'key-b', 'masked:key-a', 'masked:key-b']);
  assert.deepEqual(data.selector, { index: 3, name: 'relay-a' });
});
