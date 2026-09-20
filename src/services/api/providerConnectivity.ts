import type { AxiosRequestConfig } from 'axios';
import { apiClient } from './client';
import {
  buildOpenAIProviderConnectivityPayload,
  type OpenAIProviderConnectivityInput,
  buildClaudeProviderConnectivityPayload,
  buildCodexProviderConnectivityPayload,
  normalizeProviderConnectivityResult,
  type ClaudeProviderConnectivityInput,
  type CodexProviderConnectivityInput,
} from './providerConnectivityRequest';

export * from './providerConnectivityRequest';

export const providerConnectivityApi = {
  requestOpenAI: async (input: OpenAIProviderConnectivityInput, config?: AxiosRequestConfig) => {
    const response = await apiClient.post<Record<string, unknown>>(
      '/provider-connectivity-test',
      buildOpenAIProviderConnectivityPayload(input),
      config
    );
    return normalizeProviderConnectivityResult(response);
  },
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
