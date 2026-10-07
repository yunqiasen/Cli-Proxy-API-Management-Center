/**
 * Management API domain module for the native model catalog display policy.
 *
 * All requests go through the shared apiClient (prefix /v8/management).
 * The policy config group lives at /config/client/model-catalog; a 404
 * on GET means the policy is unconfigured, not a server error.
 */

import { apiClient } from './client';
import { isMissingConfigValue } from './configValue';
import { normalizePolicy, serializePolicy } from '@/features/modelCatalog/policy';
import type {
  CatalogFormat,
  CatalogPolicy,
  CatalogView,
  PolicyReadResult,
} from '@/features/modelCatalog/types';

export const modelCatalogApi = {
  /** Read the saved policy. 404 → defaults with configured=false. */
  async getPolicy(): Promise<PolicyReadResult> {
    try {
      const raw = await apiClient.get<unknown>('/config/client/model-catalog');
      return { policy: normalizePolicy(raw), configured: true };
    } catch (error: unknown) {
      if (isMissingConfigValue(error)) {
        return { policy: normalizePolicy(undefined), configured: false };
      }
      throw error;
    }
  },

  /** Replace the entire policy group. Returns the backend ack. */
  async putPolicy(policy: CatalogPolicy): Promise<{ status: string; 'config-version': number }> {
    return apiClient.put('/config/client/model-catalog', serializePolicy(policy));
  },

  /** Fetch the management inventory (bypasses display filters). */
  async getInventory(format: CatalogFormat): Promise<CatalogView> {
    return apiClient.get<CatalogView>('/models/catalog', { params: { format } });
  },

  /** Preview a draft policy without persisting it. */
  async previewCatalog(format: CatalogFormat, policy: CatalogPolicy): Promise<CatalogView> {
    return apiClient.post<CatalogView>('/models/catalog/preview', {
      format,
      policy: serializePolicy(policy),
    });
  },
};
