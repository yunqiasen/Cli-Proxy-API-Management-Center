import { apiClient } from './client';
import type { ApiKeyUsageResponse } from '@/utils/recentRequests';
import { configReloadPendingFromHeaders } from './apiKeyUsageHeaders';

const API_KEY_USAGE_TIMEOUT_MS = 15 * 1000;

export interface ApiKeyUsageSnapshot {
  data: ApiKeyUsageResponse;
  configReloadPending: boolean;
}

export const apiKeyUsageApi = {
  async getUsageSnapshot(): Promise<ApiKeyUsageSnapshot> {
    const response = await apiClient.getRaw('/api-key-usage', {
      timeout: API_KEY_USAGE_TIMEOUT_MS,
    });
    return {
      data: response.data as ApiKeyUsageResponse,
      configReloadPending: configReloadPendingFromHeaders(response.headers),
    };
  },
  async getUsage(): Promise<ApiKeyUsageResponse> {
    return (await this.getUsageSnapshot()).data;
  },
};
