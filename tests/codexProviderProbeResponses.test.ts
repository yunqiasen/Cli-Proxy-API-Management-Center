import { expect, test } from 'bun:test';
import { simulateCodexProvider } from '@/features/providers/codexProviderProbe';
import { normalizeProviderConnectivityResult } from '@/services/api/providerConnectivityRequest';

const messages = {
  baseUrlRequired: 'base-url-required',
  endpointInvalid: 'endpoint-invalid',
  apiKeyRequired: 'api-key-required',
  modelRequired: 'model-required',
  requestFailed: 'request-failed',
};

const completedResponse = {
  id: 'resp_probe',
  object: 'response',
  status: 'completed',
  error: null,
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello!' }],
    },
  ],
};

const createdEvent = {
  type: 'response.created',
  response: { id: 'resp_probe', status: 'in_progress', output: [] },
};
const completedEvent = { type: 'response.completed', response: completedResponse };
const sse = (...events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

const probe = (body: string, statusCode = 200) =>
  simulateCodexProvider(
    {
      apiKey: 'fixture-key',
      baseUrl: 'https://relay.example/v1',
      models: [{ name: 'gpt-upstream', alias: 'cpa-model' }],
    },
    messages,
    {
      request: async () =>
        normalizeProviderConnectivityResult({
          status_code: statusCode,
          header: { 'Content-Type': ['text/event-stream'] },
          body,
        }),
    }
  );

test('accepts a completed SSE response from the management connectivity endpoint', async () => {
  const result = await probe(sse(createdEvent, completedEvent));

  expect(result.state).toBe('success');
  expect(result.successCount).toBe(1);
  expect(result.failureCount).toBe(0);
  expect(result.entries[0]?.statusCode).toBe(200);
  expect(result.message).toBe('');
});

test.each([
  ['error', { type: 'error', message: 'upstream overloaded' }],
  [
    'failed',
    {
      type: 'response.failed',
      response: { status: 'failed', error: { message: 'upstream overloaded' } },
    },
  ],
])('reports the actual %s event instead of dumping SSE into the error label', async (_, event) => {
  const result = await probe(sse(createdEvent, event));

  expect(result.state).toBe('error');
  expect(result.message).toBe('200 upstream overloaded');
});

test('does not hide an upstream failure after a completed event', async () => {
  const result = await probe(
    sse(completedEvent, { type: 'error', error: { message: 'upstream overloaded' } })
  );

  expect(result.state).toBe('error');
  expect(result.message).toBe('200 upstream overloaded');
});

test.each([
  ['only lifecycle frames', sse(createdEvent)],
  ['partial text', sse(createdEvent, { type: 'response.output_text.delta', delta: 'Hello' })],
  ['only the DONE marker', 'data: [DONE]\n\n'],
  ['malformed completion', 'data: {"type":"response.completed"}\n\n'],
])('does not report %s as a completed probe', async (_, body) => {
  const result = await probe(body);

  expect(result.state).toBe('error');
  expect(result.message).toBe('200 request-failed');
});

test('does not accept an incomplete response inside a completed envelope', async () => {
  const result = await probe(
    sse({
      type: 'response.completed',
      response: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      },
    })
  );

  expect(result.state).toBe('error');
  expect(result.message).toBe('200 max_output_tokens');
});

test('keeps HTTP 200 JSON error bodies as failures', async () => {
  const result = await probe(JSON.stringify({ error: { message: 'upstream overloaded' } }));

  expect(result.state).toBe('error');
  expect(result.message).toBe('200 upstream overloaded');
});

test.each([
  ['legacy JSON', JSON.stringify(completedResponse)],
  ['a DONE suffix', `${sse(createdEvent, completedEvent)}data: [DONE]\n\n`],
  ['no trailing delimiter', sse(completedEvent).trimEnd()],
  ['a UTF-8 BOM', `\uFEFF${sse(completedEvent)}`],
  ['an empty keepalive', `data:\n\n${sse(completedEvent)}`],
  [
    'named events, comments, CRLF and multiline data',
    [
      ': heartbeat',
      '',
      'event: response.completed',
      'data: {',
      `data: "response":${JSON.stringify(completedResponse)}`,
      'data: }',
      '',
      '',
    ].join('\r\n'),
  ],
])('accepts completion with %s', async (_, body) => {
  const result = await probe(body);

  expect(result.state).toBe('success');
  expect(result.message).toBe('');
});

test.each([
  ['non-2xx status', sse(completedEvent), 503],
  ['HTML', '<html>blocked</html>', 200],
  ['empty body', '', 200],
  ['a JSON array', '[]', 200],
  ['a non-object completion', 'data: {"type":"response.completed","response":[]}\n\n', 200],
  ['malformed data after completion', `${sse(completedEvent)}data: {\n\n`, 200],
  [
    'a failed completion',
    sse({
      type: 'response.completed',
      response: { status: 'failed', error: { message: 'generation failed' } },
    }),
    200,
  ],
])('keeps %s as a failure', async (_, body, statusCode) => {
  const result = await probe(body, statusCode);

  expect(result.state).toBe('error');
  expect(result.successCount).toBe(0);
});

test.each(['response.incomplete', 'response.cancelled'])(
  'reports %s without waiting for a success marker',
  async (type) => {
    const result = await probe(
      sse({ type, response: { incomplete_details: { reason: 'generation stopped' } } })
    );

    expect(result.state).toBe('error');
    expect(result.message).toBe('200 generation stopped');
  }
);

test('preserves independent results for grouped keys with different stream outcomes', async () => {
  const result = await simulateCodexProvider(
    {
      apiKey: '',
      baseUrl: 'https://relay.example/v1',
      models: [{ name: 'gpt-upstream', alias: 'cpa-model' }],
      apiKeyEntries: [
        { apiKey: 'key-a', authIndex: 'auth-a' },
        { apiKey: 'key-b', authIndex: 'auth-b' },
      ],
    },
    messages,
    {
      testAll: true,
      request: async (request) =>
        normalizeProviderConnectivityResult({
          status_code: 200,
          body:
            request.authIndex === 'auth-a'
              ? sse(createdEvent, completedEvent)
              : sse(createdEvent, { type: 'error', message: 'key-b failed' }),
        }),
    }
  );

  expect(result.state).toBe('error');
  expect(result.successCount).toBe(1);
  expect(result.failureCount).toBe(1);
  expect(result.entries.map(({ index, state }) => ({ index, state }))).toEqual([
    { index: 0, state: 'success' },
    { index: 1, state: 'error' },
  ]);
  expect(result.message).toBe('200 key-b failed');
});

test.each([
  ['error event', { type: 'error', message: 'generation failed' }],
  [
    'failed event',
    {
      type: 'response.failed',
      response: { status: 'failed', error: { message: 'generation failed' } },
    },
  ],
  ['lifecycle event', createdEvent],
  ['unfinished completion', { type: 'response.completed', response: { status: 'in_progress' } }],
  ['missing completion body', { type: 'response.completed' }],
])('keeps a standalone JSON %s as a failure', async (_, event) => {
  const result = await probe(JSON.stringify(event));

  expect(result.state).toBe('error');
  expect(result.successCount).toBe(0);
});

test('accepts a standalone JSON completed event', async () => {
  const result = await probe(JSON.stringify(completedEvent));

  expect(result.state).toBe('success');
  expect(result.message).toBe('');
});

test('does not hide an explicit named error behind a completed data type', async () => {
  const result = await probe(`event: error\ndata: ${JSON.stringify(completedEvent)}\n\n`);

  expect(result.state).toBe('error');
  expect(result.successCount).toBe(0);
});

test('keeps the legacy xAI raw transport statusless-response behavior separate', async () => {
  const statusless: Record<string, unknown> = { ...completedResponse };
  delete statusless.status;
  for (const body of [statusless, sse({ type: 'response.completed', response: statusless })]) {
    const result = await simulateCodexProvider(
      { apiKey: 'fixture', baseUrl: 'https://xai.example/v1', models: [{ name: 'grok-fixture' }] },
      messages,
      {
        requireCompleted: false,
        request: async () => ({ statusCode: 200, headers: {}, body }),
      }
    );
    expect(result.state).toBe('success');
  }
});
