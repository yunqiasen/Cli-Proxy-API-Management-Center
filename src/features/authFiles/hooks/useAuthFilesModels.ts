import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import type { AuthFileModelProbeResult } from '@/services/api/authFiles';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';

type ModelsError = 'unsupported' | null;

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsList: AuthFileModelItem[];
  modelsFileName: string;
  modelsFileType: string;
  modelsError: ModelsError;
  modelsAuthIndex: string;
  probeResults: Record<string, AuthFileModelProbeResult>;
  probeRunning: Record<string, boolean>;
  probeModel: (modelId: string) => Promise<void>;
  showModels: (item: AuthFileItem) => Promise<void>;
  closeModelsModal: () => void;
  /** 文件集变更后失效缓存；不传 names 则全部清空。 */
  invalidateModels: (names?: string[]) => void;
};

export function useAuthFilesModels(): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsError, setModelsError] = useState<ModelsError>(null);
  const [modelsAuthIndex, setModelsAuthIndex] = useState('');
  const [probeResults, setProbeResults] = useState<Record<string, AuthFileModelProbeResult>>({});
  const [probeRunning, setProbeRunning] = useState<Record<string, boolean>>({});
  const modelsCacheRef = useRef<Map<string, AuthFileModelItem[]>>(new Map());
  const modelsCacheVersionRef = useRef(0);
  const modelsFileVersionRef = useRef<Map<string, number>>(new Map());
  const activeModelsRequestIdRef = useRef(0);

  const probeModel = useCallback(
    async (modelId: string) => {
      const name = modelsFileName.trim();
      const model = modelId.trim();
      if (!name || !model) return;
      setProbeRunning((prev) => ({ ...prev, [model]: true }));
      try {
        const result = await authFilesApi.probeAuthFileModel(
          name,
          model,
          modelsAuthIndex || undefined
        );
        setProbeResults((prev) => ({ ...prev, [model]: result }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProbeResults((prev) => ({
          ...prev,
          [model]: { ok: false, status: 0, model, error: message },
        }));
      } finally {
        setProbeRunning((prev) => {
          const next = { ...prev };
          delete next[model];
          return next;
        });
      }
    },
    [modelsAuthIndex, modelsFileName]
  );

  const closeModelsModal = useCallback(() => {
    activeModelsRequestIdRef.current += 1;
    setModelsModalOpen(false);
    setModelsLoading(false);
  }, []);

  const invalidateModels = useCallback((names?: string[]) => {
    if (!names) {
      modelsCacheRef.current.clear();
      modelsFileVersionRef.current.clear();
      modelsCacheVersionRef.current += 1;
      return;
    }
    new Set(names.map((name) => name.trim()).filter(Boolean)).forEach((name) => {
      modelsCacheRef.current.delete(name);
      modelsFileVersionRef.current.set(name, (modelsFileVersionRef.current.get(name) ?? 0) + 1);
    });
  }, []);

  const showModels = useCallback(
    async (item: AuthFileItem) => {
      const cacheKey = item.name.trim();
      const requestId = ++activeModelsRequestIdRef.current;

      setModelsFileName(item.name);
      setModelsFileType(item.type || '');
      setModelsAuthIndex(
        typeof item.authIndex === 'string' ? item.authIndex : ''
      );
      setProbeResults({});
      setProbeRunning({});
      setModelsList([]);
      setModelsError(null);
      setModelsModalOpen(true);

      const cached = modelsCacheRef.current.get(cacheKey);
      if (cached) {
        setModelsList(cached);
        setModelsLoading(false);
        return;
      }

      const cacheVersion = modelsCacheVersionRef.current;
      const fileVersion = modelsFileVersionRef.current.get(cacheKey) ?? 0;
      const isCacheCurrent = () =>
        cacheVersion === modelsCacheVersionRef.current &&
        fileVersion === (modelsFileVersionRef.current.get(cacheKey) ?? 0);
      const isRequestCurrent = () => requestId === activeModelsRequestIdRef.current;

      setModelsLoading(true);
      try {
        const models = await authFilesApi.getModelsForAuthFile(item.name);
        if (isCacheCurrent()) {
          modelsCacheRef.current.set(cacheKey, models);
          if (isRequestCurrent()) setModelsList(models);
        }
      } catch (err) {
        if (!isRequestCurrent() || !isCacheCurrent()) return;
        const errorMessage = err instanceof Error ? err.message : '';
        if (
          errorMessage.includes('404') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('Not Found')
        ) {
          setModelsError('unsupported');
        } else {
          showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
        }
      } finally {
        if (isRequestCurrent()) setModelsLoading(false);
      }
    },
    [showNotification, t]
  );

  return {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    modelsAuthIndex,
    probeResults,
    probeRunning,
    probeModel,
    showModels,
    closeModelsModal,
    invalidateModels,
  };
}
