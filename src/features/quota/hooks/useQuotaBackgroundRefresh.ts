import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { quotaRefreshApi, type QuotaRefreshJob } from '@/services/api';
import { useNotificationStore } from '@/stores';
import {
  QUOTA_REFRESH_ALL_PROVIDER,
  QUOTA_REFRESH_CONCURRENCY,
  quotaRefreshDoneCount,
  quotaRefreshIsRunning,
} from '../quotaRefreshPolicy';

const POLL_INTERVAL_MS = 2000;

export function useQuotaBackgroundRefresh(disableControls: boolean) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [job, setJob] = useState<QuotaRefreshJob | null>(null);
  const aliveRef = useRef(true);
  const startingRef = useRef(false);
  const activeJobIdRef = useRef('');
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    };
  }, []);

  const pollJob = useCallback(
    async function poll(jobId: string) {
      try {
        const latest = await quotaRefreshApi.getJob(jobId);
        if (!aliveRef.current || activeJobIdRef.current !== jobId) return;
        setJob(latest);
        if (quotaRefreshIsRunning(latest)) {
          pollTimerRef.current = window.setTimeout(
            () => void poll(jobId),
            POLL_INTERVAL_MS
          );
          return;
        }

        showNotification(
          t('quota_management.refresh_all_done', {
            success: latest.success,
            failed: latest.failed,
          }),
          latest.failed > 0 ? 'warning' : 'success'
        );
      } catch (err: unknown) {
        if (!aliveRef.current || activeJobIdRef.current !== jobId) return;
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        setJob((current) =>
          current?.id === jobId ? { ...current, status: 'failed' } : current
        );
        showNotification(t('quota_management.refresh_all_failed', { message }), 'error');
      }
    },
    [showNotification, t]
  );

  const startRefreshAll = useCallback(async () => {
    if (disableControls || startingRef.current || quotaRefreshIsRunning(job)) return;
    startingRef.current = true;
    try {
      const started = await quotaRefreshApi.startJob(
        QUOTA_REFRESH_ALL_PROVIDER,
        undefined,
        QUOTA_REFRESH_CONCURRENCY
      );
      if (!aliveRef.current) return;
      activeJobIdRef.current = started.id;
      setJob(started);
      showNotification(
        t('quota_management.refresh_all_started', { count: started.total }),
        'success'
      );
      if (quotaRefreshIsRunning(started)) {
        pollTimerRef.current = window.setTimeout(
          () => void pollJob(started.id),
          POLL_INTERVAL_MS
        );
      }
    } catch (err: unknown) {
      if (!aliveRef.current) return;
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      showNotification(t('quota_management.refresh_all_failed', { message }), 'error');
    } finally {
      startingRef.current = false;
    }
  }, [disableControls, job, pollJob, showNotification, t]);

  return {
    job,
    done: quotaRefreshDoneCount(job),
    running: quotaRefreshIsRunning(job),
    startRefreshAll,
  };
}
