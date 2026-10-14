import type { MediaKind } from '../../types/provider.ts';
import type { ApiKeyEntryInput, MediaOperationInput, ModelEntryInput } from './types.ts';
export { getMediaGatewayPath } from '../../services/api/mediaProviderConnectivity.ts';

const primaryOperationNames = ['generate', 'speech', 'text-to-video', 'transcribe'];

const operationKey = (operation: MediaOperationInput | undefined): string =>
  (operation?.capability || operation?.name || '').trim().toLowerCase();

export const clampMediaTestOperationIndex = (index: number, operationCount: number): number =>
  operationCount > 0 ? Math.min(Math.max(index, 0), operationCount - 1) : 0;

export interface MediaConnectivityResultGuard {
  begin: (signature: string) => number;
  invalidate: () => void;
  isCurrent: (requestID: number, signature: string) => boolean;
}

export const createMediaConnectivityResultGuard = (): MediaConnectivityResultGuard => {
  let currentRequestID = 0;
  let currentSignature = '';
  return {
    begin(signature) {
      currentRequestID += 1;
      currentSignature = signature;
      return currentRequestID;
    },
    invalidate() {
      currentRequestID += 1;
      currentSignature = '';
    },
    isCurrent(requestID, signature) {
      return requestID === currentRequestID && signature === currentSignature;
    },
  };
};

export interface MediaConnectivityResultGuardMap {
  guardFor: (key: string) => MediaConnectivityResultGuard;
  invalidateAll: () => void;
}

export const createMediaConnectivityResultGuardMap = (): MediaConnectivityResultGuardMap => {
  const guards = new Map<string, MediaConnectivityResultGuard>();
  return {
    guardFor(key) {
      const normalizedKey = key.trim();
      let guard = guards.get(normalizedKey);
      if (!guard) {
        guard = createMediaConnectivityResultGuard();
        guards.set(normalizedKey, guard);
      }
      return guard;
    },
    invalidateAll() {
      guards.forEach((guard) => guard.invalidate());
      guards.clear();
    },
  };
};

export interface MediaConnectivityTestSignatureInput {
  baseUrl: string;
  prefix?: string;
  adapter?: string;
  models?: ModelEntryInput[];
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  headers: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  operation?: MediaOperationInput;
  model: string;
}

export const mediaConnectivityTestSignature = (
  input: MediaConnectivityTestSignatureInput
): string =>
  JSON.stringify({
    baseUrl: input.baseUrl.trim(),
    prefix: input.prefix?.trim() ?? '',
    adapter: input.adapter ?? '',
    models: input.models,
    apiKeyHeader: input.apiKeyHeader?.trim() ?? '',
    apiKeyPrefix: input.apiKeyPrefix?.trim() ?? '',
    headers: input.headers.map((header) => ({ key: header.key.trim(), value: header.value })),
    apiKeyEntries: (input.apiKeyEntries ?? []).map((entry) => ({
      apiKey: entry.apiKey.trim(),
      existingApiKey: entry.existingApiKey?.trim() ?? '',
      proxyUrl: entry.proxyUrl?.trim() ?? '',
      authIndex: entry.authIndex?.trim() ?? '',
    })),
    operation: input.operation ?? null,
    model: input.model.trim(),
  });

export const getDefaultMediaTestOperationIndex = (operations: MediaOperationInput[]): number => {
  if (!operations.length) return 0;
  const index = operations.findIndex((operation) =>
    primaryOperationNames.includes(operationKey(operation))
  );
  return index >= 0 ? index : 0;
};

export const getMediaTestModelOptions = (
  operation: MediaOperationInput | undefined,
  models: ModelEntryInput[]
): ModelEntryInput[] => {
  if (operation?.modelMode === 'none') return [];
  const fixedModel = operation?.model.trim() ?? '';
  if (fixedModel) {
    return models.filter(
      (model) => model.name.trim() === fixedModel || (model.alias ?? '').trim() === fixedModel
    );
  }
  const capability = operationKey(operation);
  return models.filter((model) => {
    if (!model.name.trim()) return false;
    const capabilities = model.capabilities ?? [];
    return (
      !capability ||
      capabilities.length === 0 ||
      capabilities.some((item) => item.toLowerCase() === capability)
    );
  });
};

export const resolveMediaTestModels = (
  operation: MediaOperationInput | undefined,
  models: ModelEntryInput[],
  selectedModel: string,
  prefix = ''
): { upstreamModel: string; gatewayModel: string } => {
  if (operation?.modelMode === 'none') return { upstreamModel: '', gatewayModel: '' };
  const publicModel = (model: string) =>
    prefix.trim() && model ? `${prefix.trim().replace(/\/+$/, '')}/${model}` : model;
  const candidates = getMediaTestModelOptions(operation, models);
  const requested = operation?.model.trim() || selectedModel.trim() || '';
  const selected =
    candidates.find(
      (model) => model.name.trim() === requested || (model.alias ?? '').trim() === requested
    ) ?? candidates[0];
  if (selected) {
    const upstreamModel = selected.name.trim();
    return {
      upstreamModel,
      gatewayModel: publicModel((selected.alias ?? '').trim() || upstreamModel),
    };
  }
  return { upstreamModel: requested, gatewayModel: publicModel(requested) };
};

export const describeMediaTestModel = (model: ModelEntryInput): string => {
  const name = model.name.trim();
  const alias = (model.alias ?? '').trim();
  return alias && alias !== name ? `${alias} · ${name}` : name;
};

export const mediaTestOperationLabel = (operation: MediaOperationInput): string =>
  `${operation.name || operation.capability || 'operation'} · ${operation.method || 'POST'}`;

export type { MediaKind };
