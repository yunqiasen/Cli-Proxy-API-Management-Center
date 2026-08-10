import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconPlus, IconX } from '@/components/ui/icons';
import type { MediaOperationInput } from '../../types';
import styles from './sharedForm.module.scss';

interface MediaOperationsEditorProps {
  operations: MediaOperationInput[];
  capabilities: readonly string[];
  mutating: boolean;
  onUpdate: (index: number, patch: Partial<MediaOperationInput>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export function MediaOperationsEditor({
  operations,
  capabilities,
  mutating,
  onUpdate,
  onAdd,
  onRemove,
}: MediaOperationsEditorProps) {
  const { t } = useTranslation();
  const preferredOperationIndex = operations.findIndex((operation) => {
    const capability = operation.capability.trim().toLowerCase();
    const name = operation.name.trim().toLowerCase();
    return (
      capability === 'generate' ||
      name === 'generate' ||
      capability === 'speech' ||
      name === 'speech' ||
      capability === 'text-to-video' ||
      name === 'text-to-video' ||
      capability === 'transcribe' ||
      name === 'transcribe'
    );
  });
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    operations.length === 1 ? 0 : preferredOperationIndex >= 0 ? preferredOperationIndex : null
  );

  return (
    <div className={styles.entriesList}>
      {operations.map((operation, index) => {
        const expanded = expandedIndex === index;
        return (
          <div key={index} className={styles.entryCard}>
            <div className={styles.entryCardHeader}>
              <button
                type="button"
                className={styles.entryCardToggle}
                aria-expanded={expanded}
                onClick={() => setExpandedIndex(expanded ? null : index)}
              >
                <span>{operation.name || t('providersPage.media.operationUntitled')}</span>
                <span className={styles.entrySummary}>
                  <span className={styles.entryBadge}>{operation.method || 'POST'}</span>
                  {operation.capability ? (
                    <span className={styles.entryBadge}>{operation.capability}</span>
                  ) : null}
                </span>
              </button>
              <div className={styles.entryCardHeaderRight}>
                <button
                  type="button"
                  className={styles.entryCardIconBtn}
                  onClick={() => setExpandedIndex(expanded ? null : index)}
                  aria-label={expanded ? t('common.collapse') : t('common.expand')}
                >
                  <IconChevronDown
                    className={[
                      styles.entryCardChevron,
                      expanded ? styles.entryCardChevronOpen : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    size={14}
                  />
                </button>
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={mutating}
                  onClick={() => {
                    setExpandedIndex((current) =>
                      current === null || current === index
                        ? null
                        : current > index
                          ? current - 1
                          : current
                    );
                    onRemove(index);
                  }}
                  aria-label={t('providersPage.media.removeOperation')}
                >
                  <IconX size={12} />
                </button>
              </div>
            </div>
            {expanded ? (
              <div className={styles.entryCardBody}>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('providersPage.media.operationName')}</label>
                    <input
                      className={styles.input}
                      value={operation.name}
                      onChange={(event) => onUpdate(index, { name: event.target.value })}
                      disabled={mutating}
                      placeholder="remove-background"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('providersPage.media.capability')}</label>
                    <select
                      className={styles.input}
                      value={operation.capability}
                      onChange={(event) => onUpdate(index, { capability: event.target.value })}
                      disabled={mutating}
                    >
                      <option value="">{t('providersPage.media.capabilityOptional')}</option>
                      {capabilities.map((capability) => (
                        <option key={capability} value={capability}>
                          {t(`providersPage.media.capabilityNames.${capability}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('providersPage.media.method')}</label>
                    <select
                      className={styles.input}
                      value={operation.method}
                      onChange={(event) => onUpdate(index, { method: event.target.value })}
                      disabled={mutating}
                    >
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('providersPage.media.path')}</label>
                    <input
                      className={styles.input}
                      value={operation.path}
                      onChange={(event) => onUpdate(index, { path: event.target.value })}
                      disabled={mutating}
                      placeholder="/v1/images/generations"
                    />
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('providersPage.media.requestFormat')}</label>
                    <select
                      className={styles.input}
                      value={operation.requestFormat}
                      onChange={(event) =>
                        onUpdate(index, {
                          requestFormat: event.target.value as MediaOperationInput['requestFormat'],
                        })
                      }
                      disabled={mutating}
                    >
                      <option value="json">JSON</option>
                      <option value="multipart">multipart/form-data</option>
                      <option value="binary">Binary</option>
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('providersPage.media.modelMode')}</label>
                    <select
                      className={styles.input}
                      value={operation.modelMode}
                      onChange={(event) => {
                        const modelMode = event.target.value as MediaOperationInput['modelMode'];
                        onUpdate(index, {
                          modelMode,
                          ...(modelMode === 'none' ? { model: '' } : {}),
                        });
                      }}
                      disabled={mutating}
                    >
                      <option value="required">{t('providersPage.media.modelRequired')}</option>
                      <option value="optional">{t('providersPage.media.modelOptional')}</option>
                      <option value="none">{t('providersPage.media.modelNone')}</option>
                    </select>
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <label className={styles.label}>{t('providersPage.media.fixedModel')}</label>
                    <input
                      className={styles.input}
                      value={operation.model}
                      onChange={(event) => onUpdate(index, { model: event.target.value })}
                      disabled={mutating || operation.modelMode === 'none'}
                      placeholder={t('providersPage.media.fixedModelPlaceholder')}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>
                      {t('providersPage.media.responseFormat')}
                    </label>
                    <select
                      className={styles.input}
                      value={operation.responseFormat}
                      onChange={(event) =>
                        onUpdate(index, {
                          responseFormat: event.target
                            .value as MediaOperationInput['responseFormat'],
                        })
                      }
                      disabled={mutating}
                    >
                      <option value="passthrough">Passthrough</option>
                      <option value="json-url">OpenAI JSON URL</option>
                      <option value="json-base64">OpenAI JSON Base64</option>
                      <option value="binary">Binary</option>
                    </select>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>{t('providersPage.media.resultPath')}</label>
                  <input
                    className={styles.input}
                    value={operation.resultPath}
                    onChange={(event) => onUpdate(index, { resultPath: event.target.value })}
                    disabled={mutating}
                    placeholder="data.0.url"
                  />
                </div>
                <div className={styles.section}>
                  <div className={styles.field}>
                    <label className={styles.label}>
                      {operation.requestFormat === 'multipart'
                        ? t('providersPage.media.testRequestMultipartFields')
                        : t('providersPage.media.testRequestJson')}
                    </label>
                    <textarea
                      className={styles.textarea}
                      rows={operation.requestFormat === 'multipart' ? 4 : 5}
                      value={
                        operation.requestFormat === 'multipart'
                          ? operation.testRequestMultipartFieldsText
                          : operation.testRequestJson
                      }
                      onChange={(event) =>
                        onUpdate(
                          index,
                          operation.requestFormat === 'multipart'
                            ? { testRequestMultipartFieldsText: event.target.value }
                            : { testRequestJson: event.target.value }
                        )
                      }
                      disabled={mutating || operation.requestFormat === 'binary'}
                      placeholder={
                        operation.requestFormat === 'multipart'
                          ? 'text=CPA test\nvoice_id=voice-id\noutput_format=mp3'
                          : '{"messages":[{"role":"assistant","content":"CPA test"}]}'
                      }
                    />
                    <span className={styles.labelHint}>
                      {t('providersPage.media.testRequestHint')}
                    </span>
                  </div>
                </div>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    className={styles.checkboxBox}
                    checked={operation.asyncEnabled}
                    onChange={(event) => onUpdate(index, { asyncEnabled: event.target.checked })}
                    disabled={mutating}
                  />
                  <span className={styles.checkboxText}>
                    <span>{t('providersPage.media.asyncEnabled')}</span>
                    <small>{t('providersPage.media.asyncHint')}</small>
                  </span>
                </label>
                {operation.asyncEnabled ? (
                  <div className={styles.section}>
                    <div className={styles.fieldRow}>
                      <div className={styles.field}>
                        <label className={styles.label}>
                          {t('providersPage.media.taskIdPath')}
                        </label>
                        <input
                          className={styles.input}
                          value={operation.taskIdPath}
                          onChange={(event) => onUpdate(index, { taskIdPath: event.target.value })}
                          disabled={mutating}
                          placeholder="task_id"
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label}>
                          {t('providersPage.media.pollMethod')}
                        </label>
                        <select
                          className={styles.input}
                          value={operation.pollMethod || 'GET'}
                          onChange={(event) => onUpdate(index, { pollMethod: event.target.value })}
                          disabled={mutating}
                        >
                          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                            <option key={method} value={method}>
                              {method}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label}>{t('providersPage.media.pollPath')}</label>
                        <input
                          className={styles.input}
                          value={operation.pollPath}
                          onChange={(event) => onUpdate(index, { pollPath: event.target.value })}
                          disabled={mutating}
                          placeholder="/tasks/{task_id}"
                        />
                      </div>
                    </div>
                    <div className={styles.fieldRow}>
                      <div className={styles.field}>
                        <label className={styles.label}>
                          {t('providersPage.media.statusPath')}
                        </label>
                        <input
                          className={styles.input}
                          value={operation.statusPath}
                          onChange={(event) => onUpdate(index, { statusPath: event.target.value })}
                          disabled={mutating}
                          placeholder="status"
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label}>
                          {t('providersPage.media.pollInterval')}
                        </label>
                        <input
                          className={styles.input}
                          value={operation.pollInterval}
                          onChange={(event) =>
                            onUpdate(index, { pollInterval: event.target.value })
                          }
                          disabled={mutating}
                          placeholder="3s"
                        />
                      </div>
                    </div>
                    <div className={styles.fieldRow}>
                      <div className={styles.field}>
                        <label className={styles.label}>
                          {t('providersPage.media.successValues')}
                        </label>
                        <textarea
                          className={styles.textarea}
                          rows={2}
                          value={operation.successValuesText}
                          onChange={(event) =>
                            onUpdate(index, { successValuesText: event.target.value })
                          }
                          disabled={mutating}
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label}>
                          {t('providersPage.media.failureValues')}
                        </label>
                        <textarea
                          className={styles.textarea}
                          rows={2}
                          value={operation.failureValuesText}
                          onChange={(event) =>
                            onUpdate(index, { failureValuesText: event.target.value })
                          }
                          disabled={mutating}
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>
                        {t('providersPage.media.asyncResultPath')}
                      </label>
                      <input
                        className={styles.input}
                        value={operation.asyncResultPath}
                        onChange={(event) =>
                          onUpdate(index, { asyncResultPath: event.target.value })
                        }
                        disabled={mutating}
                        placeholder="output.url"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <button type="button" className={styles.addBtn} onClick={onAdd} disabled={mutating}>
        <IconPlus size={12} />
        <span>{t('providersPage.media.addOperation')}</span>
      </button>
    </div>
  );
}
