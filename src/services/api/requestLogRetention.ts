const isRetentionDays = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function serializeRequestLogRetentionDays(value: unknown): { value: number } {
  if (!isRetentionDays(value)) {
    throw new TypeError('request-log retention must be a non-negative integer');
  }
  return { value };
}

export function parseRequestLogRetentionDaysResponse(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('invalid request-log retention response');
  }
  const days = (value as Record<string, unknown>)['request-log-retention-days'];
  if (!isRetentionDays(days)) {
    throw new TypeError('invalid request-log retention response');
  }
  return days;
}

export interface RequestLogSettings {
  enabled: boolean;
  retentionDays: number;
}

export interface RequestLogSettingsSaveDependencies {
  updateRequestLog: (enabled: boolean) => Promise<unknown>;
  updateRequestLogRetentionDays: (days: number) => Promise<unknown>;
  readServerSettings: () => Promise<RequestLogSettings>;
  applyServerSettings: (settings: RequestLogSettings) => void;
}

export async function saveRequestLogSettings(
  current: RequestLogSettings,
  next: RequestLogSettings,
  dependencies: RequestLogSettingsSaveDependencies
): Promise<RequestLogSettings> {
  const writes: Array<() => Promise<unknown>> = [];
  if (current.enabled !== next.enabled) {
    writes.push(() => dependencies.updateRequestLog(next.enabled));
  }
  if (current.retentionDays !== next.retentionDays) {
    writes.push(() => dependencies.updateRequestLogRetentionDays(next.retentionDays));
  }

  const writeResults = await Promise.allSettled(
    writes.map((write) => Promise.resolve().then(write))
  );
  const mutationFailure = writeResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );

  let serverSettings: RequestLogSettings;
  try {
    serverSettings = await dependencies.readServerSettings();
  } catch (readError: unknown) {
    throw mutationFailure?.reason ?? readError;
  }

  dependencies.applyServerSettings(serverSettings);
  if (mutationFailure) {
    throw mutationFailure.reason;
  }
  return serverSettings;
}
