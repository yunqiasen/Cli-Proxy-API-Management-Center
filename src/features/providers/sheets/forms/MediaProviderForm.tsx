import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { buildMediaConnectivityRequest } from '@/services/api/mediaProviderConnectivity';
import { Collapsible } from '@/components/ui/Collapsible';
import { IconLoader2, IconPlus, IconX } from '@/components/ui/icons';
import type { MediaProviderConfig } from '@/types';
import type {
  ApiKeyEntryInput,
  MediaOperationInput,
  ModelEntryInput,
  ProviderEntryFormInput,
  ProviderResource,
} from '../../types';
import { MediaOperationsEditor } from './MediaOperationsEditor';
import {
  MEDIA_CAPABILITIES_BY_KIND,
  validateMediaProviderFormInput,
} from '../../mediaProviderFormValidation';
import { ModelEntriesEditor } from './ModelEntriesEditor';
import { ApiKeyEntriesEditor } from './ApiKeyEntriesEditor';
import { ConnectivityStatusIcon } from './ConnectivityStatusIcon';
import type { ConnectivityStatus } from './useConnectivityTest';
import styles from './sharedForm.module.scss';

interface MediaProviderFormProps {
  brand: 'image' | 'video' | 'audio';
  resource: ProviderResource | null;
  mode: 'create' | 'edit';
  mutating: boolean;
  formId: string;
  onSubmit: (input: ProviderEntryFormInput) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

const emptyKey = (): ApiKeyEntryInput => ({ apiKey: '', proxyUrl: '' });
const emptyModel = (): ModelEntryInput => ({ name: '', alias: '', capabilities: [] });
const emptyHeader = () => ({ key: '', value: '' });
const emptyOperation = (): MediaOperationInput => ({
  name: '',
  capability: '',
  method: 'POST',
  path: '',
  requestFormat: 'json',
  modelMode: 'optional',
  model: '',
  responseFormat: 'passthrough',
  resultPath: '',
  asyncEnabled: false,
  taskIdPath: '',
  pollMethod: 'GET',
  pollPath: '',
  statusPath: '',
  successValuesText: 'completed',
  failureValuesText: 'failed',
  asyncResultPath: '',
  pollInterval: '3s',
});

const inputFromConfig = (
  brand: 'image' | 'video' | 'audio',
  resource: ProviderResource | null,
  mode: 'create' | 'edit'
): ProviderEntryFormInput => {
  const config = mode === 'edit' && resource ? (resource.raw as MediaProviderConfig) : null;
  return {
    apiKey: '',
    name: config?.name ?? '',
    baseUrl: config?.baseUrl ?? '',
    proxyUrl: config?.apiKeyEntries?.[0]?.proxyUrl ?? '',
    prefix: config?.prefix ?? '',
    disabled: config?.disabled === true,
    disableCooling: config?.disableCooling === true,
    priority: config?.priority,
    models: config?.models?.length
      ? config.models.map((model) => ({
          name: model.name,
          alias: model.alias ?? '',
          displayName: model.displayName ?? '',
          forceMapping: model.forceMapping === true,
          capabilities: [...(model.capabilities ?? [])],
        }))
      : [emptyModel()],
    headers: config?.headers
      ? Object.entries(config.headers).map(([key, value]) => ({ key, value: String(value) }))
      : [emptyHeader()],
    excludedModelsText: '',
    apiKeyEntries: config?.apiKeyEntries?.length
      ? config.apiKeyEntries.map((entry) => ({
          apiKey: '',
          existingApiKey: entry.apiKey,
          priority: entry.priority,
          proxyUrl: entry.proxyUrl ?? '',
          authIndex: entry.authIndex,
        }))
      : [{ ...emptyKey(), authIndex: config?.authIndex }],
    operations: config?.operations?.length
      ? config.operations.map((operation) => ({
          name: operation.name,
          capability: operation.capability ?? '',
          method: operation.method,
          path: operation.path,
          requestFormat: operation.requestFormat,
          modelMode: operation.modelMode,
          model: operation.model ?? '',
          responseFormat: operation.responseFormat,
          resultPath: operation.resultPath ?? '',
          asyncEnabled: Boolean(operation.async),
          taskIdPath: operation.async?.taskIdPath ?? '',
          pollMethod: operation.async?.pollMethod ?? 'GET',
          pollPath: operation.async?.pollPath ?? '',
          statusPath: operation.async?.statusPath ?? '',
          successValuesText: operation.async?.successValues?.join('\n') ?? 'completed',
          failureValuesText: operation.async?.failureValues?.join('\n') ?? 'failed',
          asyncResultPath: operation.async?.resultPath ?? '',
          pollInterval: operation.async?.pollInterval ?? '3s',
        }))
      : [emptyOperation()],
    mediaKind: brand,
  };
};

const selectTestModel = (
  operation: MediaOperationInput | undefined,
  models: ModelEntryInput[]
): string => {
  const capability = operation?.capability.trim().toLowerCase();
  const candidates = models.filter((model) => model.name.trim());
  if (capability) {
    const capable = candidates.find((model) =>
      (model.capabilities ?? []).some((item) => item.toLowerCase() === capability)
    );
    if (capable) return capable.name.trim();
  }
  return candidates[0]?.name.trim() ?? '';
};

export function MediaProviderForm({
  brand,
  resource,
  mode,
  mutating,
  formId,
  onSubmit,
  onDirtyChange,
}: MediaProviderFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ProviderEntryFormInput>(() =>
    inputFromConfig(brand, resource, mode)
  );
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ConnectivityStatus[]>(() =>
    Array.from(
      { length: inputFromConfig(brand, resource, mode).apiKeyEntries?.length ?? 1 },
      () => ({
        state: 'idle',
        message: '',
      })
    )
  );
  const initialSignature = useMemo(
    () => JSON.stringify(inputFromConfig(brand, resource, mode)),
    [brand, mode, resource]
  );
  const isDirty = JSON.stringify(form) !== initialSignature;
  const entries = form.apiKeyEntries?.length ? form.apiKeyEntries : [emptyKey()];
  const models = form.models.length ? form.models : [emptyModel()];
  const operations = form.operations?.length ? form.operations : [emptyOperation()];
  const mediaCapabilities = MEDIA_CAPABILITIES_BY_KIND[brand];

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);
  useEffect(() => {
    setStatuses((previous) => {
      const next = previous.slice(0, entries.length);
      while (next.length < entries.length) next.push({ state: 'idle', message: '' });
      return next;
    });
  }, [entries.length]);

  const updateField = <K extends keyof ProviderEntryFormInput>(
    key: K,
    value: ProviderEntryFormInput[K]
  ) => setForm((previous) => ({ ...previous, [key]: value }));

  const resolveEntryKey = (index: number): string => {
    const entry = entries[index];
    return entry.apiKey.trim() || entry.existingApiKey?.trim() || '';
  };

  const runTest = async (index: number): Promise<boolean> => {
    const entry = entries[index];
    const operation = operations.find((item) => item.name.trim()) ?? undefined;
    const model = selectTestModel(operation, models);
    const modelRequired = operation?.modelMode === 'required' && !operation.model.trim() && !model;
    if (!form.baseUrl.trim()) {
      setStatuses((previous) =>
        previous.map((item, idx) =>
          idx === index
            ? { state: 'error', message: t('providersPage.form.validation.baseUrlRequired') }
            : item
        )
      );
      return false;
    }
    if (modelRequired) {
      setStatuses((previous) =>
        previous.map((item, idx) =>
          idx === index
            ? { state: 'error', message: t('providersPage.connectivity.modelRequired') }
            : item
        )
      );
      return false;
    }

    const headers = Object.fromEntries(
      form.headers.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value])
    );
    const request = buildMediaConnectivityRequest({
      kind: brand,
      baseUrl: form.baseUrl,
      model,
      operation,
      headers,
      apiKey: resolveEntryKey(index),
      authIndex: entry.authIndex,
    });
    setStatuses((previous) =>
      previous.map((item, idx) => (idx === index ? { state: 'loading', message: '' } : item))
    );
    try {
      const result = await apiCallApi.request(
        {
          authIndex: entry.authIndex,
          method: request.method,
          url: request.url,
          header: request.header,
          data: request.data,
          dataBase64: request.dataBase64,
        },
        { timeout: 30_000 }
      );
      if (result.statusCode < 200 || result.statusCode >= 300)
        throw new Error(getApiCallErrorMessage(result));
      setStatuses((previous) =>
        previous.map((item, idx) => (idx === index ? { state: 'success', message: '' } : item))
      );
      return true;
    } catch (testError) {
      setStatuses((previous) =>
        previous.map((item, idx) =>
          idx === index
            ? {
                state: 'error',
                message: testError instanceof Error ? testError.message : String(testError),
              }
            : item
        )
      );
      return false;
    }
  };

  const validate = (): string | null => {
    const issue = validateMediaProviderFormInput(form, brand);
    if (!issue) return null;
    if (issue.operationIndex === undefined) {
      if (issue.code === 'nameRequired') return t('providersPage.form.validation.nameRequired');
      if (issue.code === 'baseUrlRequired')
        return t('providersPage.form.validation.baseUrlRequired');
    }
    return t(`providersPage.media.validation.${issue.code}`, {
      index: (issue.operationIndex ?? 0) + 1,
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    try {
      setError(null);
      await onSubmit({
        ...form,
        apiKeyEntries: form.apiKeyEntries?.filter(
          (entry) => entry.apiKey.trim() || entry.existingApiKey?.trim()
        ),
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  };

  const headerEntries = form.headers.length ? form.headers : [emptyHeader()];

  return (
    <form id={formId} className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.section}>
        <div className={styles.field}>
          <label className={styles.label}>{t('providersPage.media.providerName')}</label>
          <input
            className={styles.input}
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
            disabled={mutating}
            placeholder="img-lite"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>
            {t('providersPage.form.baseUrl')}{' '}
            <span className={styles.labelHint}> · {t('providersPage.media.baseUrlHint')}</span>
          </label>
          <input
            className={styles.input}
            value={form.baseUrl}
            onChange={(event) => updateField('baseUrl', event.target.value)}
            disabled={mutating}
            placeholder="https://api.example.com/v1"
          />
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>{t('providersPage.form.prefix')}</label>
            <input
              className={styles.input}
              value={form.prefix}
              onChange={(event) => updateField('prefix', event.target.value)}
              disabled={mutating}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('providersPage.form.priority')}</label>
            <input
              className={styles.input}
              type="number"
              value={form.priority ?? ''}
              onChange={(event) =>
                updateField(
                  'priority',
                  event.target.value === '' ? undefined : Number(event.target.value)
                )
              }
              disabled={mutating}
            />
          </div>
        </div>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            className={styles.checkboxBox}
            checked={form.disabled}
            onChange={(event) => updateField('disabled', event.target.checked)}
            disabled={mutating}
          />
          <span className={styles.checkboxText}>
            <span>{t('providersPage.form.disabled')}</span>
            <small>{t('providersPage.form.disabledHint')}</small>
          </span>
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            className={styles.checkboxBox}
            checked={form.disableCooling ?? false}
            onChange={(event) => updateField('disableCooling', event.target.checked)}
            disabled={mutating}
          />
          <span className={styles.checkboxText}>
            <span>{t('providersPage.form.disableCooling')}</span>
            <small>{t('providersPage.form.disableCoolingHint')}</small>
          </span>
        </label>
        <div className={styles.connectivityRow}>
          <button
            type="button"
            className={styles.connectivityBtn}
            onClick={() => void runTest(0)}
            disabled={mutating || statuses.some((status) => status.state === 'loading')}
          >
            {statuses[0]?.state === 'loading' ? <IconLoader2 size={14} /> : null}
            <span>{t('providersPage.media.testProvider')}</span>
          </button>
          <ConnectivityStatusIcon state={statuses[0]?.state ?? 'idle'} />
          {statuses[0]?.state === 'success' ? (
            <span className={styles.connectivityHintSuccess}>
              {t('providersPage.connectivity.success')}
            </span>
          ) : null}
        </div>
        {statuses[0]?.state === 'error' ? (
          <div className={styles.connectivityError}>{statuses[0].message}</div>
        ) : null}
      </div>

      <Collapsible
        label={t('providersPage.form.apiKeyEntriesSection')}
        hint={`${entries.filter((_entry, index) => resolveEntryKey(index)).length}`}
        defaultOpen
      >
        <ApiKeyEntriesEditor
          entries={entries}
          removeDisabled={false}
          mutating={mutating}
          statuses={statuses}
          isTestingAny={statuses.some((status) => status.state === 'loading')}
          showConnectivity
          showPriority
          onUpdate={(index, patch) =>
            updateField(
              'apiKeyEntries',
              entries.map((entry, idx) => (idx === index ? { ...entry, ...patch } : entry))
            )
          }
          onAdd={() => {
            const next = [...entries, emptyKey()];
            updateField('apiKeyEntries', next);
            return next.length - 1;
          }}
          onRemove={(index) =>
            updateField(
              'apiKeyEntries',
              entries.filter((_entry, idx) => idx !== index)
            )
          }
          onTest={(index) => void runTest(index)}
          onTestAll={() => void Promise.all(entries.map((_entry, index) => runTest(index)))}
        />
      </Collapsible>

      <Collapsible label={t('providersPage.form.headersSection')}>
        <div className={styles.entriesList}>
          {headerEntries.map((entry, index) => (
            <div
              key={index}
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}
            >
              <input
                className={styles.input}
                placeholder="X-Custom-Header"
                value={entry.key}
                onChange={(event) =>
                  updateField(
                    'headers',
                    headerEntries.map((item, idx) =>
                      idx === index ? { ...item, key: event.target.value } : item
                    )
                  )
                }
                disabled={mutating}
              />
              <input
                className={styles.input}
                placeholder="value"
                value={entry.value}
                onChange={(event) =>
                  updateField(
                    'headers',
                    headerEntries.map((item, idx) =>
                      idx === index ? { ...item, value: event.target.value } : item
                    )
                  )
                }
                disabled={mutating}
              />
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() =>
                  updateField(
                    'headers',
                    headerEntries.filter((_item, idx) => idx !== index)
                  )
                }
                disabled={mutating || headerEntries.length <= 1}
              >
                <IconX size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => updateField('headers', [...headerEntries, emptyHeader()])}
            disabled={mutating}
          >
            <IconPlus size={12} />
            <span>{t('providersPage.form.addHeader')}</span>
          </button>
        </div>
      </Collapsible>

      <Collapsible
        label={t('providersPage.form.modelsSection')}
        hint={`${models.filter((model) => model.name.trim()).length}`}
      >
        <ModelEntriesEditor
          models={models}
          extendedOptions={false}
          mediaCapabilities={mediaCapabilities}
          capabilityLabels={Object.fromEntries(
            mediaCapabilities.map((capability) => [
              capability,
              t(`providersPage.media.capabilityNames.${capability}`),
            ])
          )}
          mutating={mutating}
          removeDisabled={models.length <= 1}
          onUpdate={(index, patch) =>
            updateField(
              'models',
              models.map((model, idx) => (idx === index ? { ...model, ...patch } : model))
            )
          }
          onAdd={() => updateField('models', [...models, emptyModel()])}
          onRemove={(index) =>
            updateField(
              'models',
              models.filter((_model, idx) => idx !== index)
            )
          }
        />
      </Collapsible>

      <Collapsible
        label={t('providersPage.media.operationsSection')}
        hint={`${operations.filter((operation) => operation.name.trim()).length}`}
        defaultOpen
      >
        <MediaOperationsEditor
          operations={operations}
          capabilities={mediaCapabilities}
          mutating={mutating}
          onUpdate={(index, patch) =>
            updateField(
              'operations',
              operations.map((operation, idx) =>
                idx === index ? { ...operation, ...patch } : operation
              )
            )
          }
          onAdd={() => updateField('operations', [...operations, emptyOperation()])}
          onRemove={(index) =>
            updateField(
              'operations',
              operations.filter((_operation, idx) => idx !== index)
            )
          }
        />
      </Collapsible>

      {error ? <div className={styles.errorBox}>{error}</div> : null}
    </form>
  );
}
