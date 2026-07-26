import { useCallback, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconBot,
  IconEye,
  IconLoader2,
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
  getProviderApiKeysRecentStatusData,
  getProviderApiKeysTotalStats,
  getProviderApiKeysUsageDetails,
  type ProviderRecentUsageMap,
} from '@/components/providers/utils';
import { getNativeProviderUsageIdentity } from '../nativeProviderUsageIdentity';
import type { CodexProbeStatus } from '../codexProviderProbe';
import type { OpenAIProviderConfig } from '@/types';
import type {
  ApiKeyUsageFailureDetail,
  ApiKeyUsageSuccessDetail,
  StatusBarData,
} from '@/utils/recentRequests';
import type { ProviderResource } from '../types';
import { isMultiProtocolSponsorBrand } from '../sponsorDefinitions';
import styles from './ProviderResourceTable.module.scss';
import statusBarStyles from './providerStatusBar.module.scss';

interface ProviderResourceTableProps {
  resources: ProviderResource[];
  selectedId?: string | null;
  disableMutations?: boolean;
  usageByProvider?: ProviderRecentUsageMap;
  codexProbeStatuses?: Record<string, CodexProbeStatus>;
  codexBulkTesting?: boolean;
  onTestCodexResource?: (resource: ProviderResource) => void;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled?: (resource: ProviderResource, disabled: boolean) => void;
}

const columnWidths = ['180px', '220px', '72px', '138px', '174px', '214px'];
const maxVisibleModelChips = 4;
const maxVisibleExcludedModels = 2;

type UsageTooltipPlacement = 'above' | 'below';

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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const usageTooltipPoint = (target: HTMLElement, rowCount: number) => {
  const rect = target.getBoundingClientRect();
  const widthEstimate = rowCount > 0 ? 560 : 320;
  const heightEstimate = Math.min(360, 42 + rowCount * 32);
  const targetCenter = rect.left + rect.width / 2;
  const preferredLeft = targetCenter - widthEstimate / 2;
  const left = clamp(preferredLeft, 12, Math.max(12, window.innerWidth - widthEstimate - 12));
  const belowTop = rect.bottom + 6;
  const canShowBelow = belowTop + heightEstimate <= window.innerHeight - 12;
  return {
    x: left,
    y: canShowBelow ? belowTop : Math.max(12, rect.top - heightEstimate - 6),
    placement: canShowBelow ? ('below' as const) : ('above' as const),
  };
};

const isSponsorResource = (resource: ProviderResource): boolean =>
  isMultiProtocolSponsorBrand(resource.brand);

const getUsageProvider = (resource: ProviderResource): string =>
  getNativeProviderUsageIdentity(resource.brand, resource.name);

const getUsageApiKeys = (resource: ProviderResource): string[] => {
  if (resource.apiKeys?.length) return resource.apiKeys;
  if (resource.apiKey) return [resource.apiKey];
  return resource.brand === 'image' || resource.brand === 'video' || resource.brand === 'audio'
    ? ['']
    : [];
};

const resolveStatusBarData = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderRecentStatusData(resource.raw as OpenAIProviderConfig, usageByProvider);
  }
  return getProviderApiKeysRecentStatusData(
    usageByProvider,
    getUsageProvider(resource),
    getUsageApiKeys(resource),
    resource.baseUrl ?? undefined
  );
};

const resolveTotalStats = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderTotalStats(resource.raw as OpenAIProviderConfig, usageByProvider);
  }
  return getProviderApiKeysTotalStats(
    usageByProvider,
    getUsageProvider(resource),
    getUsageApiKeys(resource),
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
  return getProviderApiKeysUsageDetails(
    usageByProvider,
    getUsageProvider(resource),
    getUsageApiKeys(resource),
    resource.baseUrl ?? undefined
  );
};

const formatStatus = (status: number) => (status > 0 ? String(status) : 'unknown');

export function ProviderResourceTable({
  resources,
  selectedId,
  disableMutations,
  usageByProvider,
  codexProbeStatuses,
  codexBulkTesting,
  onTestCodexResource,
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

  const renderModelChips = (resource: ProviderResource) => {
    if (resource.modelDisplays.length === 0) return null;
    const visibleModels = resource.modelDisplays.slice(0, maxVisibleModelChips);
    const hiddenCount = Math.max(resource.modelDisplays.length - visibleModels.length, 0);
    return (
      <div className={styles.modelChips} title={resource.modelDisplays.join(', ')}>
        {visibleModels.map((name) => (
          <span key={name} className={styles.modelChip}>
            {name}
          </span>
        ))}
        {hiddenCount > 0 && <span className={styles.modelMore}>+{hiddenCount}</span>}
      </div>
    );
  };

  const renderRoutingMeta = (resource: ProviderResource) => {
    const excludedTitle = resource.excludedModels.join(', ');
    const excludedPreview = resource.excludedModels.slice(0, maxVisibleExcludedModels).join(', ');
    const hiddenExcludedCount = Math.max(
      resource.excludedModels.length - maxVisibleExcludedModels,
      0
    );
    return (
      <div className={styles.routingMeta}>
        <span className={styles.priorityTag} title={t('providersPage.form.priority')}>
          {t('providersPage.form.priority')}: {resource.priority}
        </span>
        {resource.excludedModelCount > 0 ? (
          <span className={styles.excludedTag} title={excludedTitle}>
            {t('providersPage.form.excludedSection')}: {excludedPreview}
            {hiddenExcludedCount > 0 ? ` +${hiddenExcludedCount}` : ''}
          </span>
        ) : null}
      </div>
    );
  };

  const renderProtocolSummary = (r: ProviderResource) =>
    (r.flags.protocols ?? [])
      .map((protocol) => t(`providersPage.sponsor.protocols.${protocol}`))
      .join(' / ');

  const renderModelsSummary = (r: ProviderResource) => {
    const items: ReactNode[] = [];
    if (isSponsorResource(r)) {
      (r.flags.protocols ?? []).forEach((protocol) => {
        items.push(renderFlagTag(protocol, t(`providersPage.sponsor.protocols.${protocol}`)));
      });
      return <div className={styles.metricsCell}>{items}</div>;
    }
    if (r.brand === 'image' || r.brand === 'video' || r.brand === 'audio') {
      items.push(
        renderMetric('models', t('providersPage.table.metrics.models'), r.modelCount),
        renderMetric(
          'operations',
          t('providersPage.table.metrics.operations'),
          r.operationCount ?? 0
        ),
        renderMetric('keys', t('providersPage.table.metrics.keys'), r.apiKeyEntryCount)
      );
      (r.mediaCapabilities ?? []).slice(0, 3).forEach((capability) => {
        items.push(
          renderFlagTag(`cap-${capability}`, t(`providersPage.media.capabilityNames.${capability}`))
        );
      });
    } else if (r.brand === 'openaiCompatibility') {
      items.push(
        renderMetric('models', t('providersPage.table.metrics.models'), r.modelCount),
        renderMetric('keys', t('providersPage.table.metrics.keys'), r.apiKeyEntryCount),
        renderMetric('headers', t('providersPage.table.metrics.headers'), r.headerCount)
      );
    } else {
      items.push(renderMetric('models', t('providersPage.table.metrics.models'), r.modelCount));
      if (r.apiKeyEntryCount > 0) {
        items.push(renderMetric('keys', t('providersPage.table.metrics.keys'), r.apiKeyEntryCount));
      }
      items.push(renderMetric('headers', t('providersPage.table.metrics.headers'), r.headerCount));
      if ((r.brand === 'codex' || r.brand === 'xai') && r.flags.websockets) {
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

  const renderCodexProbeStatus = (resource: ProviderResource) => {
    if (resource.brand !== 'codex') return null;
    const status = codexProbeStatuses?.[resource.id];
    if (!status || status.state === 'idle') return null;
    const title = status.message || undefined;
    if (status.state === 'loading') {
      return (
        <span
          className={`${styles.probeStatus} ${styles.probeStatusLoading}`}
          title={title}
          role="status"
          aria-live="polite"
        >
          <IconLoader2 className={styles.probeSpinner} size={13} />
          {t('providersPage.connectivity.simulating')}
        </span>
      );
    }
    return (
      <span
        className={`${styles.probeStatus} ${
          status.state === 'success' ? styles.probeStatusSuccess : styles.probeStatusError
        }`}
        title={title}
        role="status"
        aria-live="polite"
        aria-label={title || undefined}
      >
        {status.state === 'success' ? (
          <IconCheckCircle2 size={13} />
        ) : (
          <IconAlertTriangle size={13} />
        )}
        {t('providersPage.connectivity.simulateResult', {
          success: status.successCount,
          total: status.total,
        })}
      </span>
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
    (
      event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
      title: string,
      rows: UsageTooltipRow[]
    ) => {
      if (!rows.length) return;
      const visibleRows = rows.slice(0, 10);
      setUsageTooltip({
        title,
        rows: visibleRows,
        ...usageTooltipPoint(event.currentTarget, visibleRows.length),
      });
    },
    []
  );

  const closeUsageTooltip = useCallback(() => setUsageTooltip(null), []);

  const renderUsageTooltip = () => {
    if (!usageTooltip || typeof document === 'undefined') return null;
    return createPortal(
      <div
        className={styles.usageTooltipPortal}
        data-placement={usageTooltip.placement}
        style={{ left: usageTooltip.x, top: usageTooltip.y }}
        role="tooltip"
      >
        <span className={styles.usageTooltipTitle}>{usageTooltip.title}</span>
        <div className={styles.usageTooltipRows}>
          {usageTooltip.rows.map((item, index) => (
            <div
              className={styles.usageTooltipRow}
              key={`${item.model}-${item.status}-${item.error ?? ''}-${index}`}
            >
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
    const successRows = details.successDetails.length
      ? details.successDetails.map((item) => ({
          model: item.model,
          status: item.status,
          count: item.count,
        }))
      : stats.success > 0
        ? [{ model: 'unknown', status: 0, count: stats.success }]
        : [];
    const failureRows = details.failureDetails.length
      ? details.failureDetails.map((item) => ({
          model: item.model,
          status: item.status,
          count: item.count,
          error: item.error,
        }))
      : stats.failure > 0
        ? [{ model: 'unknown', status: 0, count: stats.failure, error: '未记录明细' }]
        : [];

    return (
      <div className={styles.stats}>
        <span
          className={`${styles.statPill} ${styles.statSuccess} ${successRows.length ? styles.statInteractive : ''}`}
          tabIndex={successRows.length ? 0 : undefined}
          onMouseEnter={
            successRows.length
              ? (event) => openUsageTooltip(event, t('stats.success'), successRows)
              : undefined
          }
          onMouseLeave={successRows.length ? closeUsageTooltip : undefined}
          onFocus={
            successRows.length
              ? (event) => openUsageTooltip(event, t('stats.success'), successRows)
              : undefined
          }
          onBlur={successRows.length ? closeUsageTooltip : undefined}
        >
          {t('stats.success')}: {stats.success}
        </span>
        <span
          className={`${styles.statPill} ${styles.statFailure} ${failureRows.length ? styles.statInteractive : ''}`}
          tabIndex={failureRows.length ? 0 : undefined}
          onMouseEnter={
            failureRows.length
              ? (event) => openUsageTooltip(event, t('stats.failure'), failureRows)
              : undefined
          }
          onMouseLeave={failureRows.length ? closeUsageTooltip : undefined}
          onFocus={
            failureRows.length
              ? (event) => openUsageTooltip(event, t('stats.failure'), failureRows)
              : undefined
          }
          onBlur={failureRows.length ? closeUsageTooltip : undefined}
        >
          {t('stats.failure')}: {stats.failure}
        </span>
      </div>
    );
  };

  const renderPrimary = (r: ProviderResource) => {
    if (isSponsorResource(r)) {
      return (
        <div className={styles.primaryCell}>
          <span className={styles.primaryName}>{r.name ?? r.identifier}</span>
          <span className={styles.primarySub}>
            {r.apiKeyPreview ?? t('providersPage.status.notConfigured')}
          </span>
        </div>
      );
    }
    if (r.brand === 'openaiCompatibility') {
      const extra = r.apiKeyEntryCount > 1 ? ` · +${r.apiKeyEntryCount - 1}` : '';
      return (
        <div className={styles.primaryCell}>
          <span className={styles.primaryName}>{r.name ?? r.identifier}</span>
          <span className={styles.primarySub}>{(r.apiKeyPreview ?? '—') + extra}</span>
          {renderRoutingMeta(r)}
        </div>
      );
    }
    const extraKeys = r.apiKeyEntryCount > 1 ? ` · +${r.apiKeyEntryCount - 1}` : '';
    return (
      <div className={styles.primaryCell}>
        <span className={styles.primaryName}>{r.name ?? r.apiKeyPreview ?? '—'}</span>
        {r.name ? (
          <span className={styles.primarySub}>{(r.apiKeyPreview ?? '—') + extraKeys}</span>
        ) : r.apiKeyEntryCount > 1 ? (
          <span className={styles.primarySub}>
            {t('providersPage.form.multiKeyCount', { count: r.apiKeyEntryCount })}
          </span>
        ) : r.authIndex ? (
          <span className={styles.primarySub}>auth: {r.authIndex}</span>
        ) : null}
        {renderRoutingMeta(r)}
      </div>
    );
  };

  const renderBaseUrl = (r: ProviderResource) => {
    if (isSponsorResource(r)) {
      return <span className={styles.baseUrl}>{renderProtocolSummary(r)}</span>;
    }
    if (r.brand === 'claude' && !r.baseUrl) {
      return (
        <span className={styles.baseUrl}>
          https://api.anthropic.com {t('providersPage.status.defaultSuffix')}
        </span>
      );
    }
    return <span className={styles.baseUrl}>{r.baseUrl ?? t('providersPage.status.notSet')}</span>;
  };

  return (
    <>
      <Table
        className={styles.providerTable}
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
            <TableHead alignRight className={styles.actionsHead}>
              {t('providersPage.table.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resources.map((resource) => (
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
                  {renderCodexProbeStatus(resource)}
                  {usageByProvider && !isSponsorResource(resource) ? (
                    <>
                      {renderUsageStats(resource, usageByProvider)}
                      <div className={styles.statusBarWrap}>
                        <ProviderStatusBar
                          statusData={resolveStatusBarData(resource, usageByProvider)}
                          styles={statusBarStyles}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </TableCell>
              <TableCell
                alignRight
                className={[
                  styles.actionsCell,
                  resource.id === selectedId ? styles.actionsCellSelected : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={styles.actions}>
                  {onToggleDisabled ? (
                    <span className={styles.toggleWrap} onClick={(e) => e.stopPropagation()}>
                      <ToggleSwitch
                        checked={!resource.disabled}
                        disabled={disableMutations}
                        onChange={(value) => onToggleDisabled(resource, !value)}
                        ariaLabel={
                          resource.disabled
                            ? t('providersPage.actions.enable')
                            : t('providersPage.actions.disable')
                        }
                      />
                    </span>
                  ) : null}
                  {resource.brand === 'codex' && onTestCodexResource ? (
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnProbe}`}
                      aria-label={t('providersPage.connectivity.simulate')}
                      title={t('providersPage.connectivity.simulate')}
                      disabled={
                        disableMutations ||
                        codexBulkTesting ||
                        codexProbeStatuses?.[resource.id]?.state === 'loading'
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onTestCodexResource(resource);
                      }}
                    >
                      {codexProbeStatuses?.[resource.id]?.state === 'loading' ? (
                        <IconLoader2 className={styles.probeSpinner} size={16} />
                      ) : (
                        <IconBot size={16} />
                      )}
                    </button>
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
          ))}
        </TableBody>
      </Table>
      {renderUsageTooltip()}
    </>
  );
}
