import { apiClient } from './client';
import { LOGS_TIMEOUT_MS } from '@/utils/constants';

export interface RequestLogAttempt {
  index: number;
  provider?: string;
  auth_id?: string;
  model?: string;
  url?: string;
  state: string;
  status?: number;
  error_kind?: string;
}

export interface RequestLogItem {
  id: string;
  timestamp?: string;
  url?: string;
  method?: string;
  model?: string;
  provider?: string;
  channel_model?: string;
  upstream_model?: string;
  ip?: string;
  ip_location?: string;
  status?: number;
  success?: boolean;
  prompt_preview?: string;
  output_preview?: string;
  error_preview?: string;
  tool_preview?: string;
  called_tools_preview?: string;
  system_prompt_preview?: string;
  has_error?: boolean;
  // Observation fields (may be absent on legacy rows)
  state?: string;
  phase?: string;
  error_kind?: string;
  recovered?: boolean;
  trace_id?: string;
  raw_log_id?: string;
  raw_log_pending?: boolean;
  auth_id?: string;
  attempt_count?: number;
  attempts_truncated?: boolean;
}

/** Metadata-only detail shape from `GET /request-logs/:id?view=routes&metadata_only=true`. */
export interface RequestLogMetadataDetail extends RequestLogItem {
  attempts?: RequestLogAttempt[];
}

export interface RequestLogDetail extends RequestLogItem {
  prompt?: string;
  output?: string;
  error?: string;
  system_prompt?: string;
  available_tools?: Array<{
    name: string;
    display_name?: string;
    type?: string;
    description?: string;
    summary?: string;
  }>;
  mcps?: Array<{
    name: string;
    description?: string;
    tools?: Array<{
      name: string;
      display_name?: string;
      type?: string;
      description?: string;
      summary?: string;
    }>;
  }>;
  skills?: Array<{ name: string; description?: string; path?: string; prompt?: string }>;
  called_tools?: Array<{
    name: string;
    display_name?: string;
    type?: string;
    description?: string;
    summary?: string;
  }>;
  attempts?: RequestLogAttempt[];
}

export interface RequestLogsResponse {
  items: RequestLogItem[];
  total: number;
  limit: number;
  offset: number;
  retention_days?: number;
  storage?: string;
  storage_error?: string;
  syncing?: boolean;
  last_synced_at?: string;
  last_sync_error?: string;
  observation_warning?: string;
}

export interface RequestLogListParams {
  q?: string;
  state?: string;
  limit?: number;
  offset?: number;
}

export interface RequestLogExportParams {
  q?: string;
  state?: string;
  limit?: number;
  offset?: number;
  pages?: number;
  format?: string;
}

export const requestLogsApi = {
  list: (params: RequestLogListParams, options: { signal?: AbortSignal } = {}) =>
    apiClient.get<RequestLogsResponse>('/request-logs', {
      params: { view: 'routes', ...params },
      timeout: LOGS_TIMEOUT_MS,
      signal: options.signal,
    }),

  detail: (id: string, options: { signal?: AbortSignal } = {}) =>
    apiClient.get<RequestLogDetail>(`/request-logs/${encodeURIComponent(id)}`, {
      params: { view: 'routes' },
      timeout: LOGS_TIMEOUT_MS,
      signal: options.signal,
    }),

  /** Lightweight metadata+attempts poll; no prompt/output/tool full fields. */
  detailMetadata: (id: string, options: { signal?: AbortSignal } = {}) =>
    apiClient.get<RequestLogMetadataDetail>(`/request-logs/${encodeURIComponent(id)}`, {
      params: { view: 'routes', metadata_only: 'true' },
      timeout: LOGS_TIMEOUT_MS,
      signal: options.signal,
    }),

  export: (params: RequestLogExportParams) =>
    apiClient.getRaw('/request-logs/export', {
      params: { view: 'routes', ...params },
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),
};
