import assert from 'node:assert/strict';
import test from 'node:test';
import { requestLogProviderLabel } from '../src/features/requestLogs/requestLogLabels.ts';

test('shows the configured provider name for media request logs', () => {
  assert.equal(
    requestLogProviderLabel({ provider: 'Cloudflare 文生图', channel_model: 'Cloudflare 文生图' }),
    'Cloudflare 文生图'
  );
});

test('uses a readable fallback when a legacy request log has no provider field', () => {
  assert.equal(
    requestLogProviderLabel({ provider: '', channel_model: 'Legacy Relay / model-x' }),
    'Legacy Relay'
  );
  assert.equal(requestLogProviderLabel({ provider: '', channel_model: 'legacy-model-only' }), '—');
  assert.equal(requestLogProviderLabel({}), '—');
});

test('shows model-free media requests without duplicating the provider name', async () => {
  const { requestLogModelLabel } = await import(
    '../src/features/requestLogs/requestLogLabels.ts'
  );
  assert.equal(
    requestLogModelLabel({
      model: '',
      upstream_model: '',
      channel_model: 'Noiz 语音',
      provider: 'Noiz 语音',
    }),
    '无需模型'
  );
  assert.equal(
    requestLogModelLabel({
      model: 'cf-flux-schnell',
      upstream_model: '@cf/black-forest-labs/flux-1-schnell',
      provider: 'Cloudflare 文生图',
    }),
    'cf-flux-schnell'
  );
});
