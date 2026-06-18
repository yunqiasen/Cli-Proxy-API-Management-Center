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
  called_tools_preview?: string;
  system_prompt_preview?: string;
  has_error?: boolean;
}

export interface RequestLogDetail extends RequestLogItem {
  prompt?: string;
  output?: string;
  error?: string;
  system_prompt?: string;
  mcps?: Array<{ name: string; description?: string; tools?: Array<{ name: string; description?: string }> }>;
  skills?: Array<{ name: string; description?: string; path?: string; prompt?: string }>;
  called_tools?: Array<{ name: string; display_name?: string; type?: string; description?: string }>;
}

export interface RequestLogsResponse {
  items: RequestLogItem[];
  total: number;
  limit: number;
  offset: number;
  retention_days?: number;
  storage?: string;
}

export const requestLogsApi = {
  list: (params: { q?: string; limit?: number; offset?: number }) =>
    apiClient.get<RequestLogsResponse>('/request-logs', { params, timeout: LOGS_TIMEOUT_MS }),

  detail: (id: string) =>
    apiClient.get<RequestLogDetail>(`/request-logs/${encodeURIComponent(id)}`, {
      timeout: LOGS_TIMEOUT_MS
    }),

  export: (params: { q?: string; limit?: number; offset?: number; pages?: number; format?: string }) =>
    apiClient.getRaw('/request-logs/export', {
      params,
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS
    })
};
