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
  getProviderApiKeysTotalStats,
  getProviderTotalStats,
} from '../src/components/providers/utils.ts';
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
      { 'api-key': ' key-a ', priority: 0, weight: 3, 'auth-index': 'auth-a' },
      { 'api-key': 'key-b', priority: 20, weight: 0, 'proxy-url': 'http://key-proxy' },
    ],
    websockets: true,
    'disable-image-generation': true,
    models: [
      {
        name: 'gpt-5.6',
        alias: 'codex-main',
        thinking: { min: 128, max: 8192, dynamic_allowed: true },
      },
    ],
  });

  assert.ok(config);
  assert.equal(config.name, 'relay-a');
  assert.equal(config.apiKey, 'legacy-key');
  assert.equal(config.apiKeyEntries?.[0]?.priority, 0);
  assert.equal(config.apiKeyEntries?.[0]?.authIndex, 'auth-a');
  assert.equal(config.apiKeyEntries?.[0]?.weight, 3);
  assert.equal(config.apiKeyEntries?.[1]?.weight, 0);
  assert.equal(config.apiKeyEntries?.[1]?.proxyUrl, 'http://key-proxy');
  assert.equal(config.websockets, true);
  assert.equal(config.disableImageGeneration, true);
  assert.equal(config.models?.[0]?.alias, 'codex-main');
  assert.deepEqual(config.models?.[0]?.thinking, { min: 128, max: 8192, dynamic_allowed: true });

  assert.deepEqual(serializeNativeProviderPayload(config), {
    name: 'relay-a',
    'api-key': 'legacy-key',
    priority: 7,
    'proxy-url': 'http://provider-proxy',
    websockets: true,
    'disable-image-generation': true,
    'api-key-entries': [
      { 'api-key': 'key-a', priority: 0, weight: 3, 'auth-index': 'auth-a' },
      { 'api-key': 'key-b', priority: 20, weight: 0, 'proxy-url': 'http://key-proxy' },
    ],
    models: [
      {
        name: 'gpt-5.6',
        alias: 'codex-main',
        thinking: { min: 128, max: 8192, dynamic_allowed: true },
      },
    ],
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
    disableImageGeneration: true,
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
  assert.equal(codexSaved.disableImageGeneration, true);
  assert.equal(geminiSaved.disableCooling, true);
  assert.deepEqual(geminiSaved.headers, { 'X-Test': 'kept' });
});


test('preserves native model thinking through untouched form edits', () => {
  const existing = {
    apiKey: '',
    name: 'codex-relay',
    apiKeyEntries: [{ apiKey: 'codex-a' }],
    models: [
      {
        name: 'gpt-5.6',
        alias: 'codex-main',
        thinking: { min: 128, max: 8192, dynamic_allowed: true },
      },
    ],
  };

  const form = buildNativeProviderFormInput('codex', existing);
  assert.deepEqual(form.models[0].thinkingLevels, ['auto']);
  assert.match(form.models[0].thinkingJson, /"dynamic_allowed": true/);

  const saved = buildNativeProviderConfig('codex', form, existing);
  assert.deepEqual(saved.models?.[0]?.thinking, existing.models[0].thinking);
});

test('switches a legacy native provider to grouped keys for a per-key weight', () => {
  const existing = { apiKey: 'legacy-key' };
  const form = buildNativeProviderFormInput('gemini', existing);
  form.apiKeyEntries[0].weight = 5;

  const saved = buildNativeProviderConfig('gemini', form, existing);
  assert.deepEqual(saved.apiKeyEntries, [{ apiKey: 'legacy-key', weight: 5 }]);
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

test('adds provider-level unassigned history once without assigning it to a specific key', () => {
  const providerBucket = new Map([
    [
      'https://relay.example/v1|first-key',
      {
        success: 0,
        failed: 0,
        recentRequests: [],
        successDetails: [],
        failureDetails: [],
      },
    ],
    [
      'https://relay.example/v1|second-key',
      {
        success: 0,
        failed: 0,
        recentRequests: [],
        successDetails: [],
        failureDetails: [],
      },
    ],
    [
      'https://relay.example/v1|',
      {
        success: 8,
        failed: 1,
        recentRequests: [{ success: 8, failed: 1 }],
        successDetails: [{ model: 'claude-history', status: 200, count: 8 }],
        failureDetails: [
          { model: 'claude-history', status: 502, count: 1, error: 'fixture failure' },
        ],
      },
    ],
  ]);

  const summary = aggregateProviderUsageByApiKeys(
    ['first-key', 'second-key'],
    (apiKey) => providerBucket.get(`https://relay.example/v1|${apiKey}`),
    () => providerBucket.get('https://relay.example/v1|')
  );

  assert.deepEqual(summary.totalStats, { success: 8, failure: 1 });
  assert.deepEqual(summary.recentWindowStats, { success: 8, failure: 1 });
  assert.deepEqual(summary.usageDetails.successDetails, [
    { model: 'claude-history', status: 200, count: 8 },
  ]);

  assert.deepEqual(
    aggregateProviderUsageByApiKeys(['first-key'], (apiKey) =>
      providerBucket.get(`https://relay.example/v1|${apiKey}`)
    ).totalStats,
    { success: 0, failure: 0 }
  );
});

test('does not double count a public no-key provider bucket as unassigned history', () => {
  const publicEntry = {
    success: 2,
    failed: 1,
    recentRequests: [],
    successDetails: [],
    failureDetails: [],
  };
  const summary = aggregateProviderUsageByApiKeys(
    [''],
    () => publicEntry,
    () => publicEntry
  );
  assert.deepEqual(summary.totalStats, { success: 2, failure: 1 });
});


test('keeps unassigned provider history when concrete keys also have usage', () => {
  const usageByProvider = new Map([
    [
      'relay a',
      new Map([
        [
          'https://relay.example/v1|first-key',
          {
            success: 2,
            failed: 0,
            recentRequests: [],
            successDetails: [],
            failureDetails: [],
          },
        ],
        [
          'https://relay.example/v1|second-key',
          {
            success: 0,
            failed: 0,
            recentRequests: [],
            successDetails: [],
            failureDetails: [],
          },
        ],
        [
          'https://relay.example/v1|',
          {
            success: 8,
            failed: 1,
            recentRequests: [],
            successDetails: [],
            failureDetails: [],
          },
        ],
      ]),
    ],
  ]);

  assert.deepEqual(
    getProviderApiKeysTotalStats(
      usageByProvider,
      'Relay A',
      ['first-key', 'second-key'],
      'https://relay.example/v1'
    ),
    { success: 10, failure: 1 }
  );
  assert.deepEqual(
    getProviderTotalStats(
      usageByProvider,
      'Relay A',
      'first-key',
      'https://relay.example/v1'
    ),
    { success: 2, failure: 0 }
  );
});
