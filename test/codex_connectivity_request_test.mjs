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
