/** AI provider configuration contracts. */

export type ProviderPolicyField = 'disable-cooling' | 'request-retry' | 'request-scoped-errors';

export interface RequestScopedErrorRule {
  status?: number;
  match?: string[];
  matchRegex?: string[];
  action?: 'stop' | 'stop-and-cooldown' | 'continue' | 'continue-and-cooldown';
}

export interface ProviderBehaviorOptions {
  alphaSearch?: boolean;
  disableCodexCloaking?: boolean;
  rebuildMidSystemMessage?: boolean;
  supportPromptCacheKey?: boolean;
}

export interface ProviderRuntimePolicy {
  requestRetry?: number;
  requestScopedErrors?: RequestScopedErrorRule[];
  /** Explicit form intent: remove the local override, preserving an untouched null. */
  inheritFields?: ProviderPolicyField[];
}

/** Persisted v8 identity. Never derive a group from its endpoint or credential. */
export interface ProviderSource {
  groups?: unknown[];
  groupIndex: number;
  keyIndex?: number;
  group: Record<string, unknown>;
}

export interface ModelAlias {
  /** Persisted model position; null marks a new form row. Never sent to the backend. */
  sourceIndex?: number | null;
  wireExtras?: Record<string, unknown>;
  name: string;
  alias?: string;
  priority?: number;
  testModel?: string;
  image?: boolean;
  displayName?: string;
  maxContextLength?: number;
  forceMapping?: boolean;
  isCompat?: boolean;
  supportConfigurationUpdate?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
  useMaxCompletionTokens?: boolean;
  type?: 'embeddings' | 'rerank';
  upstreamPath?: string;
  thinking?: Record<string, unknown>;
}

export interface ApiKeyEntry {
  sourceIndex?: number;
  apiKey: string;
  proxyUrl?: string;
  weight?: number;
  authIndex?: string;
}

export interface NativeApiKeyEntry {
  apiKey: string;
  priority?: number;
  weight?: number;
  proxyUrl?: string;
  authIndex?: string;
}

export interface CloakConfig {
  mode?: string;
  strictMode?: boolean;
  sensitiveWords?: string[];
  cacheUserId?: boolean;
}

export interface GeminiKeyConfig extends ProviderRuntimePolicy {
  source?: ProviderSource;
  wireExtras?: Record<string, unknown>;
  name?: string;
  apiKey: string;
  apiKeyEntries?: NativeApiKeyEntry[];
  priority?: number;
  weight?: number;
  prefix?: string;
  baseUrl?: string;
  proxyUrl?: string;
  models?: ModelAlias[];
  headers?: Record<string, string>;
  excludedModels?: string[];
  disableCooling?: boolean;
  authIndex?: string;
}

export interface ProviderKeyConfig extends ProviderRuntimePolicy, ProviderBehaviorOptions {
  source?: ProviderSource;
  wireExtras?: Record<string, unknown>;
  name?: string;
  apiKey: string;
  apiKeyEntries?: NativeApiKeyEntry[];
  priority?: number;
  weight?: number;
  prefix?: string;
  baseUrl?: string;
  websockets?: boolean;
  proxyUrl?: string;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  excludedModels?: string[];
  disableCooling?: boolean;
  disableImageGeneration?: boolean;
  responsesFirstOutputTimeoutSeconds?: number;
  cloak?: CloakConfig;
  fingerprintProfile?: string;
  experimentalCchSigning?: boolean;
  rebuildMidSystemMessage?: boolean;
  authIndex?: string;
}

export interface OpenAIProviderConfig extends ProviderRuntimePolicy, ProviderBehaviorOptions {
  source?: ProviderSource;
  wireExtras?: Record<string, unknown>;
  name: string;
  prefix?: string;
  baseUrl: string;
  apiKeyEntries: ApiKeyEntry[];
  disabled?: boolean;
  headers?: Record<string, string>;
  models?: ModelAlias[];
  priority?: number;
  testModel?: string;
  disableCooling?: boolean;
  authIndex?: string;
  /** Original index in the backend openai-compatibility array. */
  sourceIndex?: number;
  [key: string]: unknown;
}

export type MediaKind = 'image' | 'video' | 'audio';
export type MediaRequestFormat = 'json' | 'multipart' | 'binary';
export type MediaModelMode = 'required' | 'optional' | 'none';
export type MediaResponseFormat = 'passthrough' | 'json-url' | 'json-base64' | 'binary';

export interface MediaApiKeyEntry {
  apiKey: string;
  priority?: number;
  proxyUrl?: string;
  authIndex?: string;
}

export interface MediaModelConfig {
  name: string;
  alias?: string;
  displayName?: string;
  forceMapping?: boolean;
  capabilities: string[];
}

export interface MediaAsyncOperationConfig {
  taskIdPath: string;
  pollMethod?: string;
  pollPath: string;
  statusPath: string;
  successValues: string[];
  failureValues?: string[];
  resultPath?: string;
  pollInterval?: string;
}

export interface MediaTestRequestConfig {
  json?: string;
  multipartFields?: Record<string, string>;
  [key: string]: unknown;
}

export interface MediaOperationConfig {
  name: string;
  capability?: string;
  method: string;
  path: string;
  requestFormat: MediaRequestFormat;
  modelMode: MediaModelMode;
  model?: string;
  responseFormat: MediaResponseFormat;
  resultPath?: string;
  testRequest?: MediaTestRequestConfig;
  async?: MediaAsyncOperationConfig;
}

export interface MediaProviderConfig {
  name: string;
  kind: MediaKind;
  baseUrl: string;
  priority?: number;
  disabled?: boolean;
  disableCooling?: boolean;
  prefix?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  apiKeyEntries: MediaApiKeyEntry[];
  headers?: Record<string, string>;
  models?: MediaModelConfig[];
  operations?: MediaOperationConfig[];
  authIndex?: string;
  sourceIndex?: number;
  [key: string]: unknown;
}
