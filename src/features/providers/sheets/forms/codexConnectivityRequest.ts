const CODEX_PROBE_USER_AGENT =
  'codex-tui/0.135.0 (Mac OS 26.5.0; arm64) iTerm.app/3.6.10 (codex-tui; 0.135.0)';

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

const createCodexSessionId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const segment = char === 'x' ? value : (value & 0x3) | 0x8;
    return segment.toString(16);
  });
};

export function createCodexConnectivityRequest(
  model: string,
  headers: Record<string, string>,
  createSessionId: () => string = createCodexSessionId
): CodexConnectivityRequest {
  const sessionId = createSessionId();
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'session_id')
  );
  const userAgentHeader = Object.keys(normalizedHeaders).find(
    (name) => name.toLowerCase() === 'user-agent'
  );
  if (!userAgentHeader || !normalizedHeaders[userAgentHeader]?.trim()) {
    if (userAgentHeader) delete normalizedHeaders[userAgentHeader];
    normalizedHeaders['User-Agent'] = CODEX_PROBE_USER_AGENT;
  }

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
