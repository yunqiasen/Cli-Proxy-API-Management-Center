import type { GeminiKeyConfig, ProviderKeyConfig } from '../../types/provider.ts';

export interface NativeProviderResourceData {
  identifier: string;
  name: string | null;
  apiKeys: string[];
  keyPreviews: string[];
  keyCount: number;
  searchTerms: string[];
  selector: { index: number; name?: string };
}

export function buildNativeProviderResourceData(
  config: GeminiKeyConfig | ProviderKeyConfig,
  index: number,
  maskApiKey: (value: string) => string
): NativeProviderResourceData {
  const groupedKeys = (config.apiKeyEntries ?? [])
    .map((entry) => entry.apiKey.trim())
    .filter(Boolean);
  const apiKeys = groupedKeys.length ? groupedKeys : [config.apiKey.trim()].filter(Boolean);
  const keyPreviews = apiKeys.map(maskApiKey).filter(Boolean);
  // A name inherited from the V8 group for display is not a per-key selector
  // name. The backend matches updates/deletes by API key, not by display name.
  const keyOwnName = config.source?.group && typeof config.source.group.name === 'string'
    ? ''  // group fallback: don't treat as selector name
    : config.name?.trim() || '';
  const displayName = config.name?.trim() || '';
  const identifier = displayName || keyPreviews[0] || `#${index + 1}`;
  const searchTerms = Array.from(new Set([displayName, ...apiKeys, ...keyPreviews].filter(Boolean)));
  return {
    identifier,
    name: displayName || null,
    apiKeys,
    keyPreviews,
    keyCount: apiKeys.length,
    searchTerms,
    selector: { index, ...(keyOwnName ? { name: keyOwnName } : {}) },
  };
}
