import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const nativeContracts = await import('../src/services/api/nativeProviderContracts.ts');

const endpointCases = [
  ['getGeminiKeys', 'gemini'],
  ['getInteractionsKeys', 'interactions'],
  ['getCodexConfigs', 'codex'],
  ['getXAIConfigs', 'xai'],
  ['getClaudeConfigs', 'claude'],
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

test('native provider API readers use V8 grouped configuration endpoints', async () => {
  const source = await readFile(
    new URL('../src/services/api/providers.ts', import.meta.url),
    'utf8'
  );
  for (const [method, family] of endpointCases) {
    assert.ok(source.includes(`async ${method}()`));
    assert.ok(source.includes(`normalizeProviderGroups(await getGroups('${family}'))`));
  }
  assert.ok(source.includes('`/config/api-keys/${family}`'));
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
