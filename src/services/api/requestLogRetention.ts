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
