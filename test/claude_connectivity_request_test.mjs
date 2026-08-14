import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  aggregateClaudeConnectivityStatuses,
  buildClaudeProviderConnectivityPayload,
  normalizeProviderConnectivityResult,
  resolveClaudeConnectivityCredential,
} from '../src/services/api/providerConnectivityRequest.ts';

test('builds a pinned Claude executor probe with unsaved form overrides', () => {
  assert.deepEqual(
    buildClaudeProviderConnectivityPayload({
      authIndex: 'claude-auth-index',
      model: 'claude-opus-test',
      apiKey: 'new-key',
      baseUrl: 'https://agentrouter.example',
      proxyUrl: 'http://proxy.example:8080',
      headers: { 'X-AgentRouter-Probe': 'enabled' },
      cloak: {
        mode: 'always',
        strictMode: true,
        sensitiveWords: ['alpha'],
        cacheUserId: true,
      },
      rebuildMidSystemMessage: true,
    }),
    {
      provider: 'claude',
      auth_index: 'claude-auth-index',
      model: 'claude-opus-test',
      api_key: 'new-key',
      base_url: 'https://agentrouter.example',
      proxy_url: 'http://proxy.example:8080',
      header: { 'X-AgentRouter-Probe': 'enabled' },
      cloak: {
        mode: 'always',
        strict_mode: true,
        sensitive_words: ['alpha'],
        cache_user_id: true,
      },
      rebuild_mid_system_message: true,
    }
  );
});

test('normalizes the management executor response like the existing API call helper', () => {
  assert.deepEqual(
    normalizeProviderConnectivityResult({
      status_code: 403,
      header: { 'Content-Type': ['application/json'] },
      body: '{"error":{"message":"client restricted"}}',
    }),
    {
      statusCode: 403,
      header: { 'Content-Type': ['application/json'] },
      bodyText: '{"error":{"message":"client restricted"}}',
      body: { error: { message: 'client restricted' } },
    }
  );
});

test('Claude test button uses the CPA executor endpoint instead of direct api-call', async () => {
  const source = await readFile(
    new URL('../src/features/providers/sheets/forms/useConnectivityTest.ts', import.meta.url),
    'utf8'
  );
  const start = source.indexOf('const runClaude = useCallback');
  const end = source.indexOf('const runNativeKey = useCallback', start);
  const runClaude = source.slice(start, end);

  assert.match(runClaude, /providerConnectivityApi\.requestClaude/);
  assert.doesNotMatch(runClaude, /apiCallApi\.request/);
  assert.doesNotMatch(runClaude, /buildClaudeMessagesEndpoint/);
});

test('keeps a selected Claude key row isolated from first-row fallbacks', () => {
  assert.deepEqual(
    resolveClaudeConnectivityCredential({
      entryIndex: 1,
      apiKeyEntries: [
        {
          apiKey: '',
          existingApiKey: 'first-key',
          authIndex: 'first-auth',
          proxyUrl: 'first-proxy',
        },
        { apiKey: '', existingApiKey: '', authIndex: '', proxyUrl: '' },
      ],
      apiKey: 'first-key',
      fallbackApiKey: 'first-key',
      authIndex: 'first-auth',
      proxyUrl: 'first-proxy',
    }),
    {
      explicitKey: '',
      persistedKey: '',
      resolvedKey: '',
      resolvedAuthIndex: undefined,
      resolvedProxyUrl: 'first-proxy',
    }
  );
});

test('uses the selected Claude row own persisted key and proxy', () => {
  assert.deepEqual(
    resolveClaudeConnectivityCredential({
      entryIndex: 1,
      apiKeyEntries: [
        {
          apiKey: '',
          existingApiKey: 'first-key',
          authIndex: 'first-auth',
          proxyUrl: 'first-proxy',
        },
        { apiKey: '', existingApiKey: 'second-key', authIndex: '', proxyUrl: 'second-proxy' },
      ],
      apiKey: 'first-key',
      fallbackApiKey: 'first-key',
      authIndex: 'first-auth',
      proxyUrl: 'first-proxy',
    }),
    {
      explicitKey: '',
      persistedKey: 'second-key',
      resolvedKey: 'second-key',
      resolvedAuthIndex: undefined,
      resolvedProxyUrl: 'second-proxy',
    }
  );
});

test('aggregates Claude all-key results only after every row settles', () => {
  assert.deepEqual(
    aggregateClaudeConnectivityStatuses([
      { state: 'success', message: '' },
      { state: 'error', message: '403 quota exhausted' },
    ]),
    { state: 'error', message: '403 quota exhausted' }
  );
  assert.deepEqual(
    aggregateClaudeConnectivityStatuses([
      { state: 'success', message: '' },
      { state: 'success', message: '' },
    ]),
    { state: 'success', message: '' }
  );
});

test('Claude row validation updates the row and batch mode suppresses per-request global writes', async () => {
  const source = await readFile(
    new URL('../src/features/providers/sheets/forms/useConnectivityTest.ts', import.meta.url),
    'utf8'
  );
  const start = source.indexOf('const runClaude = useCallback');
  const end = source.indexOf('const runNativeKey = useCallback', start);
  const runClaude = source.slice(start, end);

  assert.match(runClaude, /updateGlobal/);
  assert.match(runClaude, /updateOpenaiStatus\(entryIndex, failure\)/);
  assert.match(runClaude, /resolveClaudeConnectivityCredential/);
  assert.match(source, /runClaude\(idx, false\)/);
  assert.match(source, /aggregateClaudeConnectivityStatuses/);
});
