import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  MEDIA_CONNECTIVITY_TIMEOUT_MS,
  buildMediaConnectivityRequest,
  buildMediaGatewayConnectivityRequest,
  getMediaConnectivityApplicationError,
  getMediaGatewayPath,
  requestMediaGatewayConnectivity,
} from '@/services/api/mediaProviderConnectivity';
import { Collapsible } from '@/components/ui/Collapsible';
import { IconDownload, IconLoader2, IconPlus, IconX } from '@/components/ui/icons';
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
  clampMediaTestOperationIndex,
  createMediaConnectivityResultGuard,
  createMediaConnectivityResultGuardMap,
  describeMediaTestModel,
  getDefaultMediaTestOperationIndex,
  getMediaTestModelOptions,
  mediaConnectivityTestSignature,
  mediaTestOperationLabel,
  resolveMediaTestModels,
} from '../../mediaProviderTestSelection';
import {
  MEDIA_CAPABILITIES_BY_KIND,
  validateMediaProviderFormInput,
} from '../../mediaProviderFormValidation';
import { ModelEntriesEditor } from './ModelEntriesEditor';
import { ModelDiscoveryPanel } from './ModelDiscoveryPanel';
import { useModelDiscovery } from './useModelDiscovery';
import { mergeDiscoveredMediaModels } from '../../mediaProviderModelDiscovery';
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
  testRequestJson: '',
  testRequestMultipartFieldsText: '',
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
    apiKeyHeader: config?.apiKeyHeader ?? '',
    apiKeyPrefix: config?.apiKeyPrefix ?? '',
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
          testRequestJson: operation.testRequest?.json ?? '',
          testRequestMultipartFieldsText: Object.entries(
            operation.testRequest?.multipartFields ?? {}
          )
            .map(([key, value]) => `${key}=${value}`)
            .join('\n'),
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

const connectivityOperation = (operation: MediaOperationInput) => ({
  name: operation.name,
  capability: operation.capability || undefined,
  method: operation.method,
  path: operation.path,
  requestFormat: operation.requestFormat,
  modelMode: operation.modelMode,
  model: operation.model || undefined,
  testRequestJson: operation.testRequestJson,
  testRequestMultipartFieldsText: operation.testRequestMultipartFieldsText,
});

const idleConnectivityStatuses = (count: number): ConnectivityStatus[] =>
  Array.from({ length: Math.max(count, 1) }, () => ({ state: 'idle', message: '' }));

const defaultTestSelection = (input: ProviderEntryFormInput) => {
  const operations = input.operations?.length ? input.operations : [emptyOperation()];
  const models = input.models.length ? input.models : [emptyModel()];
  const operationIndex = getDefaultMediaTestOperationIndex(operations);
  const operation = operations[operationIndex];
  return {
    operationIndex,
    model: resolveMediaTestModels(operation, models, '').upstreamModel,
  };
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
  const gatewayBaseUrl = useAuthStore((state) => state.apiBase);
  const gatewayApiKey = useConfigStore((state) => state.config?.apiKeys?.[0] ?? '');
  const [form, setForm] = useState<ProviderEntryFormInput>(() =>
    inputFromConfig(brand, resource, mode)
  );
  const [selectedTestOperationIndex, setSelectedTestOperationIndex] = useState<number>(
    () => defaultTestSelection(inputFromConfig(brand, resource, mode)).operationIndex
  );
  const [selectedTestModel, setSelectedTestModel] = useState<string>(
    () => defaultTestSelection(inputFromConfig(brand, resource, mode)).model
  );
  const [gatewayStatus, setGatewayStatus] = useState<ConnectivityStatus>({
    state: 'idle',
    message: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ConnectivityStatus[]>(() =>
    idleConnectivityStatuses(inputFromConfig(brand, resource, mode).apiKeyEntries?.length ?? 1)
  );
  const initialSignature = useMemo(
    () => JSON.stringify(inputFromConfig(brand, resource, mode)),
    [brand, mode, resource]
  );
  const isDirty = JSON.stringify(form) !== initialSignature;
  const entries = form.apiKeyEntries?.length ? form.apiKeyEntries : [emptyKey()];
  const models = useMemo(() => (form.models.length ? form.models : [emptyModel()]), [form.models]);
  const operations = useMemo(
    () => (form.operations?.length ? form.operations : [emptyOperation()]),
    [form.operations]
  );
  const selectedTestOperation =
    operations[selectedTestOperationIndex] ?? operations[0] ?? emptyOperation();
  const testModelOptions = getMediaTestModelOptions(selectedTestOperation, models);
  const resolvedTestModels = resolveMediaTestModels(
    selectedTestOperation,
    models,
    selectedTestModel
  );
  const gatewayPath = getMediaGatewayPath(brand, connectivityOperation(selectedTestOperation));
  const mediaCapabilities = MEDIA_CAPABILITIES_BY_KIND[brand];
  const discovery = useModelDiscovery({
    brand,
    baseUrl: form.baseUrl,
    formHeaders: form.headers,
    apiKeyEntries: form.apiKeyEntries,
    apiKeyHeader: form.apiKeyHeader,
    apiKeyPrefix: form.apiKeyPrefix,
  });
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const existingModelNames = useMemo(
    () => new Set(models.map((model) => model.name.trim()).filter(Boolean)),
    [models]
  );
  const connectivityStatusSignature = useMemo(
    () =>
      mediaConnectivityTestSignature({
        baseUrl: form.baseUrl,
        apiKeyHeader: form.apiKeyHeader,
        apiKeyPrefix: form.apiKeyPrefix,
        headers: form.headers,
        apiKeyEntries: form.apiKeyEntries,
        operation: selectedTestOperation,
        model: resolvedTestModels.upstreamModel,
      }),
    [
      form.apiKeyEntries,
      form.apiKeyHeader,
      form.apiKeyPrefix,
      form.baseUrl,
      form.headers,
      resolvedTestModels.upstreamModel,
      selectedTestOperation,
    ]
  );
  const previousConnectivityStatusSignatureRef = useRef(connectivityStatusSignature);
  const directConnectivityGuardsRef = useRef(createMediaConnectivityResultGuardMap());
  const gatewayConnectivityGuardRef = useRef(createMediaConnectivityResultGuard());

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);
  useEffect(() => {
    if (previousConnectivityStatusSignatureRef.current === connectivityStatusSignature) return;
    previousConnectivityStatusSignatureRef.current = connectivityStatusSignature;
    directConnectivityGuardsRef.current.invalidateAll();
    gatewayConnectivityGuardRef.current.invalidate();
    setStatuses(idleConnectivityStatuses(entries.length));
    setGatewayStatus({ state: 'idle', message: '' });
  }, [connectivityStatusSignature, entries.length]);

  useEffect(() => {
    const nextForm = inputFromConfig(brand, resource, mode);
    const selection = defaultTestSelection(nextForm);
    setForm(nextForm);
    setSelectedTestOperationIndex(selection.operationIndex);
    setSelectedTestModel(selection.model);
    setGatewayStatus({ state: 'idle', message: '' });
    directConnectivityGuardsRef.current.invalidateAll();
    gatewayConnectivityGuardRef.current.invalidate();
    setStatuses(idleConnectivityStatuses(nextForm.apiKeyEntries?.length ?? 1));
    setDiscoveryOpen(false);
    setError(null);
  }, [brand, mode, resource]);

  useEffect(() => {
    const nextIndex = clampMediaTestOperationIndex(selectedTestOperationIndex, operations.length);
    if (nextIndex === selectedTestOperationIndex) return;
    setSelectedTestOperationIndex(nextIndex);
    setSelectedTestModel(resolveMediaTestModels(operations[nextIndex], models, '').upstreamModel);
    setGatewayStatus({ state: 'idle', message: '' });
  }, [models, operations, selectedTestOperationIndex]);

  useEffect(() => {
    if (selectedTestModel !== resolvedTestModels.upstreamModel) {
      setSelectedTestModel(resolvedTestModels.upstreamModel);
    }
  }, [resolvedTestModels.upstreamModel, selectedTestModel]);

  const updateField = <K extends keyof ProviderEntryFormInput>(
    key: K,
    value: ProviderEntryFormInput[K]
  ) => setForm((previous) => ({ ...previous, [key]: value }));

  const openDiscovery = () => {
    setDiscoveryOpen(true);
    if (!discovery.loading && !discovery.hasFetched) {
      void discovery.fetch();
    }
  };

  const applyDiscoveredModels = (incoming: Parameters<typeof mergeDiscoveredMediaModels>[1]) => {
    if (!incoming.length) return;
    setForm((previous) => ({
      ...previous,
      models: mergeDiscoveredMediaModels(previous.models, incoming),
    }));
  };

  const resolveEntryKey = (index: number): string => {
    const entry = entries[index];
    return entry.apiKey.trim() || entry.existingApiKey?.trim() || '';
  };

  const runTest = async (index: number): Promise<boolean> => {
    const entry = entries[index];
    const operation = selectedTestOperation.name.trim() ? selectedTestOperation : undefined;
    const model = resolvedTestModels.upstreamModel;
    const modelRequired = operation?.modelMode === 'required' && !model;
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
    const entryGuard = directConnectivityGuardsRef.current.guardFor(
      entry.authIndex?.trim() || `row:${index}`
    );
    const requestID = entryGuard.begin(connectivityStatusSignature);
    const request = buildMediaConnectivityRequest({
      kind: brand,
      baseUrl: form.baseUrl,
      model,
      operation: operation ? connectivityOperation(operation) : undefined,
      headers,
      apiKey: resolveEntryKey(index),
      apiKeyHeader: form.apiKeyHeader,
      apiKeyPrefix: form.apiKeyPrefix,
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
        { timeout: MEDIA_CONNECTIVITY_TIMEOUT_MS }
      );
      if (result.statusCode < 200 || result.statusCode >= 300)
        throw new Error(getApiCallErrorMessage(result));
      const applicationError = getMediaConnectivityApplicationError(result.body, result.bodyText);
      if (applicationError) throw new Error(applicationError);
      if (!entryGuard.isCurrent(requestID, connectivityStatusSignature)) {
        return false;
      }
      setStatuses((previous) =>
        previous.map((item, idx) => (idx === index ? { state: 'success', message: '' } : item))
      );
      return true;
    } catch (testError) {
      if (!entryGuard.isCurrent(requestID, connectivityStatusSignature)) {
        return false;
      }
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

  const runGatewayTest = async (): Promise<boolean> => {
    if (mode !== 'edit' || isDirty) {
      setGatewayStatus({
        state: 'error',
        message: t('providersPage.media.gatewaySaveFirst'),
      });
      return false;
    }
    if (!gatewayApiKey.trim()) {
      setGatewayStatus({
        state: 'error',
        message: t('providersPage.media.gatewayApiKeyRequired'),
      });
      return false;
    }
    if (!selectedTestOperation.name.trim()) {
      setGatewayStatus({
        state: 'error',
        message: t('providersPage.media.gatewayOperationRequired'),
      });
      return false;
    }
    if (selectedTestOperation.modelMode === 'required' && !resolvedTestModels.gatewayModel) {
      setGatewayStatus({
        state: 'error',
        message: t('providersPage.connectivity.modelRequired'),
      });
      return false;
    }

    const requestSignature = JSON.stringify({
      connectivityStatusSignature,
      gatewayBaseUrl,
      gatewayApiKey,
      gatewayPath,
      gatewayModel: resolvedTestModels.gatewayModel,
    });
    const requestID = gatewayConnectivityGuardRef.current.begin(requestSignature);
    const request = buildMediaGatewayConnectivityRequest({
      kind: brand,
      gatewayBaseUrl,
      gatewayApiKey,
      model: resolvedTestModels.gatewayModel,
      operation: connectivityOperation(selectedTestOperation),
    });
    setGatewayStatus({ state: 'loading', message: '' });
    try {
      const result = await requestMediaGatewayConnectivity(request, {
        timeoutMs: MEDIA_CONNECTIVITY_TIMEOUT_MS,
      });
      if (!gatewayConnectivityGuardRef.current.isCurrent(requestID, requestSignature)) {
        return false;
      }
      setGatewayStatus({
        state: 'success',
        message: t('providersPage.media.gatewaySuccess', {
          status: result.statusCode,
          route: gatewayPath,
          model: resolvedTestModels.gatewayModel || t('providersPage.media.modelNone'),
        }),
      });
      return true;
    } catch (testError) {
      if (!gatewayConnectivityGuardRef.current.isCurrent(requestID, requestSignature)) {
        return false;
      }
      setGatewayStatus({
        state: 'error',
        message: testError instanceof Error ? testError.message : String(testError),
      });
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
            <label className={styles.label}>{t('providersPage.media.apiKeyHeader')}</label>
            <input
              className={styles.input}
              value={form.apiKeyHeader ?? ''}
              onChange={(event) => updateField('apiKeyHeader', event.target.value)}
              disabled={mutating}
              placeholder="Authorization"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('providersPage.media.apiKeyPrefix')}</label>
            <input
              className={styles.input}
              value={form.apiKeyPrefix ?? ''}
              onChange={(event) => updateField('apiKeyPrefix', event.target.value)}
              disabled={mutating}
              placeholder="Bearer"
            />
          </div>
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
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>{t('providersPage.media.testOperation')}</label>
            <select
              className={styles.input}
              data-testid="media-test-operation"
              value={selectedTestOperationIndex}
              onChange={(event) => {
                const nextIndex = Number(event.target.value);
                const nextOperation = operations[nextIndex] ?? operations[0];
                setSelectedTestOperationIndex(nextIndex);
                setSelectedTestModel(
                  resolveMediaTestModels(nextOperation, models, '').upstreamModel
                );
                setGatewayStatus({ state: 'idle', message: '' });
              }}
              disabled={mutating}
            >
              {operations.map((operation, index) => (
                <option key={`${operation.name}-${index}`} value={index}>
                  {mediaTestOperationLabel(operation)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('providersPage.media.testModel')}</label>
            <select
              className={styles.input}
              data-testid="media-test-model"
              value={resolvedTestModels.upstreamModel}
              onChange={(event) => {
                setSelectedTestModel(event.target.value);
                setGatewayStatus({ state: 'idle', message: '' });
              }}
              disabled={mutating || selectedTestOperation.modelMode === 'none'}
            >
              {selectedTestOperation.modelMode === 'none' ? (
                <option value="">{t('providersPage.media.modelNone')}</option>
              ) : null}
              {testModelOptions.map((model) => (
                <option key={model.name} value={model.name}>
                  {describeMediaTestModel(model)}
                </option>
              ))}
              {!testModelOptions.length && resolvedTestModels.upstreamModel ? (
                <option value={resolvedTestModels.upstreamModel}>
                  {resolvedTestModels.upstreamModel}
                </option>
              ) : null}
            </select>
          </div>
        </div>
        <span className={styles.labelHint}>
          {t('providersPage.media.gatewayRoute')}: <code>{gatewayPath}</code>
        </span>
        <div className={styles.connectivityRow}>
          <button
            type="button"
            className={styles.connectivityBtn}
            onClick={() => void runGatewayTest()}
            disabled={mutating || gatewayStatus.state === 'loading'}
          >
            {gatewayStatus.state === 'loading' ? <IconLoader2 size={14} /> : null}
            <span>{t('providersPage.media.testGateway')}</span>
          </button>
          <ConnectivityStatusIcon state={gatewayStatus.state} />
          {gatewayStatus.state === 'success' ? (
            <span className={styles.connectivityHintSuccess}>{gatewayStatus.message}</span>
          ) : null}
        </div>
        {gatewayStatus.state === 'error' ? (
          <div className={styles.connectivityError}>{gatewayStatus.message}</div>
        ) : null}
        <span className={styles.labelHint}>{t('providersPage.media.directKeyTestHint')}</span>
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
        hint={`${existingModelNames.size}`}
      >
        <div className={styles.entriesList}>
          <div className={styles.entriesToolbar}>
            <button
              type="button"
              className={styles.connectivityBtn}
              onClick={openDiscovery}
              disabled={mutating}
            >
              <IconDownload size={14} />
              <span>{t('providersPage.discovery.openButton')}</span>
            </button>
          </div>
          {discoveryOpen ? (
            <ModelDiscoveryPanel
              loading={discovery.loading}
              error={discovery.error}
              models={discovery.models}
              hasFetched={discovery.hasFetched}
              existingNames={existingModelNames}
              mutating={mutating}
              onApply={applyDiscoveredModels}
              onReload={() => void discovery.fetch()}
              onClose={() => setDiscoveryOpen(false)}
            />
          ) : null}
          <ModelEntriesEditor
            models={models}
            supportsImage={false}
            supportsThinking={false}
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
        </div>
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
