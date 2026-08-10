import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { quotaRefreshApi } from '@/services/api/quotaRefresh';
import {
  QUOTA_REFRESH_ALL_PROVIDER,
  QUOTA_REFRESH_CONCURRENCY,
  quotaRefreshDoneCount,
  quotaRefreshIsRunning,
} from '@/features/quota/quotaRefreshPolicy';

const originalPost = apiClient.post;

afterEach(() => {
  apiClient.post = originalPost;
});

describe('quota background refresh policy', () => {
  test('starts one backend all-provider job with bounded concurrency', async () => {
    const calls: Array<{ url: string; data: unknown }> = [];
    apiClient.post = (async (url: string, data?: unknown) => {
      calls.push({ url, data });
      return {
        id: 'qrj-1',
        status: 'running',
        provider: 'all',
        total: 42,
        done: 0,
        success: 0,
        failed: 0,
        concurrency: QUOTA_REFRESH_CONCURRENCY,
      };
    }) as typeof apiClient.post;

    await quotaRefreshApi.startJob(
      QUOTA_REFRESH_ALL_PROVIDER,
      undefined,
      QUOTA_REFRESH_CONCURRENCY
    );

    expect(calls).toEqual([
      {
        url: '/quota-refresh-jobs',
        data: {
          provider: 'all',
          names: undefined,
          concurrency: 3,
        },
      },
    ]);
  });

  test('reads current backend progress fields and running state', () => {
    const job = {
      id: 'qrj-1',
      status: 'running',
      provider: 'all',
      total: 10,
      done: 4,
      success: 3,
      failed: 1,
      concurrency: 3,
    };

    expect(quotaRefreshIsRunning(job)).toBe(true);
    expect(quotaRefreshDoneCount(job)).toBe(4);
    expect(quotaRefreshIsRunning({ ...job, status: 'completed' })).toBe(false);
  });
});
