import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconDownload, IconEye, IconRefreshCw, IconSearch } from '@/components/ui/icons';
import { requestLogsApi, type RequestLogDetail, type RequestLogItem } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { downloadBlob } from '@/utils/download';
import { getErrorMessage } from '@/utils/helpers';
import styles from './RequestLogsPanel.module.scss';

const PAGE_SIZE = 30;
const AUTO_REFRESH_MS = 5000;

type RequestToolInfo = NonNullable<RequestLogDetail['called_tools']>[number];
type RequestMcpInfo = NonNullable<RequestLogDetail['mcps']>[number];
type RequestSkillInfo = NonNullable<RequestLogDetail['skills']>[number];

const preview = (value?: string, limit = 56) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const formatTime = (value?: string) => {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
};

const uniqueLabels = (values: string[]) => Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));

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
  const [items, setItems] = useState<RequestLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<RequestLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportPages, setExportPages] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  const load = useCallback(
    async (silent = false) => {
      if (connectionStatus !== 'connected') return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const data = await requestLogsApi.list({ q: query.trim() || undefined, limit: PAGE_SIZE, offset });
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total) || 0);
      } catch (err: unknown) {
        const message = getErrorMessage(err) || '加载请求日志失败';
        setError(message);
        if (!silent) {
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [connectionStatus, offset, query]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || connectionStatus !== 'connected') return undefined;
    const timer = window.setInterval(() => {
      void load(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, connectionStatus, load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetail(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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
        q: query.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
        pages: exportPages,
        format
      });
      downloadBlob({
        filename: `request-logs-${exportPages}页.${format}`,
        blob: new Blob([response.data], { type: format === 'csv' ? 'text/csv' : 'application/x-ndjson' })
      });
    } catch (err: unknown) {
      showNotification(getErrorMessage(err) || '导出请求日志失败', 'error');
    }
  };

  const detailMeta = useMemo(() => {
    if (!detail) return [];
    return [
      ['请求', `${detail.method || '—'} ${detail.url || '—'}`],
      ['模型', detail.channel_model || detail.upstream_model || detail.model || '—'],
      ['IP', `${detail.ip || '未记录'} ${detail.ip_location || ''}`.trim()],
      ['状态', `${detail.success ? '成功' : '失败'} · ${detail.status || 'unknown'}`],
      ['实际调用工具', detail.called_tools_preview || preview(uniqueLabels((detail.called_tools || []).map(toolName)).join('、'))]
    ];
  }, [detail]);

  return (
    <Card
      className={styles.card}
      title="请求日志"
      extra={
        <div className={styles.actions}>
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
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
            onChange={(event) => setExportPages(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
            className={styles.pagesInput}
          />
          <Button variant="secondary" size="sm" onClick={() => void exportRows('csv')}>
            <IconDownload size={15} /> 导出 CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void exportRows('jsonl')}>
            <IconDownload size={15} /> 导出 JSONL
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void load(false)} loading={loading}>
            {!loading && <IconRefreshCw size={15} />} 刷新列表
          </Button>
        </div>
      }
    >
      {error ? <div className="error-box">{error}</div> : null}
      {!loading && items.length === 0 ? (
        <EmptyState title="暂无请求日志" description="开启请求日志后，新请求会按时间顺序出现在这里。" />
      ) : (
        <div className={styles.workspace}>
          <div className={styles.listPane}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>请求</th>
                    <th>模型</th>
                    <th>IP</th>
                    <th>提示词</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const selected = detail?.id === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={selected ? styles.selectedRow : ''}
                        onClick={() => void openDetail(item)}
                      >
                        <td>{formatTime(item.timestamp)}</td>
                        <td>
                          <div className={styles.requestCell}>
                            <strong>{item.method || '—'}</strong>
                            <span>{item.url || '—'}</span>
                          </div>
                        </td>
                        <td>{preview(item.channel_model || item.upstream_model || item.model, 34)}</td>
                        <td>{item.ip || '未记录'} {item.ip_location || ''}</td>
                        <td>
                          <div className={styles.promptCell}>
                            <span>{preview(item.prompt_preview, 42)}</span>
                            <small>{preview(item.called_tools_preview || item.tool_preview, 34)}</small>
                          </div>
                        </td>
                        <td>
                          <span className={item.success ? styles.ok : styles.fail}>
                            {item.success ? '成功' : '失败'} {item.status || ''}
                          </span>
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openDetail(item);
                            }}
                          >
                            <IconEye size={15} /> 预览
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <aside className={styles.previewPane}>
            <div className={styles.previewHeader}>
              <div>
                <strong>请求预览</strong>
                <span>{detail ? formatTime(detail.timestamp) : '选择左侧请求查看完整内容'}</span>
              </div>
              {detail ? (
                <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>
                  关闭
                </Button>
              ) : null}
            </div>
            {detail ? (
              <div className={styles.detail}>
                {detailLoading ? <div className={styles.loadingHint}>{t('common.loading')}</div> : null}
                <div className={styles.detailMeta}>
                  {detailMeta.map(([label, value]) => (
                    <div key={label}><span>{label}</span><strong>{value}</strong></div>
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
            ) : (
              <div className={styles.previewEmpty}>暂无预览</div>
            )}
          </aside>
        </div>
      )}
      <div className={styles.pagination}>
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</Button>
        <span>第 {page} / {totalPages} 页，共 {total} 条</span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</Button>
      </div>

    </Card>
  );
}
