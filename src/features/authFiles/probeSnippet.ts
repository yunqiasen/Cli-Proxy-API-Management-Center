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
