/**
 * Authentication state management
 * Migrated from the original login and connection modules
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthState, LoginCredentials, ConnectionStatus, ServerRuntimeKind } from '@/types';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { apiClient } from '@/services/api/client';
import { versionApi } from '@/services/api/version';
import { LegacyBackendError, probeLegacyBackend } from '@/services/api/legacyBackendProbe';
import { useConfigStore } from './useConfigStore';
import { useModelsStore } from './useModelsStore';
import { useQuotaStore } from './useQuotaStore';
import { useModelCatalogEditor } from '@/features/modelCatalog/hooks/useModelCatalogEditor';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

interface AuthStoreState extends AuthState {
  connectionStatus: ConnectionStatus;

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  updateServerVersion: (
    version: string | null,
    buildDate?: string | null,
    runtimeKind?: ServerRuntimeKind | null
  ) => void;
  updateServerRuntimeKind: (runtimeKind: ServerRuntimeKind) => void;
  updateServerPluginSupport: (supportsPlugin: boolean) => void;
}

let restoreSessionPromise: Promise<boolean> | null = null;

const detectRuntimeKind = async (): Promise<ServerRuntimeKind> => {
  try {
    return await versionApi.detectRuntimeKind();
  } catch (error) {
    console.warn('Runtime kind detection failed:', error);
    return 'unknown';
  }
};

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      rememberPassword: false,
      serverVersion: null,
      serverBuildDate: null,
      serverRuntimeKind: 'unknown',
      supportsPlugin: true,
      connectionStatus: 'disconnected',

      // Restore the session and reconnect automatically
      restoreSession: () => {
        if (restoreSessionPromise) return restoreSessionPromise;

        restoreSessionPromise = (async () => {
          obfuscatedStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);

          const wasLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
          const legacyBase =
            obfuscatedStorage.getItem<string>('apiBase') ||
            obfuscatedStorage.getItem<string>('apiUrl', { encrypt: true });
          const legacyKey = obfuscatedStorage.getItem<string>('managementKey');

          const { apiBase, managementKey, rememberPassword } = get();
          const resolvedBase = normalizeApiBase(
            apiBase || legacyBase || detectApiBaseFromLocation()
          );
          const resolvedKey = managementKey || legacyKey || '';
          const resolvedRememberPassword =
            rememberPassword || Boolean(managementKey) || Boolean(legacyKey);

          set({
            apiBase: resolvedBase,
            managementKey: resolvedKey,
            rememberPassword: resolvedRememberPassword,
          });
          apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey });

          if (wasLoggedIn && resolvedBase && resolvedKey) {
            try {
              await get().login({
                apiBase: resolvedBase,
                managementKey: resolvedKey,
                rememberPassword: resolvedRememberPassword,
              });
              return true;
            } catch (error) {
              console.warn('Auto login failed:', error);
              return false;
            }
          }

          return false;
        })();

        return restoreSessionPromise;
      },

      // Login
      login: async (credentials) => {
        const apiBase = normalizeApiBase(credentials.apiBase);
        const managementKey = credentials.managementKey.trim();
        const rememberPassword = credentials.rememberPassword ?? get().rememberPassword ?? false;

        try {
          set({
            connectionStatus: 'connecting',
            serverVersion: null,
            serverBuildDate: null,
            serverRuntimeKind: 'unknown',
            supportsPlugin: true,
          });
          useConfigStore.getState().clearCache();
          useModelsStore.getState().clearCache();
          useQuotaStore.getState().clearQuotaCache();
          useModelCatalogEditor.getState().reset();

          // Configure the API client
          apiClient.setConfig({
            apiBase,
            managementKey,
          });

          // Test connectivity by fetching config; diagnose legacy servers only when V8 routes are absent.
          const revision = apiClient.getConnectionRevision();
          try {
            await useConfigStore.getState().fetchConfig(true);
          } catch (error) {
            if (
              (error as { status?: number })?.status === 404 &&
              revision === apiClient.getConnectionRevision() &&
              (await probeLegacyBackend(apiBase, managementKey)) &&
              revision === apiClient.getConnectionRevision()
            ) {
              throw new LegacyBackendError();
            }
            throw error;
          }
          const runtimeKind = await detectRuntimeKind();

          // Login succeeded
          set({
            isAuthenticated: true,
            apiBase,
            managementKey,
            rememberPassword,
            connectionStatus: 'connected',
            ...(runtimeKind !== 'unknown' ? { serverRuntimeKind: runtimeKind } : {}),
          });
          if (rememberPassword) {
            localStorage.setItem('isLoggedIn', 'true');
          } else {
            localStorage.removeItem('isLoggedIn');
          }
        } catch (error: unknown) {
          set({ connectionStatus: 'error' });
          throw error;
        }
      },

      // Logout
      logout: () => {
        restoreSessionPromise = null;
        apiClient.setConfig({ apiBase: '', managementKey: '' });
        useConfigStore.getState().clearCache();
        useModelsStore.getState().clearCache();
        useQuotaStore.getState().clearQuotaCache();
        useModelCatalogEditor.getState().reset();
        set({
          isAuthenticated: false,
          apiBase: '',
          managementKey: '',
          serverVersion: null,
          serverBuildDate: null,
          serverRuntimeKind: 'unknown',
          supportsPlugin: true,
          connectionStatus: 'disconnected',
        });
        localStorage.removeItem('isLoggedIn');
      },

      // Check authentication state
      checkAuth: async () => {
        const { managementKey, apiBase } = get();

        if (!managementKey || !apiBase) {
          return false;
        }

        try {
          // Reconfigure the client
          apiClient.setConfig({ apiBase, managementKey });
          set({ supportsPlugin: true });

          // Verify the connection
          await useConfigStore.getState().fetchConfig();
          const runtimeKind = await detectRuntimeKind();

          set({
            isAuthenticated: true,
            connectionStatus: 'connected',
            ...(runtimeKind !== 'unknown' ? { serverRuntimeKind: runtimeKind } : {}),
          });

          return true;
        } catch {
          set({
            isAuthenticated: false,
            connectionStatus: 'error',
            supportsPlugin: true,
          });
          return false;
        }
      },

      // Update server version
      updateServerVersion: (version, buildDate, runtimeKind) => {
        set((state) => ({
          serverVersion: version || null,
          serverBuildDate: buildDate || null,
          serverRuntimeKind: runtimeKind || state.serverRuntimeKind,
        }));
      },

      updateServerRuntimeKind: (runtimeKind) => {
        set({ serverRuntimeKind: runtimeKind });
      },

      updateServerPluginSupport: () => {
        set({ supportsPlugin: true });
      },
    }),
    {
      name: STORAGE_KEY_AUTH,
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const data = obfuscatedStorage.getItem<AuthStoreState>(name);
          return data ? JSON.stringify(data) : null;
        },
        setItem: (name, value) => {
          obfuscatedStorage.setItem(name, JSON.parse(value));
        },
        removeItem: (name) => {
          obfuscatedStorage.removeItem(name);
        },
      })),
      partialize: (state) => ({
        apiBase: state.apiBase,
        ...(state.rememberPassword ? { managementKey: state.managementKey } : {}),
        rememberPassword: state.rememberPassword,
        serverVersion: state.serverVersion,
        serverBuildDate: state.serverBuildDate,
        serverRuntimeKind: state.serverRuntimeKind,
      }),
    }
  )
);

// Listen for global authentication failures
if (typeof window !== 'undefined') {
  window.addEventListener('unauthorized', () => {
    useAuthStore.getState().logout();
  });

  window.addEventListener('server-version-update', ((e: CustomEvent) => {
    const detail = e.detail || {};
    const runtimeKind =
      detail.runtimeKind === 'cpa' || detail.runtimeKind === 'home' ? detail.runtimeKind : null;
    useAuthStore
      .getState()
      .updateServerVersion(detail.version || null, detail.buildDate || null, runtimeKind);
  }) as EventListener);

  window.addEventListener('server-plugin-support-update', ((e: CustomEvent) => {
    useAuthStore.getState().updateServerPluginSupport(e.detail?.supportsPlugin === true);
  }) as EventListener);
}
