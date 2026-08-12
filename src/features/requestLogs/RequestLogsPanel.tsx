import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconDownload, IconEye, IconRefreshCw, IconSearch } from '@/components/ui/icons';
import { requestLogsApi, type RequestLogDetail, type RequestLogItem } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { downloadBlob } from '@/utils/download';
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

const PAGE_SIZE = 30;
const AUTO_REFRESH_MS = 5000;

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

export function RequestLogsPanel() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [refreshState, setRefreshState] = useState(() =>
    createRequestLogRefreshState<RequestLogItem>()
  );
  const { items, total, loading, error } = refreshState;
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const refreshCoordinatorRef = useRef(createRequestLogRefreshCoordinator());
  const activeRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const [detail, setDetail] = useState<RequestLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportPages, setExportPages] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hoverTooltip, setHoverTooltip] = useState<HoverTooltipState | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  const load = useCallback(
    async (silent = false, replaceActive = false) => {
      if (connectionStatus !== 'connected') return;
      const coordinator = refreshCoordinatorRef.current;
      if (replaceActive && activeRequestRef.current) {
        activeRequestRef.current.controller.abort();
        coordinator.finish(activeRequestRef.current.id);
        activeRequestRef.current = null;
      }
      const requestId = coordinator.tryStart();
      if (requestId === null) return;

      const controller = new AbortController();
      activeRequestRef.current = { id: requestId, controller };
      setRefreshState((state) => beginRequestLogRefresh(state, silent));
      try {
        const data = await requestLogsApi.list(
          {
            q: debouncedQuery.trim() || undefined,
            limit: PAGE_SIZE,
            offset,
          },
          { signal: controller.signal }
        );
        setRefreshState((state) => applyRequestLogRefreshSuccess(state, data));
      } catch (err: unknown) {
        const canceled =
          controller.signal.aborted ||
          (typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            String((err as { code?: string }).code) === 'ERR_CANCELED');
        if (!canceled) {
          const message = getErrorMessage(err) || '加载请求日志失败';
          setRefreshState((state) => applyRequestLogRefreshError(state, message));
        }
      } finally {
        coordinator.finish(requestId);
        if (activeRequestRef.current?.id === requestId) activeRequestRef.current = null;
      }
    },
    [connectionStatus, debouncedQuery, offset]
  );

  useEffect(() => {
    void load(false, true);
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || connectionStatus !== 'connected') return undefined;
    const timer = window.setInterval(() => {
      void load(true, false);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, connectionStatus, load]);

  useEffect(
    () => () => {
      refreshCoordinatorRef.current.cancelSearch();
      activeRequestRef.current?.controller.abort();
    },
    []
  );

  const openDetail = async (item: RequestLogItem) => {
    setDetail(item as RequestLogDetail);
    setDetailLoading(true);
    try {
      setDetail(await requestLogsApi.detail(item.id));
    } catch (err: unknown) {
      showNotification(getErrorMessage(err) || '加载请求详情失败', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const exportRows = async (format: 'csv' | 'jsonl') => {
    try {
      const response = await requestLogsApi.export({
        q: debouncedQuery.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
        pages: exportPages,
        format,
      });
      downloadBlob({
        filename: `request-logs-${exportPages}页.${format}`,
        blob: new Blob([response.data], {
          type: format === 'csv' ? 'text/csv' : 'application/x-ndjson',
        }),
      });
    } catch (err: unknown) {
      showNotification(getErrorMessage(err) || '导出请求日志失败', 'error');
    }
  };

  const detailMeta = useMemo(() => {
    if (!detail) return [];
    return [
      ['请求', `${detail.method || '—'} ${detail.url || '—'}`],
      ['模型', requestLogModelLabel(detail)],
      ['供应商', requestLogProviderLabel(detail)],
      ['IP', `${detail.ip || '未记录'} ${detail.ip_location || ''}`.trim()],
      ['状态', `${detail.success ? '成功' : '失败'} · ${detail.status || 'unknown'}`],
      [
        '实际调用工具',
        detail.called_tools_preview ||
          preview(uniqueLabels((detail.called_tools || []).map(toolName)).join('、')),
      ],
    ];
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
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      {!loading && items.length === 0 ? (
        <EmptyState
          title="暂无请求日志"
          description="开启请求日志后，新请求会按时间顺序出现在这里。"
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>时间</th>
                <th>路径 / 方法</th>
                <th>模型</th>
                <th>供应商</th>
                <th>IP / 归属地</th>
                <th>实际调用</th>
                <th>系统提示词</th>
                <th>提示词摘要</th>
                <th>输出摘要</th>
                <th>状态</th>
                <th>错误</th>
                <th>操作</th>
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
                  <td>
                    <span className={styles.shortText} title={requestLogProviderLabel(item)}>
                      {requestLogProviderLabel(item)}
                    </span>
                  </td>
                  <td>
                    {item.ip || '未记录'} {item.ip_location || ''}
                  </td>
                  <td>{preview(item.called_tools_preview || item.tool_preview, 46)}</td>
                  <td>{preview(item.system_prompt_preview, 44)}</td>
                  <td>{preview(item.prompt_preview, 48)}</td>
                  <td>{preview(item.output_preview, 48)}</td>
                  <td>
                    <span className={item.success ? styles.ok : styles.fail}>
                      {item.success ? '成功' : '失败'} {item.status || ''}
                    </span>
                  </td>
                  <td>{preview(item.error_preview, 48)}</td>
                  <td>
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
        onClose={() => setDetail(null)}
        title="请求预览"
        width="min(1180px, 92vw)"
        className={styles.detailModal}
        closeOnOverlayClick
      >
        {detail ? (
          <div className={styles.detail}>
            {detailLoading ? <div className={styles.loadingHint}>{t('common.loading')}</div> : null}
            <div className={styles.detailMeta}>
              {detailMeta.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {sectionText('用户提示词', detail.prompt)}
            {sectionText('响应输出', detail.output)}
            {sectionText('错误内容', detail.error)}
            {toolSection('实际调用工具', detail.called_tools)}
            {mcpSection(detail.mcps)}
            {skillSection(detail.skills)}
            {sectionText('系统提示词', detail.system_prompt)}
            {toolSection('全部可用工具', detail.available_tools)}
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
