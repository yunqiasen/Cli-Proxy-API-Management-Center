import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconDownload, IconEye, IconRefreshCw, IconSearch } from '@/components/ui/icons';
import {
  requestLogsApi,
  logsApi,
  type RequestLogAttempt,
  type RequestLogDetail,
  type RequestLogItem,
} from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import styles from './RequestLogsPanel.module.scss';
import { requestLogModelLabel, requestLogProviderLabel } from './requestLogLabels';
import {
  applyRequestLogRefreshError,
  applyRequestLogRefreshSuccess,
  beginRequestLogRefresh,
  createRequestLogRefreshCoordinator,
  createRequestLogRefreshState,
} from './requestLogRefreshState';
import {
  STATE_FILTER_OPTIONS,
  buildExportParams,
  deriveItemState,
  errorKindLabelKey,
  isActiveState,
  isTerminalState,
  mergeMetadataIntoDetail,
  mergeObservationItems,
  needsFullDetailFetch,
  phaseLabelKey,
  resolvePollInterval,
  shouldPollDetailMetadata,
  shouldPollList,
  sortAttempts,
  stateLabelKey,
} from './requestLogObservation';

const PAGE_SIZE = 30;
const BASE_POLL_MS = 5000;
const ACTIVE_POLL_MS = 1500;
const DETAIL_POLL_MS = 1500;

type RequestToolInfo = NonNullable<RequestLogDetail['called_tools']>[number];
type RequestMcpInfo = NonNullable<RequestLogDetail['mcps']>[number];
type RequestSkillInfo = NonNullable<RequestLogDetail['skills']>[number];

interface HoverTooltipState {
  text: string;
  x: number;
  y: number;
}

const preview = (value?: string, limit = 56) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '—';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const formatTime = (value?: string) => {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
};

const compactRequestPath = (value?: string) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  let pathname: string;
  try {
    pathname =
      raw.startsWith('http://') || raw.startsWith('https://')
        ? new URL(raw).pathname
        : raw.split(/[?#]/)[0];
  } catch {
    pathname = raw.split(/[?#]/)[0];
  }
  const parts = pathname
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const withoutVersion = parts[0] && /^v\d+(?:beta)?$/i.test(parts[0]) ? parts.slice(1) : parts;
  if (!withoutVersion.length) return pathname || '—';
  if (
    withoutVersion.length >= 2 &&
    withoutVersion[0] === 'chat' &&
    withoutVersion[1] === 'completions'
  ) {
    return 'chat/completions';
  }
  return withoutVersion[withoutVersion.length - 1] || '—';
};

const requestPathTitle = (item: RequestLogItem) =>
  [item.method, item.url].filter(Boolean).join(' ') || '—';

const requestModelLabel = (item: RequestLogItem) => preview(requestLogModelLabel(item), 36);

const requestModelTooltip = (item: RequestLogItem) => {
  const channelModel = String(item.channel_model ?? '').trim();
  if (channelModel) return channelModel;
  return [item.provider, item.upstream_model || item.model].filter(Boolean).join(' / ') || '—';
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const tooltipPoint = (target: HTMLElement, text: string) => {
  const rect = target.getBoundingClientRect();
  const widthEstimate = Math.min(420, Math.max(180, text.length * 8 + 28));
  return {
    x: clamp(rect.left, 12, Math.max(12, window.innerWidth - widthEstimate - 12)),
    y: Math.min(rect.bottom + 8, window.innerHeight - 52),
  };
};

const uniqueLabels = (values: string[]) =>
  Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));

const toolName = (tool: RequestToolInfo) => tool.display_name || tool.name || 'unknown';

const toolLine = (tool: RequestToolInfo) => {
  const parts = [tool.name, tool.type].filter(Boolean).join(' · ');
  const body = tool.description || tool.summary || '';
  return [parts || toolName(tool), body].filter(Boolean).join('\n');
};

const sectionText = (title: string, value?: string) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return (
    <section className={styles.detailSection}>
      <h3>{title}</h3>
      <pre>{text}</pre>
    </section>
  );
};

const toolSection = (title: string, tools?: RequestToolInfo[]) => {
  const list = Array.isArray(tools) ? tools.filter((tool) => tool.name || tool.display_name) : [];
  if (!list.length) return null;
  return (
    <section className={styles.detailSection}>
      <h3>{title}</h3>
      <div className={styles.toolGrid}>
        {list.map((tool, index) => (
          <article className={styles.toolCard} key={`${tool.name || tool.display_name}-${index}`}>
            <strong>{toolName(tool)}</strong>
            {tool.name && tool.name !== toolName(tool) ? <span>{tool.name}</span> : null}
            {tool.type ? <span>{tool.type}</span> : null}
            {tool.description || tool.summary ? <p>{tool.description || tool.summary}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
};

const mcpSection = (mcps?: RequestMcpInfo[]) => {
  const list = Array.isArray(mcps) ? mcps.filter((mcp) => mcp.name) : [];
  if (!list.length) return null;
  return (
    <section className={styles.detailSection}>
      <h3>完整 MCP 功能介绍</h3>
      {list.map((mcp) => {
        const tools = Array.isArray(mcp.tools) ? mcp.tools : [];
        return (
          <article className={styles.mcpBlock} key={mcp.name}>
            <h4>{mcp.name}</h4>
            {mcp.description ? <pre>{mcp.description}</pre> : null}
            {tools.length ? <pre>{tools.map(toolLine).join('\n\n')}</pre> : null}
          </article>
        );
      })}
    </section>
  );
};

const skillSection = (skills?: RequestSkillInfo[]) => {
  const list = Array.isArray(skills) ? skills.filter((skill) => skill.name) : [];
  if (!list.length) return null;
  return (
    <section className={styles.detailSection}>
      <h3>Skill 功能介绍和提示词</h3>
      {list.map((skill) => (
        <article className={styles.mcpBlock} key={`${skill.name}-${skill.path || ''}`}>
          <h4>{skill.name}</h4>
          {skill.path ? <div className={styles.pathLine}>{skill.path}</div> : null}
          <pre>{[skill.description, skill.prompt].filter(Boolean).join('\n\n') || '无'}</pre>
        </article>
      ))}
    </section>
  );
};

const stateBadgeClass = (state: string): string => {
  const map: Record<string, string> = {
    active: styles.stateActive,
    succeeded: styles.stateSucceeded,
    failed: styles.stateFailed,
    canceled: styles.stateCanceled,
    interrupted: styles.stateInterrupted,
    recovered: styles.stateRecovered,
    retried: styles.stateRetried,
  };
  return map[state] || styles.stateUnknown;
};

export function RequestLogsPanel() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const [refreshState, setRefreshState] = useState(() =>
    createRequestLogRefreshState<RequestLogItem>()
  );
  const { items, total, loading, error } = refreshState;
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const refreshCoordinatorRef = useRef(createRequestLogRefreshCoordinator());
  const activeRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const detailRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const detailGenerationRef = useRef(0);
  const detailMetaControllerRef = useRef<AbortController | null>(null);
  const detailPollTimerRef = useRef<number | null>(null);
  const fullDetailFetchedRef = useRef(false);
  const [detail, setDetail] = useState<RequestLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPending, setDetailPending] = useState(false);
  const [exportPages, setExportPages] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hoverTooltip, setHoverTooltip] = useState<HoverTooltipState | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  const querySettled = query === debouncedQuery;

  const pollInterval = useMemo(
    () => resolvePollInterval(stateFilter, items, BASE_POLL_MS, ACTIVE_POLL_MS),
    [stateFilter, items]
  );

  const load = useCallback(
    async (silent = false, replaceActive = false) => {
      if (connectionStatus !== 'connected') return;
      const coordinator = refreshCoordinatorRef.current;
      if (replaceActive) activeRequestRef.current?.controller.abort();
      const requestId = coordinator.tryStart(replaceActive);
      if (requestId === null) return;

      const controller = new AbortController();
      activeRequestRef.current = { id: requestId, controller };
      setRefreshState((state) => beginRequestLogRefresh(state, silent));
      try {
        const data = await requestLogsApi.list(
          {
            q: debouncedQuery.trim() || undefined,
            state: stateFilter !== 'all' ? stateFilter : undefined,
            limit: PAGE_SIZE,
            offset,
          },
          { signal: controller.signal }
        );
        if (controller.signal.aborted || !coordinator.isCurrent(requestId)) return;
        setRefreshState((state) => {
          const refreshed = applyRequestLogRefreshSuccess(state, data);
          return silent
            ? { ...refreshed, items: mergeObservationItems(state.items, refreshed.items) }
            : refreshed;
        });
      } catch (err: unknown) {
        const canceled =
          controller.signal.aborted ||
          (typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            String((err as { code?: string }).code) === 'ERR_CANCELED');
        if (!canceled && coordinator.isCurrent(requestId)) {
          const message = getErrorMessage(err) || '加载请求日志失败';
          setRefreshState((state) => applyRequestLogRefreshError(state, message));
        }
      } finally {
        coordinator.finish(requestId);
        if (activeRequestRef.current?.id === requestId) activeRequestRef.current = null;
      }
    },
    [connectionStatus, debouncedQuery, offset, stateFilter]
  );

  useEffect(() => {
    void load(false, true);
  }, [load, apiBase, managementKey]);

  // List polling: uses applyRequestLogRefreshSuccess for both silent and full loads
  // so syncing/observation_warning/last_synced_at metadata update correctly.
  useEffect(() => {
    if (connectionStatus !== 'connected') return undefined;
    const poll = () => {
      const canPoll = shouldPollList({
        autoRefresh,
        visibilityHidden: document.visibilityState === 'hidden',
        querySettled,
        queryNonempty: Boolean(debouncedQuery.trim()),
        pageNotFirst: page > 1,
        hasDetail: Boolean(detail),
        scrolled: (tableRef.current?.scrollTop ?? 0) > 0,
        stateFilter,
      });
      if (canPoll) void load(true, false);
    };
    const timer = window.setInterval(poll, pollInterval);
    return () => window.clearInterval(timer);
  }, [
    autoRefresh,
    connectionStatus,
    debouncedQuery,
    detail,
    load,
    page,
    pollInterval,
    querySettled,
    stateFilter,
  ]);

  const selectedDetailId = detail?.id;
  const detailPollingRequired = Boolean(
    detail && (isActiveState(deriveItemState(detail)) || detailPending)
  );

  // Schedule the next poll only after this one completes. Reading full content
  // never participates in periodic polling; it is fetched once after indexing.
  useEffect(() => {
    if (
      !selectedDetailId ||
      !detailPollingRequired ||
      detailLoading ||
      !autoRefresh ||
      connectionStatus !== 'connected'
    )
      return undefined;
    const detailId = selectedDetailId;
    const generation = detailGenerationRef.current;
    const controller = new AbortController();
    detailMetaControllerRef.current = controller;
    let keepPolling = true;
    const current = () => !controller.signal.aborted && generation === detailGenerationRef.current;
    const pollMeta = async () => {
      if (!current()) return;
      try {
        if (
          !shouldPollDetailMetadata({
            autoRefresh,
            visibilityHidden: document.visibilityState === 'hidden',
            isActive: detailPollingRequired,
            pendingRawContent: false,
          })
        )
          return;
        const meta = await requestLogsApi.detailMetadata(detailId, { signal: controller.signal });
        if (!current()) return;
        setDetail((previous) => (previous ? mergeMetadataIntoDetail(previous, meta) : previous));
        const terminal = isTerminalState(deriveItemState(meta));
        if (
          needsFullDetailFetch({
            isTerminal: terminal,
            hasRawLogId: Boolean(meta.raw_log_id),
            alreadyFetched: fullDetailFetchedRef.current,
          })
        ) {
          const full = await requestLogsApi.detail(detailId, { signal: controller.signal });
          if (!current()) return;
          fullDetailFetchedRef.current = true;
          setDetail((previous) => (previous?.id === detailId ? full : previous));
          setDetailPending(false);
          keepPolling = false;
        } else if (terminal && !meta.raw_log_pending) {
          setDetailPending(false);
          keepPolling = false;
        }
      } catch {
        // Keep existing text on transient metadata/index failures.
      } finally {
        if (current() && keepPolling) {
          detailPollTimerRef.current = window.setTimeout(() => void pollMeta(), DETAIL_POLL_MS);
        }
      }
    };
    detailPollTimerRef.current = window.setTimeout(() => void pollMeta(), DETAIL_POLL_MS);
    return () => {
      controller.abort();
      if (detailMetaControllerRef.current === controller) detailMetaControllerRef.current = null;
      if (detailPollTimerRef.current !== null) {
        window.clearTimeout(detailPollTimerRef.current);
        detailPollTimerRef.current = null;
      }
    };
  }, [
    selectedDetailId,
    detailPollingRequired,
    detailLoading,
    autoRefresh,
    connectionStatus,
    apiBase,
    managementKey,
  ]);

  useEffect(() => {
    const invalidate = () => {
      refreshCoordinatorRef.current.invalidate();
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
      detailGenerationRef.current += 1;
      detailRequestRef.current?.controller.abort();
      detailRequestRef.current = null;
      detailMetaControllerRef.current?.abort();
      detailMetaControllerRef.current = null;
      if (detailPollTimerRef.current !== null) {
        window.clearTimeout(detailPollTimerRef.current);
        detailPollTimerRef.current = null;
      }
    };
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (
        next.apiBase === previous.apiBase &&
        next.managementKey === previous.managementKey &&
        next.connectionStatus === previous.connectionStatus &&
        next.isAuthenticated === previous.isAuthenticated
      )
        return;
      invalidate();
      setRefreshState(createRequestLogRefreshState<RequestLogItem>());
      setPage(1);
      setQuery('');
      setDebouncedQuery('');
      setStateFilter('all');
      setHoverTooltip(null);
      setDetail(null);
      setDetailLoading(false);
      setDetailPending(false);
    });
    return () => {
      unsubscribe();
      invalidate();
    };
  }, []);

  useEffect(() => {
    if (tableRef.current) tableRef.current.scrollTop = 0;
    setHoverTooltip(null);
  }, [page, debouncedQuery, stateFilter]);

  const closeDetail = useCallback(() => {
    detailGenerationRef.current += 1;
    detailRequestRef.current?.controller.abort();
    detailRequestRef.current = null;
    detailMetaControllerRef.current?.abort();
    detailMetaControllerRef.current = null;
    if (detailPollTimerRef.current !== null) {
      window.clearTimeout(detailPollTimerRef.current);
      detailPollTimerRef.current = null;
    }
    setDetail(null);
    setDetailLoading(false);
    setDetailPending(false);
  }, []);

  const openDetail = async (item: RequestLogItem) => {
    detailRequestRef.current?.controller.abort();
    detailMetaControllerRef.current?.abort();
    if (detailPollTimerRef.current !== null) {
      window.clearTimeout(detailPollTimerRef.current);
      detailPollTimerRef.current = null;
    }
    const id = ++detailGenerationRef.current;
    const controller = new AbortController();
    detailRequestRef.current = { id, controller };
    const itemActive = isActiveState(deriveItemState(item));
    setDetail(item as RequestLogDetail);
    setDetailLoading(true);
    setDetailPending(itemActive);
    fullDetailFetchedRef.current = false;
    try {
      const result = await requestLogsApi.detail(item.id, { signal: controller.signal });
      if (!controller.signal.aborted && id === detailGenerationRef.current) {
        setDetail(result);
        fullDetailFetchedRef.current = Boolean(result.raw_log_id);
        setDetailPending(
          Boolean(result.raw_log_pending) ||
            (isActiveState(deriveItemState(result)) && !result.raw_log_id)
        );
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted && id === detailGenerationRef.current) {
        const is404 =
          typeof err === 'object' &&
          err !== null &&
          'status' in err &&
          (err as { status?: number }).status === 404;
        if (itemActive && is404) {
          setDetailPending(true);
        } else {
          showNotification(getErrorMessage(err) || '加载请求详情失败', 'error');
          setDetailPending(false);
        }
      }
    } finally {
      if (id === detailGenerationRef.current) {
        detailRequestRef.current = null;
        setDetailLoading(false);
      }
    }
  };

  const downloadRawLog = async () => {
    if (!detail?.raw_log_id) return;
    try {
      const response = await logsApi.downloadRequestLogById(detail.raw_log_id);
      const blob =
        response.data instanceof Blob ? response.data : new Blob([JSON.stringify(response.data)]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${detail.raw_log_id}.log`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      showNotification(getErrorMessage(err) || '下载原始日志失败', 'error');
    }
  };

  const exportRows = async (format: 'csv' | 'jsonl') => {
    try {
      const params = buildExportParams({
        q: debouncedQuery.trim() || undefined,
        state: stateFilter,
        limit: PAGE_SIZE,
        offset,
        pages: exportPages,
        format,
      });
      const response = await requestLogsApi.export(params);
      const blob =
        response.data instanceof Blob ? response.data : new Blob([JSON.stringify(response.data)]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `request-logs-${exportPages}页.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      showNotification(getErrorMessage(err) || '导出请求日志失败', 'error');
    }
  };

  const detailMeta = useMemo(() => {
    if (!detail) return [];
    const state = deriveItemState(detail);
    const meta: Array<[string, string]> = [
      ['请求', `${detail.method || '—'} ${detail.url || '—'}`],
      ['模型', requestLogModelLabel(detail)],
      ['供应商', requestLogProviderLabel(detail)],
      ['IP', `${detail.ip || '未记录'} ${detail.ip_location || ''}`.trim()],
    ];
    if (detail.auth_id) {
      meta.push([t('logs.observation_credential'), detail.auth_id]);
    }
    if (detail.upstream_model) {
      meta.push([t('logs.observation_upstream_model'), detail.upstream_model]);
    }
    if (detail.trace_id) {
      meta.push([t('logs.observation_trace_id'), detail.trace_id]);
    }
    if (typeof detail.attempt_count === 'number') {
      meta.push([t('logs.observation_attempt_count'), String(detail.attempt_count)]);
    }
    const stateLabel = t(`logs.observation_state_${stateLabelKey(state)}`);
    const statusText = detail.status ? ` · ${detail.status}` : '';
    meta.push(['状态', `${stateLabel}${statusText}`]);
    if (detail.recovered) {
      meta.push([t('logs.observation_recovered_label'), '✓']);
    }
    if (detail.phase && state === 'active') {
      meta.push([
        t('logs.observation_phase_label'),
        t(`logs.observation_phase_${phaseLabelKey(detail.phase)}`),
      ]);
    }
    if (detail.error_kind) {
      meta.push([
        t('logs.observation_attempt_error'),
        t(`logs.observation_error_kind_${errorKindLabelKey(detail.error_kind)}`),
      ]);
    }
    meta.push([
      '实际调用工具',
      detail.called_tools_preview ||
        preview(uniqueLabels((detail.called_tools || []).map(toolName)).join('、')),
    ]);
    return meta;
  }, [detail, t]);

  const sortedAttempts = useMemo(() => {
    if (!detail?.attempts) return [];
    return sortAttempts(detail.attempts);
  }, [detail]);

  const goToPage = (nextPage: number) => {
    setPage(Math.min(Math.max(1, nextPage), totalPages));
  };

  const renderPagination = (compact = false) => (
    <div className={`${styles.pagination} ${compact ? styles.paginationCompact : ''}`}>
      <Button
        variant="secondary"
        size="sm"
        disabled={loading || page <= 1}
        onClick={() => goToPage(page - 1)}
      >
        上一页
      </Button>
      <span>
        第 {page} / {totalPages} 页，共 {total} 条
      </span>
      <Input
        type="number"
        min={1}
        max={totalPages}
        value={String(page)}
        onChange={(event) => goToPage(Number(event.target.value) || 1)}
        className={styles.pageJumpInput}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={loading || page >= totalPages}
        onClick={() => goToPage(page + 1)}
      >
        下一页
      </Button>
    </div>
  );

  const showHoverTooltip = (event: MouseEvent<HTMLElement>, text: string) => {
    const normalized = text.trim();
    if (!normalized || normalized === '—') return;
    setHoverTooltip({ text: normalized, ...tooltipPoint(event.currentTarget, normalized) });
  };

  const hideHoverTooltip = () => setHoverTooltip(null);

  const renderHoverTooltip = () => {
    if (!hoverTooltip || typeof document === 'undefined') return null;
    return createPortal(
      <div className={styles.hoverTooltip} style={{ left: hoverTooltip.x, top: hoverTooltip.y }}>
        {hoverTooltip.text}
      </div>,
      document.body
    );
  };

  const renderStateBadge = (item: RequestLogItem) => {
    const state = deriveItemState(item);
    const label = t(`logs.observation_state_${stateLabelKey(state)}`);
    return (
      <span className={`${styles.stateBadge} ${stateBadgeClass(state)}`}>
        {label}
        {item.phase && state === 'active' && (
          <span className={styles.phaseTag}>
            {t(`logs.observation_phase_${phaseLabelKey(item.phase)}`)}
          </span>
        )}
        {item.recovered && state !== 'recovered' && ` · ${t('logs.observation_recovered_label')}`}
      </span>
    );
  };

  const renderAttemptsSection = () => {
    if (!sortedAttempts.length) return null;
    return (
      <section className={styles.detailSection}>
        <h3>{t('logs.observation_attempts')}</h3>
        <div className={styles.attemptsTableWrap}>
          <table className={styles.attemptsTable}>
            <thead>
              <tr>
                <th>{t('logs.observation_attempt_index')}</th>
                <th>{t('logs.observation_attempt_provider')}</th>
                <th>{t('logs.observation_attempt_credential')}</th>
                <th>{t('logs.observation_attempt_model')}</th>
                <th>{t('logs.observation_attempt_url')}</th>
                <th>{t('logs.observation_attempt_state')}</th>
                <th>{t('logs.observation_attempt_status')}</th>
                <th>{t('logs.observation_attempt_error')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedAttempts.map((att: RequestLogAttempt) => {
                const attState = att.state || 'unknown';
                return (
                  <tr key={att.index}>
                    <td>{att.index}</td>
                    <td>{att.provider || '—'}</td>
                    <td>
                      <span className={styles.credentialCell} title={att.auth_id}>
                        {att.auth_id || '—'}
                      </span>
                    </td>
                    <td>{att.model || '—'}</td>
                    <td title={att.url}>{compactRequestPath(att.url)}</td>
                    <td>
                      <span className={`${styles.stateBadge} ${stateBadgeClass(attState)}`}>
                        {t(`logs.observation_state_${stateLabelKey(attState)}`)}
                      </span>
                    </td>
                    <td>{att.status || '—'}</td>
                    <td>
                      {att.error_kind
                        ? t(`logs.observation_error_kind_${errorKindLabelKey(att.error_kind)}`)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {detail?.attempts_truncated && (
          <div className={styles.attemptsTruncated}>{t('logs.observation_attempts_truncated')}</div>
        )}
      </section>
    );
  };

  const renderRawLogLink = () => {
    if (!detail?.raw_log_id) return null;
    return (
      <button type="button" className={styles.rawLogLink} onClick={() => void downloadRawLog()}>
        <IconDownload size={13} />
        {t('logs.observation_raw_log_link')}: {detail.raw_log_id}
      </button>
    );
  };

  return (
    <Card
      className={styles.card}
      title="请求日志"
      extra={
        <div className={styles.actions}>
          <Input
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              refreshCoordinatorRef.current.scheduleSearch(nextQuery, (value) => {
                setPage(1);
                setDebouncedQuery(value);
              });
            }}
            placeholder="搜索时间、模型、工具、系统提示词、错误、提示词"
            rightElement={<IconSearch size={15} />}
          />
          <Select
            value={stateFilter}
            onChange={(value) => {
              setPage(1);
              setStateFilter(value);
            }}
            fullWidth={false}
            className={styles.stateFilter}
            ariaLabel={t('logs.observation_state_filter')}
            options={STATE_FILTER_OPTIONS.map((opt) => ({
              value: opt.value,
              label: t(opt.labelKey),
            }))}
          />
          <ToggleSwitch checked={autoRefresh} onChange={setAutoRefresh} label="自动刷新" />
          <Input
            type="number"
            min={1}
            max={100}
            value={String(exportPages)}
            onChange={(event) =>
              setExportPages(Math.max(1, Math.min(100, Number(event.target.value) || 1)))
            }
            className={styles.pagesInput}
          />
          <Button variant="secondary" size="sm" onClick={() => void exportRows('csv')}>
            <IconDownload size={15} /> 导出 CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void exportRows('jsonl')}>
            <IconDownload size={15} /> 导出 JSONL
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load(false, true)}
            loading={loading}
          >
            {!loading && <IconRefreshCw size={15} />} 刷新列表
          </Button>
          {renderPagination(true)}
        </div>
      }
    >
      <div className={styles.syncStatus}>
        <span>{refreshState.syncing ? '索引同步中' : '索引快照'}</span>
        {refreshState.lastSyncedAt ? (
          <span>最近同步：{formatTime(refreshState.lastSyncedAt)}</span>
        ) : null}
        {refreshState.retentionDays !== null ? (
          <span>
            结构化日志保留：
            {refreshState.retentionDays === 0 ? '永久' : `${refreshState.retentionDays} 天`}
          </span>
        ) : null}
        {refreshState.lastSyncError ? (
          <span className={styles.syncError}>{refreshState.lastSyncError}</span>
        ) : null}
        {refreshState.observationWarning ? (
          <span className={styles.observationWarning}>{refreshState.observationWarning}</span>
        ) : null}
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      {!loading && items.length === 0 ? (
        <EmptyState
          title={t('logs.observation_empty_title')}
          description={t('logs.observation_empty_desc')}
        />
      ) : (
        <div
          className={styles.tableWrap}
          ref={tableRef}
          tabIndex={0}
          role="region"
          aria-label={t('logs.request_table_label')}
          aria-busy={loading}
          onScroll={hideHoverTooltip}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th>时间</th>
                <th>路径 / 方法</th>
                <th>模型</th>
                <th className={styles.statusCell}>状态</th>
                <th>供应商</th>
                <th>{t('logs.observation_credential')}</th>
                <th>IP / 归属地</th>
                <th>实际调用</th>
                <th>系统提示词</th>
                <th>提示词摘要</th>
                <th>输出摘要</th>
                <th>错误</th>
                <th className={styles.actionCell}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatTime(item.timestamp)}</td>
                  <td
                    onMouseEnter={(event) => showHoverTooltip(event, requestPathTitle(item))}
                    onMouseLeave={hideHoverTooltip}
                  >
                    <span className={styles.requestPathCell}>
                      <span className={styles.methodTag}>{item.method || '—'}</span>
                      <span className={styles.shortText}>{compactRequestPath(item.url)}</span>
                    </span>
                  </td>
                  <td
                    onMouseEnter={(event) => showHoverTooltip(event, requestModelTooltip(item))}
                    onMouseLeave={hideHoverTooltip}
                  >
                    <span className={styles.shortText}>{requestModelLabel(item)}</span>
                  </td>
                  <td className={styles.statusCell}>
                    {renderStateBadge(item)}
                    {item.status ? (
                      <span className={styles.shortText} style={{ marginLeft: 4 }}>
                        {item.status}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={styles.shortText} title={requestLogProviderLabel(item)}>
                      {requestLogProviderLabel(item)}
                    </span>
                  </td>
                  <td>
                    {item.auth_id ? (
                      <span className={styles.credentialCell} title={item.auth_id}>
                        {item.auth_id}
                      </span>
                    ) : (
                      <span className={styles.credentialNone}>
                        {t('logs.observation_credential_none')}
                      </span>
                    )}
                  </td>
                  <td>
                    {item.ip || '未记录'} {item.ip_location || ''}
                  </td>
                  <td>{preview(item.called_tools_preview || item.tool_preview, 46)}</td>
                  <td>{preview(item.system_prompt_preview, 44)}</td>
                  <td>{preview(item.prompt_preview, 48)}</td>
                  <td>{preview(item.output_preview, 48)}</td>
                  <td>{preview(item.error_preview, 48)}</td>
                  <td className={styles.actionCell}>
                    <Button variant="ghost" size="sm" onClick={() => void openDetail(item)}>
                      <IconEye size={15} /> 预览
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {renderPagination()}

      {renderHoverTooltip()}

      <Modal
        open={Boolean(detail)}
        onClose={closeDetail}
        title="请求预览"
        width="min(1180px, 92vw)"
        className={styles.detailModal}
        closeOnOverlayClick
      >
        {detail ? (
          <div className={styles.detail}>
            {detailLoading ? <div className={styles.loadingHint}>{t('common.loading')}</div> : null}
            {detailPending && !detailLoading ? (
              <div className={styles.pendingDetail}>
                {t('logs.observation_pending_detail_active')}
              </div>
            ) : null}
            <div className={styles.detailMeta}>
              {detailMeta.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {detail.recovered && (
              <div className={styles.recoveredLabel}>{t('logs.observation_recovered_label')}</div>
            )}
            {renderAttemptsSection()}
            {renderRawLogLink()}
            {!detailPending && (
              <>
                {sectionText('用户提示词', detail.prompt)}
                {sectionText('响应输出', detail.output)}
                {sectionText('错误内容', detail.error)}
                {toolSection('实际调用工具', detail.called_tools)}
                {mcpSection(detail.mcps)}
                {skillSection(detail.skills)}
                {sectionText('系统提示词', detail.system_prompt)}
                {toolSection('全部可用工具', detail.available_tools)}
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
