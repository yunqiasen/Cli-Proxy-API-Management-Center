import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { IconDownload, IconEye, IconRefreshCw, IconSearch } from '@/components/ui/icons';
import { requestLogsApi, type RequestLogDetail, type RequestLogItem } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { downloadBlob } from '@/utils/download';
import { getErrorMessage } from '@/utils/helpers';
import styles from './RequestLogsPanel.module.scss';

const PAGE_SIZE = 30;

const preview = (value?: string) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

const formatTime = (value?: string) => {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  const load = useCallback(async () => {
    if (connectionStatus !== 'connected') return;
    setLoading(true);
    setError('');
    try {
      const data = await requestLogsApi.list({ q: query.trim() || undefined, limit: PAGE_SIZE, offset });
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total) || 0);
    } catch (err: unknown) {
      const message = getErrorMessage(err) || '加载请求日志失败';
      setError(message);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [connectionStatus, offset, query]);

  useEffect(() => {
    void load();
  }, [load]);

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
      ['状态', `${detail.success ? '成功' : '失败'} · ${detail.status || 'unknown'}`]
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
            placeholder="搜索时间、模型、错误、提示词"
            rightElement={<IconSearch size={15} />}
          />
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
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
            {!loading && <IconRefreshCw size={15} />} 刷新
          </Button>
        </div>
      }
    >
      {error ? <div className="error-box">{error}</div> : null}
      {!loading && items.length === 0 ? (
        <EmptyState title="暂无请求日志" description="开启请求日志后，新请求会按时间顺序出现在这里。" />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>时间</th>
                <th>路径 / 方法</th>
                <th>模型</th>
                <th>IP / 归属地</th>
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
                  <td>{item.method || '—'} {item.url || '—'}</td>
                  <td>{item.channel_model || item.upstream_model || item.model || '—'}</td>
                  <td>{item.ip || '未记录'} {item.ip_location || ''}</td>
                  <td>{preview(item.prompt_preview)}</td>
                  <td>{preview(item.output_preview)}</td>
                  <td><span className={item.success ? styles.ok : styles.fail}>{item.success ? '成功' : '失败'} {item.status || ''}</span></td>
                  <td>{preview(item.error_preview)}</td>
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
      <div className={styles.pagination}>
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</Button>
        <span>第 {page} / {totalPages} 页，共 {total} 条</span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</Button>
      </div>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="请求预览" width="min(1100px, 92vw)">
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
            {sectionText('系统提示词', detail.system_prompt)}
            {detail.mcps?.length ? (
              <section className={styles.detailSection}>
                <h3>MCP 功能介绍</h3>
                {detail.mcps.map((mcp) => <pre key={mcp.name}>{mcp.name}\n{mcp.description || ''}</pre>)}
              </section>
            ) : null}
            {detail.skills?.length ? (
              <section className={styles.detailSection}>
                <h3>Skill 功能介绍和提示词</h3>
                {detail.skills.map((skill) => <pre key={`${skill.name}-${skill.path}`}>{skill.name}\n{skill.description || ''}\n{skill.prompt || ''}</pre>)}
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
