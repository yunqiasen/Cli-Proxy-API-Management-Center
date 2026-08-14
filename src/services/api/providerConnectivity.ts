import type { AxiosRequestConfig } from 'axios';
import { apiClient } from './client';
import {
  buildClaudeProviderConnectivityPayload,
  normalizeProviderConnectivityResult,
  type ClaudeProviderConnectivityInput,
} from './providerConnectivityRequest';

export * from './providerConnectivityRequest';

export const providerConnectivityApi = {
  requestClaude: async (
    input: ClaudeProviderConnectivityInput,
    config?: AxiosRequestConfig
  ) => {
    const response = await apiClient.post<Record<string, unknown>>(
      '/provider-connectivity-test',
      buildClaudeProviderConnectivityPayload(input),
      config
    );
    return normalizeProviderConnectivityResult(response);
  },
};
