import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useCountUp } from '@/hooks/motion';
import styles from './QuotaHeader.module.scss';

export type QuotaHeaderProps = {
  totalCount: number;
  loadedCount: number;
  attentionCount: number;
  currentPageRefreshing: boolean;
  backgroundRefreshing: boolean;
  backgroundDone: number;
  backgroundTotal: number;
  disableControls: boolean;
  onRefreshCurrentPage: () => void;
  onRefreshAll: () => void;
};

/**
 * 额度页头部：标题领衔 + ▍mono 遥测 meta 行 + 分离的当前页/后台全量刷新。
 */
export function QuotaHeader(props: QuotaHeaderProps) {
  const {
    totalCount,
    loadedCount,
    attentionCount,
    currentPageRefreshing,
    backgroundRefreshing,
    backgroundDone,
    backgroundTotal,
    disableControls,
    onRefreshCurrentPage,
    onRefreshAll,
  } = props;
  const { t } = useTranslation();
  const displayLoadedCount = useCountUp(loadedCount);

  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <h1 className={styles.title} data-reveal>
          {t('quota_management.title')}
        </h1>
        <p className={styles.meta} data-reveal>
          <span className={styles.metaTotal}>
            {t('quota_management.meta_credentials', { count: totalCount })}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span className={loadedCount > 0 ? styles.metaLoaded : styles.metaMuted}>
            {t('quota_management.meta_loaded', { count: displayLoadedCount })}
          </span>
          {attentionCount > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaAttention}>
                {t('quota_management.meta_attention', { count: attentionCount })}
              </span>
            </>
          )}
        </p>
      </div>
      <div className={styles.actions} data-reveal>
        <button
          type="button"
          className={styles.secondaryAction}
          onClick={onRefreshCurrentPage}
          disabled={disableControls || currentPageRefreshing || backgroundRefreshing}
        >
          <IconRefreshCw
            size={14}
            className={currentPageRefreshing ? styles.spinning : undefined}
          />
          {t('quota_management.refresh_current_page')}
        </button>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={onRefreshAll}
          disabled={disableControls || backgroundRefreshing || currentPageRefreshing}
        >
          <IconRefreshCw size={14} className={backgroundRefreshing ? styles.spinning : undefined} />
          {backgroundRefreshing
            ? t('quota_management.refresh_progress', {
                done: backgroundDone,
                total: backgroundTotal,
              })
            : t('quota_management.refresh_all_credentials')}
        </button>
      </div>
    </header>
  );
}
