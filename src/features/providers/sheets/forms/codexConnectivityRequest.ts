export interface CodexConnectivityRequest {
  headers: Record<string, string>;
  body: {
    instructions: string;
    stream: false;
    reasoning: {
      effort: 'medium';
      summary: 'auto';
    };
    parallel_tool_calls: true;
    include: ['reasoning.encrypted_content'];
    model: string;
    input: Array<{
      type: 'message';
      role: 'user';
      content: Array<{ type: 'input_text'; text: string }>;
    }>;
    store: false;
    tools: [];
    prompt_cache_key: string;
  };
}

export function createCodexConnectivityRequest(
  model: string,
  headers: Record<string, string>,
  createSessionId: () => string = () => globalThis.crypto.randomUUID()
): CodexConnectivityRequest {
  const sessionId = createSessionId();
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'session_id')
  );

  return {
    headers: {
      ...normalizedHeaders,
      Session_id: sessionId,
    },
    body: {
      instructions: '',
      stream: false,
      reasoning: {
        effort: 'medium',
        summary: 'auto',
      },
      parallel_tool_calls: true,
      include: ['reasoning.encrypted_content'],
      model,
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
    },
  };
}
