import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const nativeContracts = await import('../src/services/api/nativeProviderContracts.ts');

const endpointCases = [
  ['getGeminiKeys', '/gemini-api-key', 'gemini-api-key'],
  ['getInteractionsKeys', '/interactions-api-key', 'interactions-api-key'],
  ['getCodexConfigs', '/codex-api-key', 'codex-api-key'],
  ['getXAIConfigs', '/xai-api-key', 'xai-api-key'],
  ['getClaudeConfigs', '/claude-api-key', 'claude-api-key'],
];

test('normalizes management-projected native provider auth indexes', () => {
  assert.equal(typeof nativeContracts.normalizeNativeProviderSectionPayload, 'function');

  const configs = nativeContracts.normalizeNativeProviderSectionPayload(
    {
      'claude-api-key': [
        {
          name: 'AgentRouter',
          'api-key': 'legacy-key',
          weight: 3,
          'api-key-entries': [{ 'api-key': 'key-a', 'auth-index': 'b81877460dc81152' }],
          'auth-index': '72fbe49d20267e16',
        },
      ],
    },
    'claude-api-key'
  );

  assert.equal(configs.length, 1);
  assert.equal(configs[0].weight, 3);
  assert.equal(configs[0].apiKeyEntries?.[0]?.authIndex, 'b81877460dc81152');
  assert.equal(configs[0].authIndex, '72fbe49d20267e16');
});

test('native provider API readers use dedicated management endpoints', async () => {
  const source = await readFile(
    new URL('../src/services/api/providers.ts', import.meta.url),
    'utf8'
  );

  for (const [method, path, section] of endpointCases) {
    assert.match(source, new RegExp(`async ${method}\\(\\)`));
    assert.match(source, new RegExp(`apiClient\\.get\\('${path}'\\)`));
    assert.match(
      source,
      new RegExp(`normalizeNativeProviderSectionPayload\\([^)]*, '${section}'\\)`)
    );
  }
});

test('provider workbench refresh overlays every native provider section from dedicated endpoints', async () => {
  const source = await readFile(
    new URL('../src/features/providers/useProviderWorkbench.ts', import.meta.url),
    'utf8'
  );
  const start = source.indexOf('const refetch = useCallback');
  const end = source.indexOf('const refreshSnapshot = useCallback', start);
  const refetch = source.slice(start, end);

  assert.match(refetch, /providersApi\.getGeminiKeys\(\)/);
  assert.match(refetch, /providersApi\.getInteractionsKeys\(\)/);
  assert.match(refetch, /providersApi\.getCodexConfigs\(\)/);
  assert.match(refetch, /providersApi\.getXAIConfigs\(\)/);
  assert.match(refetch, /providersApi\.getClaudeConfigs\(\)/);
  assert.match(refetch, /updateConfigValue\('gemini-api-key'/);
  assert.match(refetch, /updateConfigValue\('interactions-api-key'/);
  assert.match(refetch, /updateConfigValue\('codex-api-key'/);
  assert.match(refetch, /updateConfigValue\('xai-api-key'/);
  assert.match(refetch, /updateConfigValue\('claude-api-key'/);
});
