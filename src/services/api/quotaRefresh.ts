import { apiClient } from './client';

export interface QuotaRefreshJob {
  id: string;
  status: 'running' | 'completed' | 'failed' | string;
  provider: string;
  total: number;
  done: number;
  success: number;
  failed: number;
  /** Compatibility with older management responses. */
  completed?: number;
  concurrency: number;
  errors?: Array<{ name?: string; error?: string }>;
}

export const quotaRefreshApi = {
  startJob: (provider: string, names?: string[], concurrency = 3) =>
    apiClient.post<QuotaRefreshJob>('/quota-refresh-jobs', {
      provider,
      names,
      concurrency
    }),

  getJob: (id: string) =>
    apiClient.get<QuotaRefreshJob>(`/quota-refresh-jobs/${encodeURIComponent(id)}`)
};
