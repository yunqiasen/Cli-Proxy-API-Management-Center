import { describe, expect, test } from 'bun:test';
import { summarizeProbeResult } from '../src/features/authFiles/probeSnippet';

describe('probe result snippet', () => {
  test('shows the model reply excerpt on success', () => {
    const snippet = summarizeProbeResult({
      ok: true,
      status: 200,
      model: 'sn-kimi-k3',
      text: 'ok',
      body: '{"choices":[{"message":{"content":"ok"}}]}',
    });
    expect(snippet).toBe('ok');
  });

  test('falls back to body content when text is empty', () => {
    const snippet = summarizeProbeResult({
      ok: true,
      status: 200,
      model: 'sn-sensenova-6-8-flash',
      text: '',
      body: '{"choices":[{"message":{"content":"  你好   世界 "}}]}',
    });
    expect(snippet).toBe('你好 世界');
  });

  test('shows the upstream error reason on failure', () => {
    const snippet = summarizeProbeResult({
      ok: false,
      status: 403,
      model: 'glm-5.3-flash',
      error: '{"error":{"message":"该渠道不允许当前客户端使用"}}',
      body: '{"error":{"message":"该渠道不允许当前客户端使用"}}',
    });
    expect(snippet).toBe('该渠道不允许当前客户端使用');
  });

  test('truncates long replies and stays empty without a payload', () => {
    const snippet = summarizeProbeResult(
      { ok: true, status: 200, model: 'm', text: 'a'.repeat(400) },
      20
    );
    expect(snippet.length).toBe(21);
    expect(snippet.endsWith('…')).toBe(true);
    expect(summarizeProbeResult(undefined)).toBe('');
  });
});
