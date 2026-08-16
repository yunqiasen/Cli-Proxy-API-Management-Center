import type { AxiosRequestConfig } from 'axios';
import { apiClient } from './client';
import {
  buildClaudeProviderConnectivityPayload,
  buildCodexProviderConnectivityPayload,
  normalizeProviderConnectivityResult,
  type ClaudeProviderConnectivityInput,
  type CodexProviderConnectivityInput,
} from './providerConnectivityRequest';

export * from './providerConnectivityRequest';

export const providerConnectivityApi = {
  requestClaude: async (input: ClaudeProviderConnectivityInput, config?: AxiosRequestConfig) => {
    const response = await apiClient.post<Record<string, unknown>>(
      '/provider-connectivity-test',
      buildClaudeProviderConnectivityPayload(input),
      config
    );
    return normalizeProviderConnectivityResult(response);
  },
  requestCodex: async (input: CodexProviderConnectivityInput, config?: AxiosRequestConfig) => {
    const response = await apiClient.post<Record<string, unknown>>(
      '/provider-connectivity-test',
      buildCodexProviderConnectivityPayload(input),
      config
    );
    return normalizeProviderConnectivityResult(response);
  },
};
