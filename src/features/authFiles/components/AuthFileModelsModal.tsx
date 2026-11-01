import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import type { AuthFileModelProbeResult } from '@/services/api/authFiles';
import { isModelExcluded } from '@/features/authFiles/constants';
import { formatProbeMeta, summarizeProbeResult } from '@/features/authFiles/probeSnippet';
import styles from './AuthFileModelsModal.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  fileType: string;
  loading: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  probeResults: Record<string, AuthFileModelProbeResult>;
  probeRunning: Record<string, boolean>;
  onProbeModel: (modelId: string) => void;
  onClose: () => void;
  onCopyText: (text: string) => void;
};

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const {
    open,
    fileName,
    fileType,
    loading,
    error,
    models,
    excluded,
    probeResults,
    probeRunning,
    onProbeModel,
    onClose,
    onCopyText,
  } = props;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${fileName}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {loading ? (
        <div className="hint">
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      ) : error === 'unsupported' ? (
        <EmptyState
          title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          description={t('auth_files.models_unsupported_desc', {
            defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
          })}
        />
      ) : models.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
          description={t('auth_files.models_empty_desc', {
            defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
          })}
        />
      ) : (
        <div className={styles.list}>
          {models.map((model) => {
            const excludedModel = isModelExcluded(model.id, fileType, excluded);
            const probe = probeResults[model.id];
            const snippet = summarizeProbeResult(probe);
            const meta = formatProbeMeta(probe);
            return (
              <div
                key={model.id}
                className={`${styles.item} ${excludedModel ? styles.itemExcluded : ''}`}
                onClick={() => {
                  onCopyText(model.id);
                }}
                title={
                  excludedModel
                    ? t('auth_files.models_excluded_hint', {
                        defaultValue: '此 OAuth 模型已被禁用',
                      })
                    : t('common.copy', { defaultValue: '点击复制' })
                }
              >
                <div className={styles.row}>
                  <span className={styles.modelId}>{model.id}</span>
                  {model.display_name && model.display_name !== model.id && (
                    <span className={styles.modelDisplayName}>{model.display_name}</span>
                  )}
                  {model.type && <span className={styles.modelType}>{model.type}</span>}
                  {excludedModel && (
                    <span className={styles.excludedBadge}>
                      {t('auth_files.models_excluded_badge', { defaultValue: '已禁用' })}
                    </span>
                  )}
                  <span className={styles.probeSlot}>
                    {probe ? (
                      <span
                        className={probe.ok ? styles.probeOk : styles.probeFail}
                        title={
                          probe.ok
                            ? t('auth_files.models_probe_ok')
                            : probe.error || t('auth_files.models_probe_fail')
                        }
                      >
                        {probe.ok
                          ? t('auth_files.models_probe_ok')
                          : t('auth_files.models_probe_fail')}
                        {!probe.ok && probe.status ? ` ${probe.status}` : ''}
                      </span>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={probeRunning[model.id] === true}
                      disabled={probeRunning[model.id] === true}
                      onClick={(event) => {
                        event.stopPropagation();
                        onProbeModel(model.id);
                      }}
                      title={t('auth_files.models_probe_button')}
                    >
                      {probeRunning[model.id] === true
                        ? t('auth_files.models_probe_running')
                        : t('auth_files.models_probe_button')}
                    </Button>
                  </span>
                </div>
                {meta || snippet ? (
                  <div className={styles.probeDetail}>
                    {meta ? <span className={styles.probeMeta}>{meta}</span> : null}
                    {snippet ? (
                      <span
                        className={probe?.ok ? styles.probeSnippetOk : styles.probeSnippetFail}
                        title={snippet}
                      >
                        {snippet}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
