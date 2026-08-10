import type { ProviderBrand, ProviderGroup } from './types';

const GENERAL_PAGE_HIDDEN_BRANDS = new Set<ProviderBrand>([
  'apikeyFun',
  'image',
  'video',
  'audio',
]);

export function getVisibleProviderGroups<T extends Pick<ProviderGroup, 'id'>>(
  groups: T[],
  fixedBrand?: ProviderBrand
): T[] {
  return fixedBrand
    ? groups.filter((group) => group.id === fixedBrand)
    : groups.filter((group) => !GENERAL_PAGE_HIDDEN_BRANDS.has(group.id));
}
