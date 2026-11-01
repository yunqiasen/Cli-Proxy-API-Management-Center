import type { AuthFileModelProbeResult } from '@/services/api/authFiles';

const DEFAULT_SNIPPET_LIMIT = 140;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractContent(body?: string): string {
  const raw = (body ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
      error?: { message?: unknown } | string;
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) return content;
    const legacyText = parsed.choices?.[0]?.text;
    if (typeof legacyText === 'string' && legacyText.trim()) return legacyText;
    const errorMessage =
      typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
    if (typeof errorMessage === 'string' && errorMessage.trim()) return errorMessage;
  } catch {
    return raw;
  }
  return '';
}

/**
 * Compact, human-readable probe summary: the model's actual reply excerpt on
 * success, or the upstream error reason on failure. Full payloads stay out of
 * the UI to avoid noise.
 */
export function summarizeProbeResult(
  result: AuthFileModelProbeResult | undefined,
  limit: number = DEFAULT_SNIPPET_LIMIT
): string {
  if (!result) return '';
  const text = collapseWhitespace(
    (result.ok ? result.text : '') ||
      extractContent(result.body) ||
      extractContent(result.error) ||
      result.error ||
      ''
  );
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Compact one-line meta strip for the probe row: status, latency, finish
 * reason and token usage. Returns an empty string when nothing is known.
 */
export function formatProbeMeta(result: AuthFileModelProbeResult | undefined): string {
  if (!result) return '';
  const parts: string[] = [];
  if (result.status) parts.push(String(result.status));
  if (typeof result.latency_ms === 'number' && result.latency_ms >= 0) {
    parts.push(result.latency_ms >= 1000
      ? `${(result.latency_ms / 1000).toFixed(1)}s`
      : `${result.latency_ms}ms`);
  }
  if (result.finish) parts.push(result.finish);
  const total = result.usage?.total_tokens;
  if (typeof total === 'number' && total > 0) parts.push(`${total} tok`);
  return parts.join(' · ');
}
