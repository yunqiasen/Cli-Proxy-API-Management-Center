/**
 * 配置相关 API
 */

import { apiClient } from './client';
import type { Config } from '@/types';
import { normalizeConfigResponse } from './transformers';
import {
  parseRequestLogRetentionDaysResponse,
  serializeRequestLogRetentionDays,
} from './requestLogRetention';

export const configApi = {
  /**
   * 获取配置（会进行字段规范化）
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    return normalizeConfigResponse(raw);
  },

  /**
   * 请求日志开关
   */
  updateRequestLog: (enabled: boolean) => apiClient.put('/request-log', { value: enabled }),

  async getRequestLogRetentionDays(): Promise<number> {
    const response = await apiClient.get('/request-log-retention-days');
    return parseRequestLogRetentionDaysResponse(response);
  },

  updateRequestLogRetentionDays: (days: number) =>
    apiClient.put('/request-log-retention-days', serializeRequestLogRetentionDays(days)),
};
