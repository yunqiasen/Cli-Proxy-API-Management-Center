import type { ProviderBrand } from './types.ts';

export function getNativeProviderUsageIdentity(
  brand: ProviderBrand,
  configuredName: string | null | undefined
): string {
  const name = String(configuredName ?? '').trim();
  if (
    name &&
    (brand === 'gemini' ||
      brand === 'codex' ||
      brand === 'claude' ||
      brand === 'image' ||
      brand === 'video' ||
      brand === 'audio')
  )
    return name;
  return brand === 'claudeApi' ? 'claude' : brand;
}
