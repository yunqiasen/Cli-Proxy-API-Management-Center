import type { MediaProviderConfig, MediaOperationConfig } from '@/types';
import type { MediaOperationInput, ProviderEntryFormInput } from './types';
import { mergeEditedMediaProviderConfig } from '@/services/api/mediaProviderContracts';
import { headersFromEntries } from './providerFormSerialization';

const splitMediaText = (value: string): string[] =>
  value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const emptyMediaOperation = (): MediaOperationInput => ({
  name: '',
  capability: '',
  method: 'POST',
  path: '',
  requestFormat: 'json',
  modelMode: 'optional',
  model: '',
  responseFormat: 'passthrough',
  resultPath: '',
  testRequestJson: '',
  testRequestMultipartFieldsText: '',
  asyncEnabled: false,
  taskIdPath: '',
  pollMethod: 'GET',
  pollPath: '',
  statusPath: '',
  successValuesText: 'completed',
  failureValuesText: 'failed',
  asyncResultPath: '',
  pollInterval: '3s',
});

export const buildMediaProviderFormInput = (
  brand: 'image' | 'video' | 'audio',
  config?: MediaProviderConfig | null
): ProviderEntryFormInput => ({
  apiKey: '',
  name: config?.name ?? '',
  baseUrl: config?.baseUrl ?? '',
  proxyUrl: config?.apiKeyEntries?.[0]?.proxyUrl ?? '',
  prefix: config?.prefix ?? '',
  apiKeyHeader: config?.apiKeyHeader ?? '',
  apiKeyPrefix: config?.apiKeyPrefix ?? '',
  disabled: config?.disabled === true,
  disableCooling: config?.disableCooling === true,
  priority: config?.priority,
  mediaKind: brand,
  headers: config?.headers
    ? Object.entries(config.headers).map(([key, value]) => ({ key, value: String(value) }))
    : [{ key: '', value: '' }],
  excludedModelsText: '',
  models: config?.models?.length
    ? config.models.map((model) => ({
        name: model.name,
        alias: model.alias ?? '',
        displayName: model.displayName ?? '',
        forceMapping: model.forceMapping === true,
        capabilities: [...(model.capabilities ?? [])],
      }))
    : [{ name: '', alias: '', capabilities: [] }],
  operations: config?.operations?.length
    ? config.operations.map((operation) => ({
        name: operation.name,
        capability: operation.capability ?? '',
        method: operation.method,
        path: operation.path,
        requestFormat: operation.requestFormat,
        modelMode: operation.modelMode,
        model: operation.model ?? '',
        responseFormat: operation.responseFormat,
        resultPath: operation.resultPath ?? '',
        testRequestJson: operation.testRequest?.json ?? '',
        testRequestMultipartFieldsText: Object.entries(operation.testRequest?.multipartFields ?? {})
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
        asyncEnabled: Boolean(operation.async),
        taskIdPath: operation.async?.taskIdPath ?? '',
        pollMethod: operation.async?.pollMethod ?? 'GET',
        pollPath: operation.async?.pollPath ?? '',
        statusPath: operation.async?.statusPath ?? '',
        successValuesText: operation.async?.successValues?.join('\n') ?? 'completed',
        failureValuesText: operation.async?.failureValues?.join('\n') ?? 'failed',
        asyncResultPath: operation.async?.resultPath ?? '',
        pollInterval: operation.async?.pollInterval ?? '3s',
      }))
    : [emptyMediaOperation()],
  apiKeyEntries: config?.apiKeyEntries?.length
    ? config.apiKeyEntries.map((entry) => ({
        apiKey: '',
        existingApiKey: entry.apiKey,
        priority: entry.priority,
        proxyUrl: entry.proxyUrl ?? '',
        authIndex: entry.authIndex,
      }))
    : [{ apiKey: '', proxyUrl: '', authIndex: config?.authIndex }],
  testModel: '',
  cloak: undefined,
});

export const buildMediaProviderConfig = (
  brand: 'image' | 'video' | 'audio',
  input: ProviderEntryFormInput,
  existing?: MediaProviderConfig | null
): MediaProviderConfig => {
  const apiKeyEntries = (input.apiKeyEntries ?? [])
    .map((entry, index) => ({
      apiKey:
        entry.apiKey.trim() ||
        entry.existingApiKey?.trim() ||
        existing?.apiKeyEntries?.[index]?.apiKey?.trim() ||
        '',
      priority: entry.priority,
      proxyUrl: entry.proxyUrl.trim() || undefined,
      authIndex: entry.authIndex,
    }))
    .filter((entry) => entry.apiKey);
  const headers = headersFromEntries(input.headers);
  const models = (input.models ?? [])
    .map((model) => ({
      name: model.name.trim(),
      alias: model.alias?.trim() || undefined,
      displayName: model.displayName?.trim() || undefined,
      forceMapping: model.forceMapping === true || undefined,
      capabilities: (model.capabilities ?? []).map((item) => item.trim()).filter(Boolean),
    }))
    .filter((model) => model.name);
  const operations = (input.operations ?? [])
    .map((operation) => {
      const result: MediaOperationConfig = {
        name: operation.name.trim(),
        capability: operation.capability.trim() || undefined,
        method: operation.method.trim().toUpperCase() || 'POST',
        path: operation.path.trim(),
        requestFormat: operation.requestFormat,
        modelMode: operation.modelMode,
        model: operation.modelMode === 'none' ? undefined : operation.model.trim() || undefined,
        responseFormat: operation.responseFormat,
        resultPath: operation.resultPath.trim() || undefined,
      };
      const testRequestJson = operation.testRequestJson.trim();
      const multipartFields = Object.fromEntries(
        splitMediaText(operation.testRequestMultipartFieldsText).flatMap((line) => {
          const separator = line.indexOf('=');
          if (separator <= 0) return [];
          return [[line.slice(0, separator).trim(), line.slice(separator + 1)]];
        })
      );
      if (testRequestJson || Object.keys(multipartFields).length) {
        result.testRequest = {
          ...(testRequestJson ? { json: testRequestJson } : {}),
          ...(Object.keys(multipartFields).length ? { multipartFields } : {}),
        };
      }
      if (operation.asyncEnabled) {
        result.async = {
          taskIdPath: operation.taskIdPath.trim(),
          pollMethod: operation.pollMethod.trim().toUpperCase() || 'GET',
          pollPath: operation.pollPath.trim(),
          statusPath: operation.statusPath.trim(),
          successValues: splitMediaText(operation.successValuesText),
          failureValues: splitMediaText(operation.failureValuesText),
          resultPath: operation.asyncResultPath.trim() || undefined,
          pollInterval: operation.pollInterval.trim() || undefined,
        };
      }
      return result;
    })
    .filter((operation) => operation.name && operation.path);
  const providerAuthIndex =
    apiKeyEntries.length === 0
      ? input.apiKeyEntries?.find((entry) => entry.authIndex?.trim())?.authIndex?.trim() ||
        existing?.authIndex
      : undefined;
  return mergeEditedMediaProviderConfig(existing, {
    ...(existing ?? {}),
    name: input.name.trim(),
    kind: brand,
    baseUrl: input.baseUrl.trim(),
    priority: input.priority,
    disabled: input.disabled,
    disableCooling: input.disableCooling === true,
    prefix: input.prefix.trim() || undefined,
    apiKeyHeader: input.apiKeyHeader?.trim() || undefined,
    apiKeyPrefix:
      input.apiKeyPrefix !== undefined && input.apiKeyPrefix.trim() !== ''
        ? input.apiKeyPrefix.trim()
        : undefined,
    authIndex: providerAuthIndex,
    apiKeyEntries,
    headers: Object.keys(headers).length ? headers : undefined,
    models: models.length ? models : undefined,
    operations: operations.length ? operations : undefined,
  });
};
