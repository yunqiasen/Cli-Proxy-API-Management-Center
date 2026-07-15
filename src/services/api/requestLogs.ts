import { apiClient } from './client';
import { LOGS_TIMEOUT_MS } from '@/utils/constants';

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
}

export const requestLogsApi = {
  list: (
    params: { q?: string; limit?: number; offset?: number },
    options: { signal?: AbortSignal } = {}
  ) =>
    apiClient.get<RequestLogsResponse>('/request-logs', {
      params,
      timeout: LOGS_TIMEOUT_MS,
      signal: options.signal,
    }),

  detail: (id: string) =>
    apiClient.get<RequestLogDetail>(`/request-logs/${encodeURIComponent(id)}`, {
      timeout: LOGS_TIMEOUT_MS,
    }),

  export: (params: {
    q?: string;
    limit?: number;
    offset?: number;
    pages?: number;
    format?: string;
  }) =>
    apiClient.getRaw('/request-logs/export', {
      params,
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    }),
};
