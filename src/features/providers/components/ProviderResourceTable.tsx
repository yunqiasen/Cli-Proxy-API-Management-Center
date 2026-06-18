import { useCallback, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconEye,
  IconPencil,
  IconTrash2,
} from '@/components/ui/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import {
  getOpenAIProviderRecentStatusData,
  getOpenAIProviderTotalStats,
  getOpenAIProviderUsageDetails,
  getProviderRecentStatusData,
  getProviderTotalStats,
  getProviderUsageDetails,
  type ProviderRecentUsageMap,
} from '@/components/providers/utils';
import type { OpenAIProviderConfig } from '@/types';
import type {
  ApiKeyUsageFailureDetail,
  ApiKeyUsageSuccessDetail,
  StatusBarData,
} from '@/utils/recentRequests';
import type { ProviderResource } from '../types';
import styles from './ProviderResourceTable.module.scss';
import statusBarStyles from './providerStatusBar.module.scss';

interface ProviderResourceTableProps {
  resources: ProviderResource[];
  selectedId?: string | null;
  disableMutations?: boolean;
  usageByProvider?: ProviderRecentUsageMap;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled?: (resource: ProviderResource, disabled: boolean) => void;
}

const columnWidths = ['18%', '18%', '6%', '14%', '24%', '20%'];
const maxVisibleModelChips = 4;

type UsageTooltipPlacement = 'left' | 'right';

interface UsageTooltipRow {
  model: string;
  status: number;
  count: number;
  error?: string;
}

interface UsageTooltipState {
  title: string;
  rows: UsageTooltipRow[];
  x: number;
  y: number;
  placement: UsageTooltipPlacement;
}

const usageTooltipPoint = (clientX: number, clientY: number) => {
  const widthEstimate = Math.min(760, Math.max(280, window.innerWidth - 40));
  const heightEstimate = Math.min(620, window.innerHeight * 0.7);
  const canShowLeft = clientX - 12 - widthEstimate >= 20;
  const canShowRight = clientX + 12 + widthEstimate <= window.innerWidth - 20;
  const placement: UsageTooltipPlacement = canShowRight || !canShowLeft ? 'right' : 'left';
  return {
    x: placement === 'left'
      ? Math.min(window.innerWidth - 20, clientX - 12)
      : Math.min(Math.max(20, clientX + 12), Math.max(20, window.innerWidth - widthEstimate - 20)),
    y: Math.min(Math.max(16, clientY + 12), Math.max(16, window.innerHeight - heightEstimate - 16)),
    placement,
  };
};

const resolveStatusBarData = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderRecentStatusData(
      resource.raw as OpenAIProviderConfig,
      usageByProvider
    );
  }
  return getProviderRecentStatusData(
    usageByProvider,
    resource.brand,
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  );
};

const resolveTotalStats = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderTotalStats(
      resource.raw as OpenAIProviderConfig,
      usageByProvider
    );
  }
  return getProviderTotalStats(
    usageByProvider,
    resource.brand,
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  );
};

const resolveUsageDetails = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): { successDetails: ApiKeyUsageSuccessDetail[]; failureDetails: ApiKeyUsageFailureDetail[] } => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderUsageDetails(resource.raw as OpenAIProviderConfig, usageByProvider);
  }
  return getProviderUsageDetails(
    usageByProvider,
    resource.brand,
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  );
};

const formatStatus = (status: number) => (status > 0 ? String(status) : 'unknown');

export function ProviderResourceTable({
  resources,
  selectedId,
  disableMutations,
  usageByProvider,
  onView,
  onEdit,
  onDelete,
  onToggleDisabled,
}: ProviderResourceTableProps) {
  const { t } = useTranslation();

  const renderMetric = (key: string, label: string, value: number) => (
    <span key={key} className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </span>
  );

  const renderFlagTag = (key: string, label: string) => (
    <span key={key} className={styles.flagTag}>
      {label}
    </span>
  );

  const renderModelChips = (r: ProviderResource) => {
    if (r.modelDisplays.length === 0) return null;
    const visibleModels = r.modelDisplays.slice(0, maxVisibleModelChips);
    const hiddenCount = Math.max(r.modelDisplays.length - visibleModels.length, 0);
    return (
      <div className={styles.modelChips} title={r.modelDisplays.join(', ')}>
        {visibleModels.map((name) => (
          <span key={name} className={styles.modelChip}>
            {name}
          </span>
        ))}
        {hiddenCount > 0 && <span className={styles.modelMore}>+{hiddenCount}</span>}
      </div>
    );
  };

  const renderModelsSummary = (r: ProviderResource) => {
    const items: ReactNode[] = [];
    if (r.brand === 'openaiCompatibility') {
      items.push(
        renderMetric('models', t('providersPage.table.metrics.models'), r.modelCount),
        renderMetric('keys', t('providersPage.table.metrics.keys'), r.apiKeyEntryCount),
        renderMetric('headers', t('providersPage.table.metrics.headers'), r.headerCount),
      );
    } else {
      items.push(
        renderMetric('models', t('providersPage.table.metrics.models'), r.modelCount),
        renderMetric('headers', t('providersPage.table.metrics.headers'), r.headerCount),
      );
      if (r.brand === 'codex' && r.flags.websockets) {
        items.push(renderFlagTag('ws', t('providersPage.table.websocketsTag')));
      }
      if (r.brand === 'claude' && r.flags.cloakEnabled) {
        items.push(renderFlagTag('cloak', t('providersPage.table.cloakTag')));
      }
    }
    return (
      <div className={styles.modelSummaryCell}>
        <div className={styles.metricsCell}>{items}</div>
        {renderModelChips(r)}
      </div>
    );
  };

  const renderStatus = (r: ProviderResource) => {
    if (r.disabled) {
      return (
        <span className={`${styles.statusBadge} ${styles.statusDisabled}`}>
          <IconAlertTriangle size={14} />
          {t('providersPage.status.disabled')}
        </span>
      );
    }
    return (
      <span className={`${styles.statusBadge} ${styles.statusActive}`}>
        <IconCheckCircle2 size={14} />
        {t('providersPage.status.active')}
      </span>
    );
  };

  const [usageTooltip, setUsageTooltip] = useState<UsageTooltipState | null>(null);

  const openUsageTooltip = useCallback(
    (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, title: string, rows: UsageTooltipRow[]) => {
      if (!rows.length) return;
      const point = 'clientX' in event && event.clientX > 0
        ? usageTooltipPoint(event.clientX, event.clientY)
        : (() => {
            const rect = event.currentTarget.getBoundingClientRect();
            return usageTooltipPoint(rect.left + rect.width / 2, rect.bottom);
          })();
      setUsageTooltip({ title, rows: rows.slice(0, 10), ...point });
    },
    []
  );

  const moveUsageTooltip = useCallback((event: MouseEvent<HTMLElement>) => {
    setUsageTooltip((current) => (current ? { ...current, ...usageTooltipPoint(event.clientX, event.clientY) } : current));
  }, []);

  const closeUsageTooltip = useCallback(() => setUsageTooltip(null), []);

  const renderUsageTooltip = () => {
    if (!usageTooltip || typeof document === 'undefined') return null;
    return createPortal(
      <div
        className={`${styles.usageTooltipPortal} ${
          usageTooltip.placement === 'left' ? styles.usageTooltipPortalLeft : styles.usageTooltipPortalRight
        }`}
        style={{ left: usageTooltip.x, top: usageTooltip.y }}
        role="tooltip"
      >
        <span className={styles.usageTooltipTitle}>{usageTooltip.title}</span>
        <div className={styles.usageTooltipRows}>
          {usageTooltip.rows.map((item, index) => (
            <div className={styles.usageTooltipRow} key={`${item.model}-${item.status}-${item.error ?? ''}-${index}`}>
              <span>{item.model}</span>
              <span>{formatStatus(item.status)}</span>
              <strong>{item.count}</strong>
              {item.error ? <em>{item.error}</em> : null}
            </div>
          ))}
        </div>
      </div>,
      document.body
    );
  };

  const renderUsageStats = (resource: ProviderResource, usage: ProviderRecentUsageMap) => {
    const stats = resolveTotalStats(resource, usage);
    const details = resolveUsageDetails(resource, usage);
    const hasSuccessDetails = stats.success > 0 && details.successDetails.length > 0;
    const hasFailureDetails = stats.failure > 0 && details.failureDetails.length > 0;

    const successRows = details.successDetails.map((item) => ({
      model: item.model,
      status: item.status,
      count: item.count,
    }));
    const failureRows = details.failureDetails.map((item) => ({
      model: item.model,
      status: item.status,
      count: item.count,
      error: item.error,
    }));

    return (
      <div className={styles.stats}>
        <span
          className={`${styles.statPill} ${styles.statSuccess} ${hasSuccessDetails ? styles.statInteractive : ''}`}
          tabIndex={hasSuccessDetails ? 0 : undefined}
          onMouseEnter={hasSuccessDetails ? (event) => openUsageTooltip(event, t('stats.success'), successRows) : undefined}
          onMouseMove={hasSuccessDetails ? moveUsageTooltip : undefined}
          onMouseLeave={hasSuccessDetails ? closeUsageTooltip : undefined}
          onFocus={hasSuccessDetails ? (event) => openUsageTooltip(event, t('stats.success'), successRows) : undefined}
          onBlur={hasSuccessDetails ? closeUsageTooltip : undefined}
        >
          {t('stats.success')}: {stats.success}
        </span>
        <span
          className={`${styles.statPill} ${styles.statFailure} ${hasFailureDetails ? styles.statInteractive : ''}`}
          tabIndex={hasFailureDetails ? 0 : undefined}
          onMouseEnter={hasFailureDetails ? (event) => openUsageTooltip(event, t('stats.failure'), failureRows) : undefined}
          onMouseMove={hasFailureDetails ? moveUsageTooltip : undefined}
          onMouseLeave={hasFailureDetails ? closeUsageTooltip : undefined}
          onFocus={hasFailureDetails ? (event) => openUsageTooltip(event, t('stats.failure'), failureRows) : undefined}
          onBlur={hasFailureDetails ? closeUsageTooltip : undefined}
        >
          {t('stats.failure')}: {stats.failure}
        </span>
      </div>
    );
  };

  const renderPrimary = (r: ProviderResource) => {
    if (r.brand === 'openaiCompatibility') {
      const extra = r.apiKeyEntryCount > 1 ? ` · +${r.apiKeyEntryCount - 1}` : '';
      return (
        <div className={styles.primaryCell}>
          <span className={styles.primaryName}>{r.name ?? r.identifier}</span>
          <span className={styles.primarySub}>
            {(r.apiKeyPreview ?? '—') + extra}
          </span>
        </div>
      );
    }
    return (
      <div className={styles.primaryCell}>
        <span className={styles.primaryName}>{r.apiKeyPreview ?? '—'}</span>
        {r.authIndex ? (
          <span className={styles.primarySub}>auth: {r.authIndex}</span>
        ) : null}
      </div>
    );
  };

  const renderBaseUrl = (r: ProviderResource) => {
    if (r.brand === 'claude' && !r.baseUrl) {
      return (
        <span className={styles.baseUrl}>
          https://api.anthropic.com {t('providersPage.status.defaultSuffix')}
        </span>
      );
    }
    return (
      <span className={styles.baseUrl}>
        {r.baseUrl ?? t('providersPage.status.notSet')}
      </span>
    );
  };

  return (
    <>
    <Table
      cols={columnWidths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    >
      <TableHeader>
        <TableRow>
          <TableHead>{t('providersPage.table.key')}</TableHead>
          <TableHead>{t('providersPage.table.baseUrl')}</TableHead>
          <TableHead>{t('providersPage.table.prefix')}</TableHead>
          <TableHead>{t('providersPage.table.models')}</TableHead>
          <TableHead>{t('providersPage.table.status')}</TableHead>
          <TableHead alignRight>{t('providersPage.table.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {resources.map((resource) => {
          return (
            <TableRow key={resource.id} selected={resource.id === selectedId}>
              <TableCell>{renderPrimary(resource)}</TableCell>
              <TableCell>{renderBaseUrl(resource)}</TableCell>
              <TableCell>
                {resource.prefix ? (
                  <span className={styles.chip}>{resource.prefix}</span>
                ) : (
                  <span className={styles.baseUrl}>{t('providersPage.status.none')}</span>
                )}
              </TableCell>
              <TableCell>{renderModelsSummary(resource)}</TableCell>
              <TableCell>
                <div className={styles.statusCell}>
                  {renderStatus(resource)}
                  {usageByProvider ? (
                    <>
                      {renderUsageStats(resource, usageByProvider)}
                      <ProviderStatusBar
                        statusData={resolveStatusBarData(resource, usageByProvider)}
                        styles={statusBarStyles}
                      />
                    </>
                  ) : null}
                </div>
              </TableCell>
              <TableCell alignRight>
                <div className={styles.actions}>
                  {onToggleDisabled ? (
                    <span
                      className={styles.toggleWrap}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ToggleSwitch
                        checked={!resource.disabled}
                        disabled={disableMutations}
                        onChange={(value) =>
                          onToggleDisabled(resource, !value)
                        }
                        ariaLabel={
                          resource.disabled
                            ? t('providersPage.actions.enable')
                            : t('providersPage.actions.disable')
                        }
                      />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={t('providersPage.actions.view')}
                    title={t('providersPage.actions.view')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(resource);
                    }}
                  >
                    <IconEye size={16} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={t('providersPage.actions.edit')}
                    title={t('providersPage.actions.edit')}
                    disabled={disableMutations}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(resource);
                    }}
                  >
                    <IconPencil size={16} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    aria-label={t('providersPage.actions.delete')}
                    title={t('providersPage.actions.delete')}
                    disabled={disableMutations}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(resource);
                    }}
                  >
                    <IconTrash2 size={16} />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    {renderUsageTooltip()}
    </>
  );
}
