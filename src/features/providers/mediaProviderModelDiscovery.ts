import type { ModelInfo } from '@/utils/models';
import type { ModelEntryInput } from './types';

const normalizeIdentity = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

const modelIdentityValues = (model: Pick<ModelInfo, 'name' | 'alias'>): string[] =>
  [normalizeIdentity(model.name), normalizeIdentity(model.alias)].filter(Boolean);

export const modelDiscoveryResultSignature = (models: ModelInfo[]): string =>
  JSON.stringify(
    models.map((model) => [
      normalizeIdentity(model.name),
      normalizeIdentity(model.alias),
      model.displayName ?? '',
      model.description ?? '',
      model.capabilities ?? [],
    ])
  );

export const reconcileModelDiscoverySelection = (
  selected: Set<string>,
  previousResultSignature: string,
  nextResultSignature: string
): Set<string> => (previousResultSignature === nextResultSignature ? selected : new Set<string>());

export function mergeDiscoveredMediaModels(
  existing: ModelEntryInput[],
  incoming: ModelInfo[]
): ModelEntryInput[] {
  const occupied = new Set<string>();
  existing.forEach((entry) => {
    modelIdentityValues(entry).forEach((identity) => occupied.add(identity));
  });

  const next = [...existing];
  incoming.forEach((model) => {
    const name = model.name.trim();
    const alias = (model.alias ?? '').trim();
    const identities = modelIdentityValues({ name, alias });
    if (!name || identities.some((identity) => occupied.has(identity))) return;

    identities.forEach((identity) => occupied.add(identity));
    next.push({
      name,
      alias: alias || undefined,
      displayName: model.displayName?.trim() || undefined,
      capabilities: model.capabilities ?? [],
    });
  });

  return next;
}
