import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexConnectivityRequest } from '../src/features/providers/sheets/forms/codexConnectivityRequest.ts';

test('builds an AnyRouter-compatible Codex probe with one consistent session id', () => {
  const sessionId = '2de11c22-39b1-4c99-a72b-e8f22f1bba1a';

  const request = createCodexConnectivityRequest(
    'gpt-5.6-sol',
    {
      Authorization: 'Bearer test-token',
      'X-Custom': 'kept',
      session_id: 'stale-session',
    },
    () => sessionId
  );

  assert.deepEqual(request.headers, {
    Authorization: 'Bearer test-token',
    'X-Custom': 'kept',
    'User-Agent':
      'codex-tui/0.135.0 (Mac OS 26.5.0; arm64) iTerm.app/3.6.10 (codex-tui; 0.135.0)',
    Session_id: sessionId,
  });
  assert.deepEqual(request.body, {
    instructions: '',
    stream: false,
    reasoning: {
      effort: 'medium',
      summary: 'auto',
    },
    parallel_tool_calls: true,
    include: ['reasoning.encrypted_content'],
    model: 'gpt-5.6-sol',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hi' }],
      },
    ],
    store: false,
    tools: [],
    prompt_cache_key: sessionId,
  });
});

test('builds a probe when crypto.randomUUID is unavailable on plain HTTP', () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {},
  });

  try {
    const request = createCodexConnectivityRequest('gpt-5.5', {
      Authorization: 'Bearer test-token',
    });

    assert.match(
      request.headers.Session_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    assert.equal(request.body.prompt_cache_key, request.headers.Session_id);
  } finally {
    if (cryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
});

test('adds a Codex User-Agent for management API probes and preserves explicit overrides', () => {
  const sessionId = '7fd11267-2dc1-45e1-9f0f-e37d08a0d75e';
  const defaultRequest = createCodexConnectivityRequest(
    'gpt-5.5',
    { Authorization: 'Bearer test-token' },
    () => sessionId
  );
  const customRequest = createCodexConnectivityRequest(
    'gpt-5.5',
    {
      Authorization: 'Bearer test-token',
      'user-agent': 'custom-codex-client/1.0',
    },
    () => sessionId
  );

  assert.match(defaultRequest.headers['User-Agent'], /^codex-tui\//);
  assert.equal(customRequest.headers['user-agent'], 'custom-codex-client/1.0');
  assert.equal(
    Object.keys(customRequest.headers).filter((name) => name.toLowerCase() === 'user-agent').length,
    1
  );
});
