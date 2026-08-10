import type { QuotaRefreshJob } from '@/services/api/quotaRefresh';

export const QUOTA_REFRESH_ALL_PROVIDER = 'all';
export const QUOTA_REFRESH_CONCURRENCY = 3;

export const quotaRefreshIsRunning = (job: QuotaRefreshJob | null | undefined): boolean =>
  job?.status === 'running';

export const quotaRefreshDoneCount = (job: QuotaRefreshJob | null | undefined): number =>
  job?.done ?? job?.completed ?? 0;
