import type {
  MediaApiKeyEntry,
  MediaAsyncOperationConfig,
  MediaKind,
  MediaModelConfig,
  MediaOperationConfig,
  MediaProviderConfig,
} from '../../types/provider.ts';

const MEDIA_KINDS = new Set<MediaKind>(['image', 'video', 'audio']);
const MEDIA_CAPABILITIES = new Set([
  'generate',
  'edit',
  'upscale',
  'super-resolution',
  'remove-background',
  'text-to-video',
  'image-to-video',
  'remove-watermark',
  'speech',
  'music',
  'clone',
  'voice-convert',
]);
const MEDIA_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MEDIA_REQUEST_FORMATS = new Set(['json', 'multipart', 'binary']);
const MEDIA_MODEL_MODES = new Set(['required', 'optional', 'none']);
const MEDIA_RESPONSE_FORMATS = new Set(['passthrough', 'json-url', 'json-base64', 'binary']);

const PROVIDER_FIELDS = [
  'name',
  'kind',
  'base-url',
  'baseUrl',
  'priority',
  'disabled',
  'disable-cooling',
  'disableCooling',
  'prefix',
  'api-key-entries',
  'apiKeyEntries',
  'headers',
  'models',
  'operations',
  'auth-index',
  'authIndex',
  'sourceIndex',
] as const;
const KEY_FIELDS = [
  'api-key',
  'apiKey',
  'priority',
  'proxy-url',
  'proxyUrl',
  'auth-index',
  'authIndex',
] as const;
const MODEL_FIELDS = [
  'name',
  'alias',
  'display-name',
  'displayName',
  'force-mapping',
  'forceMapping',
  'capabilities',
] as const;
const OPERATION_FIELDS = [
  'name',
  'capability',
  'method',
  'path',
  'request-format',
  'requestFormat',
  'model-mode',
  'modelMode',
  'model',
  'response-format',
  'responseFormat',
  'result-path',
  'resultPath',
  'async',
] as const;
const ASYNC_FIELDS = [
  'task-id-path',
  'taskIdPath',
  'poll-method',
  'pollMethod',
  'poll-path',
  'pollPath',
  'status-path',
  'statusPath',
  'success-values',
  'successValues',
  'failure-values',
  'failureValues',
  'result-path',
  'resultPath',
  'poll-interval',
  'pollInterval',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const copyUnknownFields = (
  value: unknown,
  knownFields: readonly string[]
): Record<string, unknown> => {
  if (!isRecord(value)) return {};
  const copy = { ...value };
  knownFields.forEach((field) => delete copy[field]);
  return copy;
};

const normalizeString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

const normalizeNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const normalizeStringList = (value: unknown): string[] => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]+/)
      : [];
  const seen = new Set<string>();
  return values.reduce<string[]>((result, item) => {
    const normalized = normalizeString(item);
    const identity = normalized?.toLowerCase();
    if (!normalized || !identity || seen.has(identity)) return result;
    seen.add(identity);
    result.push(normalized);
    return result;
  }, []);
};

const normalizePath = (value: unknown): string | undefined => {
  const normalized = normalizeString(value);
  if (!normalized) return undefined;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const normalizeHeaders = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined;
  const headers: Record<string, string> = {};
  Object.entries(value).forEach(([rawName, rawValue]) => {
    const name = rawName.trim();
    if (!name || rawValue === undefined || rawValue === null) return;
    headers[name] = String(rawValue).trim();
  });
  return Object.keys(headers).length ? headers : undefined;
};

const normalizeMediaKey = (value: unknown): MediaApiKeyEntry | null => {
  if (typeof value === 'string') {
    const apiKey = normalizeString(value);
    return apiKey ? { apiKey } : null;
  }
  if (!isRecord(value)) return null;
  const apiKey = normalizeString(value['api-key'] ?? value.apiKey);
  if (!apiKey) return null;
  const entry: MediaApiKeyEntry = { ...copyUnknownFields(value, KEY_FIELDS), apiKey };
  const priority = normalizeNumber(value.priority);
  if (priority !== undefined) entry.priority = priority;
  const proxyUrl = normalizeString(value['proxy-url'] ?? value.proxyUrl);
  if (proxyUrl) entry.proxyUrl = proxyUrl;
  const authIndex = normalizeString(value['auth-index'] ?? value.authIndex);
  if (authIndex) entry.authIndex = authIndex;
  return entry;
};

const normalizeMediaModel = (value: unknown): MediaModelConfig | null => {
  if (typeof value === 'string') {
    const name = normalizeString(value);
    return name ? { name, capabilities: [] } : null;
  }
  if (!isRecord(value)) return null;
  const name = normalizeString(value.name);
  if (!name) return null;
  const model: MediaModelConfig = {
    ...copyUnknownFields(value, MODEL_FIELDS),
    name,
    capabilities: normalizeStringList(value.capabilities).filter((capability) =>
      MEDIA_CAPABILITIES.has(capability.toLowerCase())
    ),
  };
  const alias = normalizeString(value.alias);
  if (alias) model.alias = alias;
  const displayName = normalizeString(value['display-name'] ?? value.displayName);
  if (displayName) model.displayName = displayName;
  if (value['force-mapping'] === true || value.forceMapping === true) model.forceMapping = true;
  return model;
};

const normalizeMediaAsync = (value: unknown): MediaAsyncOperationConfig | undefined => {
  if (!isRecord(value)) return undefined;
  const taskIdPath = normalizeString(value['task-id-path'] ?? value.taskIdPath);
  const pollPath = normalizePath(value['poll-path'] ?? value.pollPath);
  const statusPath = normalizeString(value['status-path'] ?? value.statusPath);
  const successValues = normalizeStringList(value['success-values'] ?? value.successValues);
  if (!taskIdPath || !pollPath || !statusPath || !successValues.length) return undefined;

  const asyncConfig: MediaAsyncOperationConfig = {
    ...copyUnknownFields(value, ASYNC_FIELDS),
    taskIdPath,
    pollPath,
    statusPath,
    successValues,
  };
  const pollMethod = normalizeString(value['poll-method'] ?? value.pollMethod)?.toUpperCase();
  if (pollMethod && MEDIA_METHODS.has(pollMethod)) asyncConfig.pollMethod = pollMethod;
  const failureValues = normalizeStringList(value['failure-values'] ?? value.failureValues);
  if (failureValues.length) asyncConfig.failureValues = failureValues;
  const resultPath = normalizeString(value['result-path'] ?? value.resultPath);
  if (resultPath) asyncConfig.resultPath = resultPath;
  const pollInterval = normalizeString(value['poll-interval'] ?? value.pollInterval);
  if (pollInterval) asyncConfig.pollInterval = pollInterval;
  return asyncConfig;
};

const normalizeMediaOperation = (value: unknown): MediaOperationConfig | null => {
  if (!isRecord(value)) return null;
  const name = normalizeString(value.name);
  const method = (normalizeString(value.method) ?? 'POST').toUpperCase();
  const path = normalizePath(value.path);
  const requestFormat = normalizeString(
    value['request-format'] ?? value.requestFormat
  )?.toLowerCase();
  const modelMode = normalizeString(value['model-mode'] ?? value.modelMode)?.toLowerCase();
  const responseFormat = normalizeString(
    value['response-format'] ?? value.responseFormat
  )?.toLowerCase();
  if (
    !name ||
    !path ||
    !MEDIA_METHODS.has(method) ||
    !requestFormat ||
    !MEDIA_REQUEST_FORMATS.has(requestFormat) ||
    !modelMode ||
    !MEDIA_MODEL_MODES.has(modelMode) ||
    !responseFormat ||
    !MEDIA_RESPONSE_FORMATS.has(responseFormat)
  ) {
    return null;
  }

  const operation: MediaOperationConfig = {
    ...copyUnknownFields(value, OPERATION_FIELDS),
    name,
    method,
    path,
    requestFormat: requestFormat as MediaOperationConfig['requestFormat'],
    modelMode: modelMode as MediaOperationConfig['modelMode'],
    responseFormat: responseFormat as MediaOperationConfig['responseFormat'],
  };
  const capability = normalizeString(value.capability)?.toLowerCase();
  if (capability && !MEDIA_CAPABILITIES.has(capability)) return null;
  if (capability) operation.capability = capability;
  const model = normalizeString(value.model);
  if (model && modelMode !== 'none') operation.model = model;
  const resultPath = normalizeString(value['result-path'] ?? value.resultPath);
  if (resultPath) operation.resultPath = resultPath;
  const hasAsyncConfig = value.async !== undefined && value.async !== null;
  const asyncConfig = normalizeMediaAsync(value.async);
  if (hasAsyncConfig && !asyncConfig) return null;
  if (asyncConfig) operation.async = asyncConfig;
  if (
    (responseFormat === 'json-url' || responseFormat === 'json-base64') &&
    !resultPath &&
    !asyncConfig?.resultPath
  ) {
    return null;
  }
  return operation;
};

export function normalizeMediaProviderPayload(
  value: unknown,
  sourceIndex?: number
): MediaProviderConfig | null {
  if (!isRecord(value)) return null;
  const name = normalizeString(value.name);
  const kind = normalizeString(value.kind)?.toLowerCase();
  const baseUrl = normalizeString(value['base-url'] ?? value.baseUrl);
  if (!name || !kind || !MEDIA_KINDS.has(kind as MediaKind) || !baseUrl) return null;

  const keyValues = Array.isArray(value['api-key-entries'])
    ? value['api-key-entries']
    : Array.isArray(value.apiKeyEntries)
      ? value.apiKeyEntries
      : [];
  const seenApiKeys = new Set<string>();
  const apiKeyEntries = keyValues
    .map(normalizeMediaKey)
    .filter((entry): entry is MediaApiKeyEntry => {
      if (!entry || seenApiKeys.has(entry.apiKey)) return false;
      seenApiKeys.add(entry.apiKey);
      return true;
    });
  const seenOperationNames = new Set<string>();
  const operations = Array.isArray(value.operations)
    ? value.operations
        .map(normalizeMediaOperation)
        .filter((operation): operation is MediaOperationConfig => {
          if (!operation) return false;
          const identity = operation.name.toLowerCase();
          if (seenOperationNames.has(identity)) return false;
          seenOperationNames.add(identity);
          return true;
        })
    : undefined;
  const provider: MediaProviderConfig = {
    ...copyUnknownFields(value, PROVIDER_FIELDS),
    name,
    kind: kind as MediaKind,
    baseUrl,
    apiKeyEntries,
  };
  if (sourceIndex !== undefined) provider.sourceIndex = sourceIndex;
  const priority = normalizeNumber(value.priority);
  if (priority !== undefined) provider.priority = priority;
  if (typeof value.disabled === 'boolean') provider.disabled = value.disabled;
  const disableCooling = value['disable-cooling'] ?? value.disableCooling;
  if (typeof disableCooling === 'boolean') provider.disableCooling = disableCooling;
  const prefix = normalizeString(value.prefix);
  if (prefix) provider.prefix = prefix;
  const headers = normalizeHeaders(value.headers);
  if (headers) provider.headers = headers;
  if (Array.isArray(value.models)) {
    provider.models = value.models
      .map(normalizeMediaModel)
      .filter((model): model is MediaModelConfig => model !== null);
  }
  if (operations) provider.operations = operations;
  const authIndex = normalizeString(value['auth-index'] ?? value.authIndex);
  if (authIndex) provider.authIndex = authIndex;
  return provider;
}

export interface MediaProviderSerializationOptions {
  includeAuthIndexes?: boolean;
}

const serializeMediaKey = (
  entry: MediaApiKeyEntry,
  options: MediaProviderSerializationOptions
): Record<string, unknown> => {
  const payload = copyUnknownFields(entry, KEY_FIELDS);
  payload['api-key'] = entry.apiKey.trim();
  if (entry.priority !== undefined) payload.priority = entry.priority;
  if (entry.proxyUrl?.trim()) payload['proxy-url'] = entry.proxyUrl.trim();
  if (options.includeAuthIndexes && entry.authIndex?.trim()) {
    payload['auth-index'] = entry.authIndex.trim();
  }
  return payload;
};

const serializeMediaModel = (model: MediaModelConfig): Record<string, unknown> => {
  const payload = copyUnknownFields(model, MODEL_FIELDS);
  payload.name = model.name.trim();
  if (model.alias?.trim()) payload.alias = model.alias.trim();
  if (model.displayName?.trim()) payload['display-name'] = model.displayName.trim();
  if (model.forceMapping) payload['force-mapping'] = true;
  const capabilities = normalizeStringList(model.capabilities).filter((capability) =>
    MEDIA_CAPABILITIES.has(capability.toLowerCase())
  );
  if (capabilities.length) payload.capabilities = capabilities;
  return payload;
};

const serializeMediaAsync = (asyncConfig: MediaAsyncOperationConfig): Record<string, unknown> => {
  const payload = copyUnknownFields(asyncConfig, ASYNC_FIELDS);
  payload['task-id-path'] = asyncConfig.taskIdPath.trim();
  if (asyncConfig.pollMethod?.trim()) {
    payload['poll-method'] = asyncConfig.pollMethod.trim().toUpperCase();
  }
  payload['poll-path'] = asyncConfig.pollPath.trim();
  payload['status-path'] = asyncConfig.statusPath.trim();
  payload['success-values'] = normalizeStringList(asyncConfig.successValues);
  if (asyncConfig.failureValues?.length) {
    payload['failure-values'] = normalizeStringList(asyncConfig.failureValues);
  }
  if (asyncConfig.resultPath?.trim()) payload['result-path'] = asyncConfig.resultPath.trim();
  if (asyncConfig.pollInterval?.trim()) payload['poll-interval'] = asyncConfig.pollInterval.trim();
  return payload;
};

const serializeMediaOperation = (operation: MediaOperationConfig): Record<string, unknown> => {
  const payload = copyUnknownFields(operation, OPERATION_FIELDS);
  payload.name = operation.name.trim();
  if (operation.capability?.trim()) payload.capability = operation.capability.trim();
  payload.method = operation.method.trim().toUpperCase();
  payload.path = operation.path.trim();
  payload['request-format'] = operation.requestFormat;
  payload['model-mode'] = operation.modelMode;
  if (operation.modelMode !== 'none' && operation.model?.trim()) {
    payload.model = operation.model.trim();
  }
  payload['response-format'] = operation.responseFormat;
  if (operation.resultPath?.trim()) payload['result-path'] = operation.resultPath.trim();
  if (operation.async) payload.async = serializeMediaAsync(operation.async);
  return payload;
};

export function serializeMediaProviderPayload(
  provider: MediaProviderConfig,
  options: MediaProviderSerializationOptions = {}
): Record<string, unknown> {
  const payload = copyUnknownFields(provider, PROVIDER_FIELDS);
  payload.name = provider.name.trim();
  payload.kind = provider.kind;
  payload['base-url'] = provider.baseUrl.trim();
  const seenApiKeys = new Set<string>();
  payload['api-key-entries'] = (provider.apiKeyEntries ?? [])
    .filter((entry) => {
      const apiKey = entry.apiKey.trim();
      if (!apiKey || seenApiKeys.has(apiKey)) return false;
      seenApiKeys.add(apiKey);
      return true;
    })
    .map((entry) => serializeMediaKey(entry, options));
  if (options.includeAuthIndexes && provider.authIndex?.trim()) {
    payload['auth-index'] = provider.authIndex.trim();
  }
  if (provider.priority !== undefined) payload.priority = provider.priority;
  if (provider.disabled !== undefined) payload.disabled = provider.disabled;
  if (provider.disableCooling) payload['disable-cooling'] = true;
  if (provider.prefix?.trim()) payload.prefix = provider.prefix.trim();
  if (provider.headers && Object.keys(provider.headers).length) payload.headers = provider.headers;
  if (provider.models?.length) {
    payload.models = provider.models.filter((model) => model.name.trim()).map(serializeMediaModel);
  }
  if (provider.operations?.length) {
    const seenOperationNames = new Set<string>();
    payload.operations = provider.operations
      .filter((operation) => {
        const name = operation.name.trim();
        const identity = name.toLowerCase();
        if (!name || !operation.path.trim() || seenOperationNames.has(identity)) return false;
        seenOperationNames.add(identity);
        return true;
      })
      .map(serializeMediaOperation);
  }
  return payload;
}
