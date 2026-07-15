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
  const name = config.name?.trim() || '';
  const identifier = name || keyPreviews[0] || `#${index + 1}`;
  const searchTerms = Array.from(new Set([name, ...apiKeys, ...keyPreviews].filter(Boolean)));
  return {
    identifier,
    name: name || null,
    apiKeys,
    keyPreviews,
    keyCount: apiKeys.length,
    searchTerms,
    selector: { index, ...(name ? { name } : {}) },
  };
}
