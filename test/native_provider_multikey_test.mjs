import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeNativeProviderPayload,
  serializeNativeProviderPayload,
} from '../src/services/api/nativeProviderContracts.ts';
import { buildNativeProviderResourceData } from '../src/features/providers/nativeProviderResource.ts';
import { getNativeProviderUsageIdentity } from '../src/features/providers/nativeProviderUsageIdentity.ts';
import { aggregateProviderUsageByApiKeys } from '../src/components/providers/providerUsageAggregation.ts';
import {
  buildNativeProviderConfig,
  buildNativeProviderFormInput,
  validateNativeProviderKeyEntries,
} from '../src/features/providers/nativeProviderForm.ts';

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

test('keeps an untouched legacy native provider in legacy form', () => {
  const existing = {
    apiKey: 'legacy-key',
    priority: 8,
    proxyUrl: 'http://provider-proxy',
    cloak: { mode: 'always', strictMode: true },
    experimentalCchSigning: true,
    rebuildMidSystemMessage: true,
  };
  const form = buildNativeProviderFormInput('claude', existing);
  const saved = buildNativeProviderConfig('claude', form, existing);

  assert.equal(form.apiKeyEntries.length, 1);
  assert.equal(form.apiKeyEntries[0].existingApiKey, 'legacy-key');
  assert.equal(saved.apiKey, 'legacy-key');
  assert.equal(saved.apiKeyEntries, undefined);
  assert.deepEqual(saved.cloak, existing.cloak);
  assert.equal(saved.experimentalCchSigning, true);
  assert.equal(saved.rebuildMidSystemMessage, true);
});

test('emits grouped entries after adding a provider name or second key', () => {
  const existing = { apiKey: 'legacy-key', priority: 8, proxyUrl: 'http://provider-proxy' };
  const namedForm = { ...buildNativeProviderFormInput('codex', existing), name: 'relay-a' };
  const named = buildNativeProviderConfig('codex', namedForm, existing);
  assert.equal(named.apiKey, 'legacy-key');
  assert.deepEqual(named.apiKeyEntries, [{ apiKey: 'legacy-key' }]);

  const multiForm = buildNativeProviderFormInput('codex', existing);
  multiForm.apiKeyEntries.push({ apiKey: 'key-b', proxyUrl: 'http://key-proxy', priority: 0 });
  const multi = buildNativeProviderConfig('codex', multiForm, existing);
  assert.deepEqual(multi.apiKeyEntries, [
    { apiKey: 'legacy-key' },
    { apiKey: 'key-b', priority: 0, proxyUrl: 'http://key-proxy' },
  ]);
});

test('uses the configured native provider name for usage lookups', () => {
  assert.equal(getNativeProviderUsageIdentity('codex', 'AnyRouter'), 'AnyRouter');
  assert.equal(getNativeProviderUsageIdentity('claude', '  Claude Relay  '), 'Claude Relay');
  assert.equal(getNativeProviderUsageIdentity('gemini', ''), 'gemini');
});

test('rejects duplicate native provider secrets', () => {
  assert.equal(
    validateNativeProviderKeyEntries([
      { apiKey: 'same-key', proxyUrl: '' },
      { apiKey: ' same-key ', proxyUrl: '' },
    ]),
    'duplicate-api-key'
  );
});

test('preserves Claude, Codex, and Gemini protocol fields through form conversion', () => {
  const claude = {
    apiKey: '',
    name: 'claude-relay',
    apiKeyEntries: [{ apiKey: 'claude-a' }],
    cloak: { mode: 'auto', cacheUserId: true },
    experimentalCchSigning: true,
    rebuildMidSystemMessage: true,
  };
  const codex = {
    apiKey: '',
    name: 'codex-relay',
    apiKeyEntries: [{ apiKey: 'codex-a' }],
    websockets: true,
  };
  const gemini = {
    apiKey: '',
    name: 'gemini-relay',
    apiKeyEntries: [{ apiKey: 'gemini-a' }],
    disableCooling: true,
    headers: { 'X-Test': 'kept' },
  };

  const claudeSaved = buildNativeProviderConfig(
    'claude',
    buildNativeProviderFormInput('claude', claude),
    claude
  );
  const codexSaved = buildNativeProviderConfig(
    'codex',
    buildNativeProviderFormInput('codex', codex),
    codex
  );
  const geminiSaved = buildNativeProviderConfig(
    'gemini',
    buildNativeProviderFormInput('gemini', gemini),
    gemini
  );

  assert.deepEqual(claudeSaved.cloak, claude.cloak);
  assert.equal(claudeSaved.experimentalCchSigning, true);
  assert.equal(claudeSaved.rebuildMidSystemMessage, true);
  assert.equal(codexSaved.websockets, true);
  assert.equal(geminiSaved.disableCooling, true);
  assert.deepEqual(geminiSaved.headers, { 'X-Test': 'kept' });
});

test('aggregates every native provider key for totals, status, details, and recent sorting', () => {
  const lookedUpKeys = [];
  const usageByKey = new Map([
    [
      'key-a',
      {
        success: 2,
        failed: 1,
        recentRequests: [{ success: 1, failed: 1 }],
        successDetails: [{ model: 'model-a', status: 200, count: 2 }],
        failureDetails: [{ model: 'model-a', status: 500, count: 1, error: 'upstream-a' }],
      },
    ],
    [
      'key-b',
      {
        success: 5,
        failed: 3,
        recentRequests: [{ success: 4, failed: 2 }],
        successDetails: [{ model: 'model-a', status: 200, count: 5 }],
        failureDetails: [{ model: 'model-b', status: 429, count: 3, error: 'rate-limit' }],
      },
    ],
  ]);

  const summary = aggregateProviderUsageByApiKeys(['key-a', 'key-b'], (apiKey) => {
    lookedUpKeys.push(apiKey);
    return usageByKey.get(apiKey);
  });

  assert.deepEqual(lookedUpKeys, ['key-a', 'key-b']);
  assert.deepEqual(summary.totalStats, { success: 7, failure: 4 });
  assert.deepEqual(summary.recentWindowStats, { success: 5, failure: 3 });
  assert.equal(summary.statusData.totalSuccess, 5);
  assert.equal(summary.statusData.totalFailure, 3);
  assert.deepEqual(summary.usageDetails.successDetails, [
    { model: 'model-a', status: 200, count: 7 },
  ]);
  assert.deepEqual(summary.usageDetails.failureDetails, [
    { model: 'model-b', status: 429, count: 3, error: 'rate-limit' },
    { model: 'model-a', status: 500, count: 1, error: 'upstream-a' },
  ]);
});
