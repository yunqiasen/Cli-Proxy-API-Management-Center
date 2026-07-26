import {
  mergeRecentRequestBucketGroups,
  statusBarDataFromRecentRequests,
  sumRecentRequests,
  type ApiKeyUsageFailureDetail,
  type ApiKeyUsageSuccessDetail,
  type RecentRequestUsageEntry,
  type StatusBarData,
} from '../../utils/recentRequests.ts';

const EMPTY_USAGE_ENTRY: RecentRequestUsageEntry = {
  success: 0,
  failed: 0,
  recentRequests: [],
  successDetails: [],
  failureDetails: [],
};

const mergeSuccessDetails = (groups: ApiKeyUsageSuccessDetail[][]): ApiKeyUsageSuccessDetail[] => {
  const merged = new Map<string, ApiKeyUsageSuccessDetail>();
  groups.flat().forEach((item) => {
    const key = `${item.model}|${item.status}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, count: current.count + item.count } : { ...item });
  });
  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
};

const mergeFailureDetails = (groups: ApiKeyUsageFailureDetail[][]): ApiKeyUsageFailureDetail[] => {
  const merged = new Map<string, ApiKeyUsageFailureDetail>();
  groups.flat().forEach((item) => {
    const key = `${item.model}|${item.status}|${item.error}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, count: current.count + item.count } : { ...item });
  });
  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
};

export interface AggregatedProviderUsage {
  totalStats: { success: number; failure: number };
  recentWindowStats: { success: number; failure: number };
  statusData: StatusBarData;
  usageDetails: {
    successDetails: ApiKeyUsageSuccessDetail[];
    failureDetails: ApiKeyUsageFailureDetail[];
  };
}

export function aggregateProviderUsageByApiKeys(
  apiKeys: readonly string[],
  resolveUsageEntry: (apiKey: string) => RecentRequestUsageEntry | undefined
): AggregatedProviderUsage {
  const entries = apiKeys.map((apiKey) => {
    // An empty key is a real credential slot for public media endpoints.
    // Keep it so the provider-level usage bucket (`baseUrl|`) is included.
    const normalizedApiKey = apiKey.trim();
    return resolveUsageEntry(normalizedApiKey) ?? EMPTY_USAGE_ENTRY;
  });
  const recentRequests = mergeRecentRequestBucketGroups(
    entries.map((entry) => entry.recentRequests)
  );

  return {
    totalStats: entries.reduce(
      (total, entry) => ({
        success: total.success + entry.success,
        failure: total.failure + entry.failed,
      }),
      { success: 0, failure: 0 }
    ),
    recentWindowStats: sumRecentRequests(recentRequests),
    statusData: statusBarDataFromRecentRequests(recentRequests),
    usageDetails: {
      successDetails: mergeSuccessDetails(entries.map((entry) => entry.successDetails)),
      failureDetails: mergeFailureDetails(entries.map((entry) => entry.failureDetails)),
    },
  };
}
