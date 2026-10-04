/**
 * 日志相关 API
 */

import type { ApiError } from '@/types';
import { apiClient } from './client';
import { parseApiErrorResponse } from './apiError';
import { LOGS_TIMEOUT_MS } from '@/utils/constants';
import { isRecord } from '@/utils/helpers';

export type LogCursor = number | string;

export interface LogsQuery {
  after?: LogCursor;
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface HomeLogRecord {
  id?: number;
  timestamp?: string | number;
  client_ip?: string;
  request_id?: string;
  home_ip?: string;
  level?: string;
  line?: string;
  created_at?: string | number;
}

export interface LogsResponse {
  lines: string[];
  latestAfter?: LogCursor;
  nextCursor?: string;
  cursorReset?: boolean;
  requestLogHomeIpById?: Record<string, string>;
}

export interface ErrorLogFile {
  name: string;
  size?: number;
  modified?: number;
}

export interface ErrorLogsResponse {
  files: ErrorLogFile[];
}

export interface LogsRequestOptions {
  signal?: AbortSignal;
}

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const numberValue = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const booleanValue = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

const positiveNumberValue = (value: unknown): number | undefined => {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

const homeRecordsFromPayload = (data: Record<string, unknown>): HomeLogRecord[] =>
  Array.isArray(data.logs)
    ? data.logs.filter((entry): entry is HomeLogRecord => isRecord(entry))
    : [];

const unixSecondsFromValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = stringValue(value);
  if (!text) return 0;
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) return asNumber;
  const asDate = Date.parse(text);
  return Number.isFinite(asDate) ? Math.floor(asDate / 1000) : 0;
};

const homeCursorFromRecord = (record: HomeLogRecord): string => {
  const timestamp = stringValue(record.timestamp);
  if (timestamp) return timestamp;
  const createdAt = stringValue(record.created_at);
  return createdAt;
};

const normalizeCPALogs = (data: Record<string, unknown>): LogsResponse => {
  const lines = Array.isArray(data.lines)
    ? data.lines.filter((line): line is string => typeof line === 'string')
    : [];
  const latestTimestamp = unixSecondsFromValue(data['latest-timestamp']);

  return {
    lines,
    latestAfter: latestTimestamp > 0 ? latestTimestamp : undefined,
    nextCursor: typeof data['next-cursor'] === 'string' ? data['next-cursor'] : undefined,
    cursorReset: booleanValue(data['cursor-reset']) || false,
  };
};

const normalizeHomeLogs = (data: Record<string, unknown>): LogsResponse => {
  const rawLogs = homeRecordsFromPayload(data);
  const orderedLogs = [...rawLogs].reverse();
  const lines = orderedLogs
    .map((record) => record.line)
    .filter((line): line is string => typeof line === 'string' && line.length > 0);
  const requestLogHomeIpById = orderedLogs.reduce<Record<string, string>>((acc, record) => {
    const requestId = stringValue(record.request_id);
    const homeIp = stringValue(record.home_ip);
    if (requestId && homeIp) {
      acc[requestId] = homeIp;
    }
    return acc;
  }, {});
  const latestCursor = rawLogs.reduce<string | undefined>((latest, record) => {
    const cursor = homeCursorFromRecord(record);
    if (!cursor) return latest;
    if (!latest) return cursor;
    const latestTime = Date.parse(latest);
    const cursorTime = Date.parse(cursor);
    if (!Number.isFinite(latestTime) || !Number.isFinite(cursorTime)) return latest;
    return cursorTime > latestTime ? cursor : latest;
  }, undefined);

  return {
    lines,
    latestAfter: latestCursor,
    requestLogHomeIpById,
  };
};

const normalizeLogsResponse = (data: unknown): LogsResponse => {
  if (!isRecord(data)) {
    return { lines: [] };
  }
  if (Array.isArray(data.logs)) return normalizeHomeLogs(data);
  if (Array.isArray(data.lines)) return normalizeCPALogs(data);
  return { lines: [], latestAfter: undefined, nextCursor: undefined, cursorReset: false };
};

const normalizeErrorLogsResponse = (data: unknown): ErrorLogsResponse => {
  if (!isRecord(data) || !Array.isArray(data.files)) return { files: [] };
  return {
    files: data.files.flatMap((file): ErrorLogFile[] => {
      if (!isRecord(file) || typeof file.name !== 'string' || !file.name.trim()) return [];
      return [
        {
          name: file.name,
          size:
            typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0
              ? file.size
              : undefined,
          modified: unixSecondsFromValue(file.modified) || undefined,
        },
      ];
    }),
  };
};

/** Decode download bodies without interpreting successful log contents as API errors. */
export const responseDataToText = async (data: unknown): Promise<string> => {
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '';
  try {
    return JSON.stringify(data, null, 2) ?? String(data);
  } catch {
    return String(data);
  }
};

const downloadLog = async (path: string, options: LogsRequestOptions) => {
  try {
    return await apiClient.getRaw(path, {
      ...options,
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const apiError = error as ApiError;
      const body = apiError.data instanceof Blob ? apiError.data : apiError.details;
      if (body instanceof Blob) {
        try {
          const text = await responseDataToText(body);
          const parsed = parseApiErrorResponse(JSON.parse(text), apiError.message);
          apiError.message = parsed.message;
          if (parsed.apiCode !== undefined) apiError.apiCode = parsed.apiCode;
        } catch {
          // Unreadable/non-JSON bodies must not mask the original transport failure.
        }
      }
    }
    throw error;
  }
};

const fetchCompleteHomeLogs = async (
  firstPage: Record<string, unknown>,
  params: LogsQuery,
  options: LogsRequestOptions = {},
): Promise<Record<string, unknown>> => {
  const requestedLimit = positiveNumberValue(params.limit);
  const firstPageLimit = positiveNumberValue(firstPage.limit);
  const pageLimit = firstPageLimit ?? requestedLimit;
  const total = numberValue(firstPage.total);
  const firstOffset = numberValue(firstPage.offset) ?? 0;
  const records = homeRecordsFromPayload(firstPage);

  if (requestedLimit === undefined || pageLimit === undefined || total === undefined) {
    return firstPage;
  }

  const targetCount = Math.min(requestedLimit, Math.max(total - firstOffset, 0));

  if (records.length >= targetCount) {
    return { ...firstPage, logs: records, limit: records.length, offset: firstOffset };
  }

  const remaining = targetCount - records.length;
  const baseOffset = firstOffset + records.length;
  const pageRequests: Array<{ offset: number; limit: number }> = [];
  let collected = 0;
  while (collected < remaining && baseOffset + collected < total) {
    const pageSize = Math.min(pageLimit, remaining - collected);
    pageRequests.push({ offset: baseOffset + collected, limit: pageSize });
    collected += pageSize;
  }

  const pages = await Promise.all(
    pageRequests.map(async ({ offset, limit }) => {
      const data = await apiClient.get('/observability/logs', {
        ...options,
        params: { ...params, limit, offset },
        timeout: LOGS_TIMEOUT_MS,
      });
      if (!isRecord(data) || !Array.isArray(data.logs)) return [];
      return homeRecordsFromPayload(data);
    }),
  );

  pages.forEach((pageRecords) => records.push(...pageRecords));

  return { ...firstPage, logs: records, limit: records.length, offset: firstOffset };
};

export const logsApi = {
  async fetchLogs(
    params: LogsQuery = {},
    options: LogsRequestOptions = {},
  ): Promise<LogsResponse> {
    const data = await apiClient.get('/observability/logs', {
      ...options,
      params,
      timeout: LOGS_TIMEOUT_MS,
    });
    if (isRecord(data) && Array.isArray(data.logs)) {
      return normalizeLogsResponse(await fetchCompleteHomeLogs(data, params, options));
    }
    return normalizeLogsResponse(data);
  },

  clearLogs: (options: LogsRequestOptions = {}) =>
    apiClient.delete('/observability/logs', options),

  async fetchErrorLogs(options: LogsRequestOptions = {}): Promise<ErrorLogsResponse> {
    const data = await apiClient.get('/observability/logs/errors', {
      ...options,
      timeout: LOGS_TIMEOUT_MS,
    });
    return normalizeErrorLogsResponse(data);
  },

  downloadErrorLog: (filename: string, options: LogsRequestOptions = {}) =>
    downloadLog(`/observability/logs/errors/${encodeURIComponent(filename)}`, options),

  downloadRequestLogById: (id: string, options: LogsRequestOptions = {}) =>
    downloadLog(`/observability/logs/requests/${encodeURIComponent(id)}`, options),
};
