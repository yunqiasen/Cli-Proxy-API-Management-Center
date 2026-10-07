/**
 * Catalog editor hook — manages draft policy, inventory, preview and save
 * with connection-revision guards, session tokens, and stale-request
 * cancellation.
 *
 * Key invariants:
 *  - load() populates the draft from the saved policy ONLY when the user
 *    has not yet edited (editRevision === 0).  Clearing fields to defaults
 *    is an intentional edit and is preserved.
 *  - updateDraft() immediately invalidates in-flight preview state so the
 *    UI never shows stale counts.
 *  - open/reset/close/setFormat/save all bump session tokens so older
 *    async completions become no-ops.
 *  - save() snapshots the draft, verifies the readback policy equals the
 *    intended policy, and distinguishes persisted-pending-activation from
 *    failed write.  Missing inventory does not downgrade a persisted save.
 */

import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import { modelCatalogApi } from '@/services/api/modelCatalog';
import { useModelsStore } from '@/stores/useModelsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import {
  DEFAULT_CATALOG_POLICY,
  formatPatternLines,
  parsePatternLines,
  policiesEqual,
  serializePolicy,
} from '../policy';
import type { CatalogFormat, CatalogPolicy, CatalogView } from '../types';

export interface CatalogDraft {
  order: CatalogPolicy['order'];
  hiddenLines: string;
  pinnedLines: string;
}

const draftFromPolicy = (policy: CatalogPolicy): CatalogDraft => ({
  order: policy.order,
  hiddenLines: formatPatternLines(policy.hidden),
  pinnedLines: formatPatternLines(policy.pinned),
});

const draftToPolicy = (draft: CatalogDraft): CatalogPolicy =>
  serializePolicy({
    order: draft.order,
    hidden: parsePatternLines(draft.hiddenLines),
    pinned: parsePatternLines(draft.pinnedLines),
  });

export type SaveStatus = 'applied' | 'pending' | 'error';

export interface SaveResult {
  success: boolean;
  status: SaveStatus;
  error?: string;
}

interface ModelCatalogEditorState {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  inventoryError: string | null;
  configured: boolean;
  inventory: CatalogView | null;
  preview: CatalogView | null;
  previewLoading: boolean;
  previewError: string | null;
  saving: boolean;
  saveError: string | null;
  saveStatus: SaveStatus | null;
  saveMessage: string | null;
  format: CatalogFormat;
  draft: CatalogDraft;
  /** Non-zero once the user has touched the draft.  Reset on open/reset/close. */
  editRevision: number;
  /** Incremented after each persisted save — SystemPage refetches public models. */
  saveGeneration: number;

  // Actions
  openDialog: (format?: CatalogFormat) => void;
  closeDialog: () => void;
  open: () => void;
  load: () => Promise<void>;
  setFormat: (format: CatalogFormat) => void;
  updateDraft: (partial: Partial<CatalogDraft>) => void;
  runPreview: () => Promise<void>;
  save: () => Promise<SaveResult>;
  reset: () => void;
}

// Session tokens — each is bumped on open/reset/close/setFormat/save so
// older async completions are discarded by identity comparison.
let loadToken = 0;
let previewToken = 0;
let saveToken = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useModelCatalogEditor = create<ModelCatalogEditorState>((set, get) => ({
  isOpen: false,
  loading: false,
  error: null,
  inventoryError: null,
  configured: false,
  inventory: null,
  preview: null,
  previewLoading: false,
  previewError: null,
  saving: false,
  saveError: null,
  saveStatus: null,
  saveMessage: null,
  format: 'openai',
  draft: draftFromPolicy(DEFAULT_CATALOG_POLICY),
  editRevision: 0,
  saveGeneration: 0,

  openDialog: (format: CatalogFormat = 'openai') => {
    loadToken += 1;
    previewToken += 1;
    saveToken += 1;
    set({
      isOpen: true,
      format,
      loading: false,
      error: null,
      inventoryError: null,
      inventory: null,
      preview: null,
      previewLoading: false,
      previewError: null,
      saving: false,
      saveError: null,
      saveStatus: null,
      saveMessage: null,
      configured: false,
      draft: draftFromPolicy(DEFAULT_CATALOG_POLICY),
      editRevision: 0,
    });
  },

  closeDialog: () => {
    loadToken += 1;
    previewToken += 1;
    saveToken += 1;
    set({
      isOpen: false,
      loading: false,
      previewLoading: false,
      saving: false,
      preview: null,
      previewError: null,
      saveStatus: null,
      saveMessage: null,
    });
  },

  open: () => get().openDialog(),

  load: async () => {
    const currentRevision = apiClient.getConnectionRevision();
    const myToken = (loadToken += 1);
    set({ loading: true, error: null, inventoryError: null });

    // Load policy first so the draft is populated even if inventory fails.
    try {
      const { policy, configured } = await modelCatalogApi.getPolicy();
      if (apiClient.getConnectionRevision() !== currentRevision) return;
      if (myToken !== loadToken) return;

      // Only apply the policy to the draft if the user has not already
      // edited since the dialog was opened.  This preserves intentional
      // clears (e.g. user deleted all hidden rules then reloaded).
      const state = get();
      const isDraftPristine = state.editRevision === 0;
      const nextDraft = isDraftPristine ? draftFromPolicy(policy) : state.draft;
      set({ configured, draft: nextDraft });
    } catch (err: unknown) {
      if (apiClient.getConnectionRevision() !== currentRevision) return;
      if (myToken !== loadToken) return;
      const message = err instanceof Error ? err.message : 'Failed to load policy';
      set({ loading: false, error: message });
      return;
    }

    // Load inventory — failure is non-fatal; rules remain editable.
    let inventory: CatalogView | null = null;
    try {
      inventory = await modelCatalogApi.getInventory(get().format);
      if (apiClient.getConnectionRevision() !== currentRevision) return;
      if (myToken !== loadToken) return;
      set({ inventory, loading: false });
      const state = get();
      if (
        state.configured &&
        state.editRevision === 0 &&
        !policiesEqual(inventory.policy, draftToPolicy(state.draft))
      ) {
        set({ saveStatus: 'pending', saveMessage: 'pending' });
      }
      if (
        state.saveStatus === 'pending' &&
        state.editRevision === 0 &&
        policiesEqual(inventory.policy, draftToPolicy(state.draft))
      ) {
        useModelsStore.getState().clearCache();
        set({
          saveStatus: 'applied',
          saveMessage: 'applied',
          saveGeneration: state.saveGeneration + 1,
        });
      }
    } catch (err: unknown) {
      if (apiClient.getConnectionRevision() !== currentRevision) return;
      if (myToken !== loadToken) return;
      const message = err instanceof Error ? err.message : 'Failed to load inventory';
      set({ loading: false, inventoryError: message });
    }

    // If the user has already edited the draft, re-run the preview against
    // the freshly loaded inventory format so counts reflect the new format.
    if (
      inventory &&
      get().isOpen &&
      (get().editRevision > 0 || !policiesEqual(inventory.policy, draftToPolicy(get().draft)))
    ) {
      void get().runPreview();
    }
  },

  setFormat: (format: CatalogFormat) => {
    // Invalidate all old loads, previews, and saves for the previous format.
    loadToken += 1;
    previewToken += 1;
    saveToken += 1;
    set({
      format,
      inventory: null,
      preview: null,
      previewLoading: false,
      previewError: null,
      loading: false,
      error: null,
      inventoryError: null,
      saving: false,
      saveError: null,
      saveStatus: null,
      saveMessage: null,
      // editRevision is preserved — user edits apply across formats.
    });
  },

  updateDraft: (partial: Partial<CatalogDraft>) => {
    // Immediately invalidate any in-flight preview so the UI does not
    // show stale counts from an older draft.  The component's debounce
    // timer will schedule a fresh preview shortly.
    previewToken += 1;
    set((state) => ({
      draft: { ...state.draft, ...partial },
      editRevision: state.editRevision + 1,
      saveStatus: null,
      saveMessage: null,
      saveError: null,
      preview: null,
      previewLoading: false,
      previewError: null,
    }));
  },

  runPreview: async () => {
    // No preview requests after the dialog is closed.
    if (!get().isOpen || get().saving) return;
    const currentRevision = apiClient.getConnectionRevision();
    const myToken = (previewToken += 1);
    set({ previewLoading: true, previewError: null });

    try {
      const view = await modelCatalogApi.previewCatalog(get().format, draftToPolicy(get().draft));
      if (apiClient.getConnectionRevision() !== currentRevision) return;
      if (myToken !== previewToken) return;
      set({ preview: view, previewLoading: false });
    } catch (err: unknown) {
      if (apiClient.getConnectionRevision() !== currentRevision) return;
      if (myToken !== previewToken) return;
      const message = err instanceof Error ? err.message : 'Preview failed';
      set({ previewLoading: false, previewError: message });
    }
  },

  save: async () => {
    const currentRevision = apiClient.getConnectionRevision();
    // Prevent repeated / overlapping saves.
    if (get().saving) {
      return { success: false, status: 'error', error: 'Save already in progress' };
    }
    const mySaveToken = (saveToken += 1);

    // Invalidate old loads and previews — the save is now authoritative.
    loadToken += 1;
    previewToken += 1;

    // Snapshot the intended policy so later draft mutations do not affect
    // the in-flight save.
    const intendedPolicy = draftToPolicy(get().draft);

    set({
      saving: true,
      saveError: null,
      saveStatus: null,
      saveMessage: null,
      preview: null,
      previewLoading: false,
      previewError: null,
    });

    const checkGuard = () => {
      if (apiClient.getConnectionRevision() !== currentRevision) {
        throw new Error('Connection changed while saving');
      }
      if (mySaveToken !== saveToken) {
        throw new Error('Session invalidated');
      }
    };

    try {
      // 1. Persist the policy.
      await modelCatalogApi.putPolicy(intendedPolicy);
      checkGuard();

      // 2. Read back the saved policy and verify it matches intent.
      const { policy: readback } = await modelCatalogApi.getPolicy();
      checkGuard();

      if (!policiesEqual(readback, intendedPolicy)) {
        // The persisted policy does not match what we asked to save.
        set({
          saving: false,
          saveStatus: 'error',
          saveError: 'Saved policy does not match intended policy',
          saveMessage: 'Saved policy does not match intended policy',
        });
        return {
          success: false,
          status: 'error',
          error: 'Saved policy does not match intended policy',
        };
      }

      // Policy is persisted.  Refresh public caches so discovery changes
      // propagate even before runtime inventory catches up.
      useModelsStore.getState().clearCache();
      useConfigStore.getState().clearCache();

      // 3. Check whether the runtime inventory already reflects the new
      //    policy.  Config reload is asynchronous, so the inventory may
      //    still show the old state for a moment.
      let inventory: CatalogView | null = null;
      let applied = false;
      let inventoryError: string | null = null;
      try {
        inventory = await modelCatalogApi.getInventory(get().format);
        checkGuard();
        applied = policiesEqual(inventory.policy, intendedPolicy);
      } catch (err: unknown) {
        // Missing inventory does not downgrade a persisted save to error.
        applied = false;
        inventoryError = err instanceof Error ? err.message : 'Failed to load inventory';
      }

      checkGuard();

      // Bounded retry if inventory is still stale (config reload is async).
      if (!applied && inventory) {
        await sleep(300);
        checkGuard();
        try {
          inventory = await modelCatalogApi.getInventory(get().format);
          checkGuard();
          applied = policiesEqual(inventory.policy, intendedPolicy);
        } catch (err: unknown) {
          inventoryError = err instanceof Error ? err.message : 'Failed to load inventory';
          // Still not applied — report pending.
        }
      }

      checkGuard();

      // Update editor state only while this save still owns the session.
      set({
        saving: false,
        configured: true,
        draft: draftFromPolicy(readback),
        inventory,
        inventoryError,
        preview: null,
        saveStatus: applied ? 'applied' : 'pending',
        saveMessage: applied ? 'applied' : 'pending',
        editRevision: 0,
        saveGeneration: get().saveGeneration + 1,
      });

      // A persisted policy may still be waiting for reload; keep its draft view usable.
      if (!applied) void get().runPreview();

      return {
        success: true,
        status: applied ? 'applied' : ('pending' as SaveStatus),
      };
    } catch (err: unknown) {
      // Connection changed or session invalidated — do NOT mutate state in
      // the new session.
      const message = err instanceof Error ? err.message : 'Save failed';
      if (apiClient.getConnectionRevision() !== currentRevision || mySaveToken !== saveToken) {
        // This session is stale; silently discard.
        return { success: false, status: 'error' as SaveStatus, error: message };
      }
      set({
        saving: false,
        saveStatus: 'error',
        saveError: message,
        saveMessage: message,
      });
      return { success: false, status: 'error' as SaveStatus, error: message };
    }
  },

  reset: () => {
    loadToken += 1;
    previewToken += 1;
    saveToken += 1;
    set({
      isOpen: false,
      loading: false,
      error: null,
      inventoryError: null,
      inventory: null,
      preview: null,
      previewLoading: false,
      previewError: null,
      saving: false,
      saveError: null,
      saveStatus: null,
      saveMessage: null,
      configured: false,
      draft: draftFromPolicy(DEFAULT_CATALOG_POLICY),
      editRevision: 0,
    });
  },
}));

export { draftToPolicy, draftFromPolicy };
