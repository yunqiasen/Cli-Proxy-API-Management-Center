import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildCodexProviderConnectivityPayload } from '../src/services/api/providerConnectivityRequest.ts';

test('builds a CPA Codex connectivity payload with the provider ImageGen override', () => {
  assert.deepEqual(
    buildCodexProviderConnectivityPayload({
      authIndex: 'codex-auth-index',
      model: 'public-codex',
      apiKey: 'new-key',
      baseUrl: 'https://relay.example/v1',
      proxyUrl: 'http://proxy.example:8080',
      headers: { 'X-Custom': 'kept' },
      disableImageGeneration: true,
    }),
    {
      provider: 'codex',
      auth_index: 'codex-auth-index',
      model: 'public-codex',
      api_key: 'new-key',
      base_url: 'https://relay.example/v1',
      proxy_url: 'http://proxy.example:8080',
      header: { 'X-Custom': 'kept' },
      disable_image_generation: true,
    }
  );
});

test('Codex probes use the CPA endpoint while xAI keeps its existing direct probe', async () => {
  const probeSource = await readFile(
    new URL('../src/features/providers/codexProviderProbe.ts', import.meta.url),
    'utf8'
  );
  const hookSource = await readFile(
    new URL('../src/features/providers/sheets/forms/useConnectivityTest.ts', import.meta.url),
    'utf8'
  );

  assert.match(probeSource, /providerConnectivityApi\.requestCodex/);
  assert.match(hookSource, /request:\s*brand === 'xai' \? apiCallApi\.request : undefined/);
  assert.match(hookSource, /apiKey:\s*legacyKey,[\s\S]{0,500}explicitApiKey:[\s\S]{0,800}baseUrl,[\s\S]{0,800}proxyUrl,[\s\S]{0,300}disableImageGeneration/);
});
