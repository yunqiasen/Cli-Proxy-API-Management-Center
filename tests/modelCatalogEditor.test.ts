import { afterEach, describe, expect, test, spyOn } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { modelCatalogApi } from '../src/services/api/modelCatalog';
import { useModelsStore } from '../src/stores/useModelsStore';
import { useConfigStore } from '../src/stores/useConfigStore';
import { useModelCatalogEditor } from '../src/features/modelCatalog/hooks/useModelCatalogEditor';
import type { CatalogView } from '../src/features/modelCatalog/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const makeView = (overrides: Partial<CatalogView> = {}): CatalogView => ({
  format: 'openai',
  policy: { order: 'preserve', hidden: [], pinned: [] },
  entries: [
    {
      id: 'gpt-4',
      label: 'GPT-4',
      format: 'openai',
      hidden: false,
      hidden_rules: [],
      pinned_rules: [],
      position: 0,
    },
    {
      id: 'gpt-3.5',
      label: 'GPT-3.5',
      format: 'openai',
      hidden: false,
      hidden_rules: [],
      pinned_rules: [],
      position: 1,
    },
  ],
  visible_ids: ['gpt-4', 'gpt-3.5'],
  counts: { total: 2, visible: 2, hidden: 0 },
  model_sort_enabled: false,
  ...overrides,
});

const state = () => useModelCatalogEditor.getState();

const resetStores = () => {
  useModelsStore.getState().clearCache();
  useConfigStore.getState().clearCache();
  useModelCatalogEditor.getState().reset();
};

const originalGetPolicy = modelCatalogApi.getPolicy;
const originalGetInventory = modelCatalogApi.getInventory;
const originalPreview = modelCatalogApi.previewCatalog;
const originalPutPolicy = modelCatalogApi.putPolicy;
const originalConnectionRevision = apiClient.getConnectionRevision.bind(apiClient);

afterEach(() => {
  modelCatalogApi.getPolicy = originalGetPolicy;
  modelCatalogApi.getInventory = originalGetInventory;
  modelCatalogApi.previewCatalog = originalPreview;
  modelCatalogApi.putPolicy = originalPutPolicy;
  apiClient.getConnectionRevision = originalConnectionRevision;
  resetStores();
});

describe('useModelCatalogEditor load and draft restoration', () => {
  test('loads policy and inventory when opened', async () => {
    const view = makeView();
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'asc', hidden: ['gpt-3.5'], pinned: ['gpt-4'] },
      configured: true,
    });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(view);

    state().open();
    await state().load();

    expect(state().loading).toBe(false);
    expect(state().error).toBeNull();
    expect(state().draft.order).toBe('asc');
    expect(state().draft.hiddenLines).toBe('gpt-3.5');
    expect(state().draft.pinnedLines).toBe('gpt-4');
    expect(state().configured).toBe(true);
    expect(state().inventory?.entries).toHaveLength(2);
  });

  test('unconfigured policy loads defaults', async () => {
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: false,
    });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());

    state().open();
    await state().load();

    expect(state().configured).toBe(false);
    expect(state().draft.order).toBe('preserve');
    expect(state().draft.hiddenLines).toBe('');
    expect(state().draft.pinnedLines).toBe('');
  });

  test('inventory failure preserves manual rule editing', async () => {
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: ['existing'], pinned: [] },
      configured: true,
    });
    spyOn(modelCatalogApi, 'getInventory').mockRejectedValue(new Error('inventory down'));

    state().open();
    await state().load();

    expect(state().inventoryError).toBe('inventory down');
    expect(state().inventory).toBeNull();
    // Draft is still loaded from policy
    expect(state().draft.hiddenLines).toBe('existing');
  });
});

describe('useModelCatalogEditor stale preview protection', () => {
  test('a late initial load does not overwrite user edits', async () => {
    const slowInventory = deferred<CatalogView>();
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: false,
    });
    spyOn(modelCatalogApi, 'getInventory').mockReturnValue(slowInventory.promise);

    state().open();
    const loadPromise = state().load();

    // User edits before the slow inventory resolves — use updateDraft so
    // editRevision is incremented and the load does not clobber the edit.
    useModelCatalogEditor.getState().updateDraft({ hiddenLines: 'user-typed-rule' });

    slowInventory.resolve(makeView());
    await loadPromise;

    // The editor must not clobber the user edit with the stale initial read
    expect(state().draft.hiddenLines).toBe('user-typed-rule');
  });

  test('a stale preview response does not overwrite a newer preview', async () => {
    const oldPreview = deferred<CatalogView>();
    const newPreview = deferred<CatalogView>();
    spyOn(modelCatalogApi, 'previewCatalog')
      .mockReturnValueOnce(oldPreview.promise)
      .mockReturnValueOnce(newPreview.promise);

    state().open();
    const first = state().runPreview();
    const second = state().runPreview();
    oldPreview.resolve(makeView({ visible_ids: ['stale'] }));
    await first;
    newPreview.resolve(makeView({ visible_ids: ['fresh'] }));
    await second;

    expect(state().preview?.visible_ids).toEqual(['fresh']);
  });
});

describe('useModelCatalogEditor connection guards', () => {
  test('stale load after connection change does not update state', async () => {
    const slowLoad = deferred<CatalogView>();
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: false,
    });
    spyOn(modelCatalogApi, 'getInventory').mockReturnValue(slowLoad.promise);

    let revision = 1;
    spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);

    state().open();
    const loadPromise = state().load();

    // Simulate connection switch
    revision = 2;
    state().reset();

    slowLoad.resolve(
      makeView({
        entries: [
          {
            id: 'stale',
            label: 'S',
            format: 'openai',
            hidden: false,
            hidden_rules: [],
            pinned_rules: [],
            position: 0,
          },
        ],
      })
    );
    await loadPromise;

    expect(state().inventory).toBeNull();
  });

  test('stale preview after connection change is discarded', async () => {
    const slowPreview = deferred<CatalogView>();
    spyOn(modelCatalogApi, 'previewCatalog').mockReturnValue(slowPreview.promise);

    let revision = 1;
    spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);

    state().open();
    const previewPromise = state().runPreview();
    revision = 2;
    state().reset();
    slowPreview.resolve(makeView());
    await previewPromise;

    expect(state().preview).toBeNull();
  });
});

describe('useModelCatalogEditor save', () => {
  test('successful save does readback, refreshes caches, and clears preview', async () => {
    spyOn(modelCatalogApi, 'getPolicy')
      .mockResolvedValueOnce({
        policy: { order: 'preserve', hidden: [], pinned: [] },
        configured: false,
      }) // initial load
      .mockResolvedValueOnce({
        policy: { order: 'asc', hidden: ['gpt-3.5'], pinned: [] },
        configured: true,
      }); // readback
    spyOn(modelCatalogApi, 'getInventory')
      .mockResolvedValueOnce(makeView()) // initial load
      .mockResolvedValueOnce(
        makeView({
          entries: [
            {
              id: 'gpt-4',
              label: 'GPT-4',
              format: 'openai',
              hidden: false,
              hidden_rules: [],
              pinned_rules: [],
              position: 0,
            },
          ],
        })
      ); // post-save inventory
    const putSpy = spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({
      status: 'ok',
      'config-version': 8,
    });
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);
    const modelsClearSpy = spyOn(useModelsStore.getState(), 'clearCache');
    const configClearSpy = spyOn(useConfigStore.getState(), 'clearCache');

    state().open();
    await state().load();
    useModelCatalogEditor.setState((s) => ({
      draft: { ...s.draft, order: 'asc', hiddenLines: 'gpt-3.5' },
    }));

    const result = await state().save();
    expect(result.success).toBe(true);
    expect(putSpy).toHaveBeenCalledWith({ order: 'asc', hidden: ['gpt-3.5'], pinned: [] });
    expect(modelsClearSpy).toHaveBeenCalled();
    expect(configClearSpy).toHaveBeenCalled();
    // Readback updated the draft
    expect(state().draft.order).toBe('asc');
    expect(state().draft.hiddenLines).toBe('gpt-3.5');
  });

  test('failed save preserves user draft and does not show success', async () => {
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: false,
    });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());
    spyOn(modelCatalogApi, 'putPolicy').mockRejectedValue(new Error('write failed'));
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    await state().load();
    useModelCatalogEditor.setState((s) => ({
      draft: { ...s.draft, hiddenLines: 'my-rule' },
    }));

    const result = await state().save();
    expect(result.success).toBe(false);
    expect(result.error).toBe('write failed');
    // Draft preserved
    expect(state().draft.hiddenLines).toBe('my-rule');
  });
});
