import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../src/features/providers/sheets/forms/MediaProviderForm.tsx', import.meta.url),
  'utf8'
);

test('media provider form exposes operation and model selectors for tests', () => {
  assert.match(source, /data-testid="media-test-operation"/);
  assert.match(source, /data-testid="media-test-model"/);
  assert.match(source, /selectedTestOperationIndex/);
  assert.match(source, /selectedTestModel/);
});

test('media provider form runs a saved provider through the CPA public gateway', () => {
  assert.match(source, /buildMediaGatewayConnectivityRequest/);
  assert.match(source, /requestMediaGatewayConnectivity/);
  assert.match(source, /runGatewayTest/);
  assert.match(source, /gatewayApiKey/);
  assert.match(source, /providersPage\.media\.testGateway/);
  assert.match(source, /getMediaConnectivityApplicationError/);
});

test('media provider form copies the standard provider model discovery flow', () => {
  assert.match(source, /useModelDiscovery/);
  assert.match(source, /ModelDiscoveryPanel/);
  assert.match(source, /providersPage\.discovery\.openButton/);
  assert.match(source, /mergeDiscoveredMediaModels/);
});
