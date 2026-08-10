import type { MediaKind } from '@/types';
import type { MediaOperationInput, ModelEntryInput, ProviderEntryFormInput } from './types';

export const MEDIA_CAPABILITIES_BY_KIND: Record<MediaKind, readonly string[]> = {
  image: ['generate', 'edit', 'upscale', 'super-resolution', 'remove-background'],
  video: ['generate', 'text-to-video', 'image-to-video', 'remove-watermark'],
  audio: ['generate', 'speech', 'music', 'clone', 'voice-convert', 'transcribe'],
};

export type MediaProviderFormValidationCode =
  | 'nameRequired'
  | 'baseUrlRequired'
  | 'operationNameRequired'
  | 'operationPathRequired'
  | 'operationCapabilityInvalid'
  | 'operationModelRequired'
  | 'operationResultPathRequired'
  | 'operationAsyncIncomplete';

export interface MediaProviderFormValidationIssue {
  code: MediaProviderFormValidationCode;
  operationIndex?: number;
}

type MediaProviderFormValidationInput = Pick<
  ProviderEntryFormInput,
  'name' | 'baseUrl' | 'models' | 'operations'
>;

const text = (value: unknown): string => String(value ?? '').trim();

const operationIsBlank = (operation: MediaOperationInput): boolean =>
  !text(operation.name) &&
  !text(operation.capability) &&
  !text(operation.path) &&
  !text(operation.model) &&
  !text(operation.resultPath) &&
  !operation.asyncEnabled;

const operationCapability = (
  operation: MediaOperationInput,
  allowedCapabilities: readonly string[]
): string => {
  const explicit = text(operation.capability).toLowerCase().replace(/_/g, '-');
  if (explicit) return explicit;
  const name = text(operation.name).toLowerCase().replace(/_/g, '-');
  return allowedCapabilities.includes(name) ? name : '';
};

const hasCompatibleModel = (
  models: ModelEntryInput[],
  capability: string,
  fixedModel: string
): boolean => {
  if (fixedModel) return true;
  return models.some((model) => {
    if (!text(model.name)) return false;
    const capabilities = (model.capabilities ?? [])
      .map((item) => text(item).toLowerCase().replace(/_/g, '-'))
      .filter(Boolean);
    return !capability || capabilities.length === 0 || capabilities.includes(capability);
  });
};

export function validateMediaProviderFormInput(
  input: MediaProviderFormValidationInput,
  kind: MediaKind
): MediaProviderFormValidationIssue | null {
  if (!text(input.name)) return { code: 'nameRequired' };
  if (!text(input.baseUrl)) return { code: 'baseUrlRequired' };

  const allowedCapabilities = MEDIA_CAPABILITIES_BY_KIND[kind];
  const models = input.models ?? [];
  for (const [operationIndex, operation] of (input.operations ?? []).entries()) {
    if (operationIsBlank(operation)) continue;
    if (!text(operation.name)) return { code: 'operationNameRequired', operationIndex };
    if (!text(operation.path)) return { code: 'operationPathRequired', operationIndex };

    const explicitCapability = text(operation.capability).toLowerCase().replace(/_/g, '-');
    if (explicitCapability && !allowedCapabilities.includes(explicitCapability)) {
      return { code: 'operationCapabilityInvalid', operationIndex };
    }
    const capability = operationCapability(operation, allowedCapabilities);
    if (
      operation.modelMode === 'required' &&
      !hasCompatibleModel(models, capability, text(operation.model))
    ) {
      return { code: 'operationModelRequired', operationIndex };
    }

    const normalizesJSON =
      operation.responseFormat === 'json-url' || operation.responseFormat === 'json-base64';
    const hasResultPath =
      Boolean(text(operation.resultPath)) ||
      (operation.asyncEnabled && Boolean(text(operation.asyncResultPath)));
    if (normalizesJSON && !hasResultPath) {
      return { code: 'operationResultPathRequired', operationIndex };
    }

    if (
      operation.asyncEnabled &&
      (!text(operation.taskIdPath) ||
        !text(operation.pollPath) ||
        !text(operation.statusPath) ||
        !text(operation.successValuesText))
    ) {
      return { code: 'operationAsyncIncomplete', operationIndex };
    }
  }
  return null;
}
