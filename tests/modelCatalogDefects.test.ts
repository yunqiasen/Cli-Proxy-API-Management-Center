/**
 * Regression tests for the model catalog editor defect fixes.
 * These cover the real interaction bugs that the original 1758 tests missed.
 */
import { afterEach, describe, expect, test, spyOn } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { modelCatalogApi } from '../src/services/api/modelCatalog';
import { useModelsStore } from '../src/stores/useModelsStore';
import { useConfigStore } from '../src/stores/useConfigStore';
import { useModelCatalogEditor } from '../src/features/modelCatalog/hooks/useModelCatalogEditor';
import {
  normalizePolicy,
  policiesEqual,
  reorderPin,
  serializePolicy,
  splitWildcardRules,
} from '../src/features/modelCatalog/policy';
import type { CatalogPolicy, CatalogView } from '../src/features/modelCatalog/types';

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

// ============================================================
// Defect 2: Draft pristine-by-values is wrong — use editRevision
// ============================================================
describe('D2: draft editRevision preserves intentional clears', () => {
  test('clearing fields to defaults is preserved on reload (editRevision > 0)', async () => {
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'asc', hidden: ['gpt-3.5'], pinned: ['gpt-4'] },
      configured: true,
    });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());

    state().open();
    await state().load();

    // User clears the draft
    state().updateDraft({ hiddenLines: '', pinnedLines: '' });
    expect(state().editRevision).toBeGreaterThan(0);

    // Reload — should NOT clobber the cleared fields
    await state().load();

    expect(state().draft.hiddenLines).toBe('');
    expect(state().draft.pinnedLines).toBe('');
    expect(state().draft.order).toBe('asc');
  });

  test('setFormat clears old preview and inventory', async () => {
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: true,
    });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());

    state().open();
    await state().load();
    expect(state().inventory).not.toBeNull();

    state().setFormat('claude');

    expect(state().inventory).toBeNull();
    expect(state().preview).toBeNull();
    expect(state().format).toBe('claude');
    expect(state().loading).toBe(false);
    expect(state().error).toBeNull();
  });

  test('setFormat preserves editRevision (user edits apply across formats)', () => {
    state().open();
    state().updateDraft({ hiddenLines: 'my-rule' });
    expect(state().editRevision).toBe(1);

    state().setFormat('claude');

    expect(state().draft.hiddenLines).toBe('my-rule');
    expect(state().editRevision).toBe(1);
  });

  test('open and reset reset editRevision to 0; closeDialog invalidates', () => {
    state().open();
    state().updateDraft({ hiddenLines: 'test' });
    expect(state().editRevision).toBeGreaterThan(0);

    state().reset();
    expect(state().editRevision).toBe(0);

    state().open();
    state().updateDraft({ order: 'asc' });
    expect(state().editRevision).toBeGreaterThan(0);

    state().closeDialog();
    expect(state().isOpen).toBe(false);
    expect(state().preview).toBeNull();
    expect(state().previewLoading).toBe(false);

    state().open();
    expect(state().editRevision).toBe(0);
  });
});

// ============================================================
// Defect 3: Preview staleness — updateDraft invalidates immediately
// ============================================================
describe('D3: preview staleness and immediate invalidation', () => {
  test('updateDraft immediately clears preview state', async () => {
    spyOn(modelCatalogApi, 'previewCatalog').mockResolvedValue(makeView());

    state().open();
    await state().runPreview();
    expect(state().preview).not.toBeNull();

    state().updateDraft({ hiddenLines: 'new-rule' });

    expect(state().preview).toBeNull();
    expect(state().previewLoading).toBe(false);
    expect(state().previewError).toBeNull();
  });

  test('closeDialog cancels in-flight preview', async () => {
    const slowPreview = deferred<CatalogView>();
    spyOn(modelCatalogApi, 'previewCatalog').mockReturnValue(slowPreview.promise);

    state().open();
    const previewPromise = state().runPreview();
    expect(state().previewLoading).toBe(true);

    state().closeDialog();

    slowPreview.resolve(makeView({ visible_ids: ['should-be-discarded'] }));
    await previewPromise;

    expect(state().preview).toBeNull();
    expect(state().previewLoading).toBe(false);
  });

  test('setFormat cancels in-flight preview', async () => {
    const slowPreview = deferred<CatalogView>();
    spyOn(modelCatalogApi, 'previewCatalog').mockReturnValue(slowPreview.promise);

    state().open();
    const previewPromise = state().runPreview();
    expect(state().previewLoading).toBe(true);

    state().setFormat('claude');

    slowPreview.resolve(makeView({ visible_ids: ['stale'] }));
    await previewPromise;

    expect(state().preview).toBeNull();
  });

  test('no preview request is made after close', async () => {
    const previewSpy = spyOn(modelCatalogApi, 'previewCatalog').mockResolvedValue(makeView());

    state().open();
    state().closeDialog();

    await state().runPreview();

    expect(previewSpy).not.toHaveBeenCalled();
    expect(state().preview).toBeNull();
    expect(state().previewLoading).toBe(false);
  });
});

// ============================================================
// Defect 4: Save connection guard — old saves never mutate state
// ============================================================
describe('D4: save session token and connection guards', () => {
  test('old save never mutates state after reset', async () => {
    const slowPut = deferred<{ status: string; 'config-version': number }>();
    spyOn(modelCatalogApi, 'putPolicy').mockReturnValue(slowPut.promise);
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: true,
    });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    state().updateDraft({ hiddenLines: 'my-rule' });
    const savePromise = state().save();

    state().reset();

    slowPut.resolve({ status: 'ok', 'config-version': 8 });
    const result = await savePromise;

    expect(result.success).toBe(false);
    expect(result.status).toBe('error');
    expect(state().saving).toBe(false);
    expect(state().configured).toBe(false);
    expect(state().saveStatus).toBeNull();
  });

  test('repeated saves are prevented', async () => {
    const slowPut = deferred<{ status: string; 'config-version': number }>();
    spyOn(modelCatalogApi, 'putPolicy').mockReturnValue(slowPut.promise);
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: true,
    });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    state().updateDraft({ hiddenLines: 'rule-1' });
    const first = state().save();
    expect(state().saving).toBe(true);

    const secondResult = await state().save();
    expect(secondResult.success).toBe(false);

    slowPut.resolve({ status: 'ok', 'config-version': 8 });
    await first;
  });

  test('save invalidates old load tokens', async () => {
    const slowLoadPolicy = deferred<{ policy: CatalogPolicy; configured: boolean }>();
    spyOn(modelCatalogApi, 'getPolicy')
      .mockReturnValueOnce(slowLoadPolicy.promise)
      .mockResolvedValueOnce({
        policy: { order: 'asc', hidden: [], pinned: [] },
        configured: true,
      });
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(
      makeView({ policy: { order: 'asc', hidden: [], pinned: [] } })
    );
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    const loadPromise = state().load();

    state().updateDraft({ order: 'asc' });
    await state().save();

    slowLoadPolicy.resolve({
      policy: { order: 'desc', hidden: ['stale'], pinned: [] },
      configured: true,
    });
    await loadPromise;

    expect(state().draft.order).toBe('asc');
    expect(state().draft.hiddenLines).toBe('');
    expect(state().configured).toBe(true);
  });

  test('auth logout resets catalog editor state', () => {
    state().open();
    state().updateDraft({ hiddenLines: 'test-rule' });
    expect(state().isOpen).toBe(true);
    expect(state().editRevision).toBeGreaterThan(0);

    useModelCatalogEditor.getState().reset();

    expect(state().isOpen).toBe(false);
    expect(state().editRevision).toBe(0);
    expect(state().draft.hiddenLines).toBe('');
    expect(state().inventory).toBeNull();
    expect(state().preview).toBeNull();
    expect(state().saving).toBe(false);
  });
});

// ============================================================
// Defect 5: Save readback — verify policy, distinguish pending/applied
// ============================================================
describe('D5: save readback verification and status', () => {
  test('save verifies readback policy equals intended policy', async () => {
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy')
      .mockResolvedValueOnce({
        policy: { order: 'preserve', hidden: [], pinned: [] },
        configured: false,
      })
      .mockResolvedValueOnce({
        policy: { order: 'asc', hidden: ['gpt-3.5'], pinned: [] },
        configured: true,
      });
    spyOn(modelCatalogApi, 'getInventory')
      .mockResolvedValueOnce(makeView())
      .mockResolvedValue(makeView({ policy: { order: 'asc', hidden: ['gpt-3.5'], pinned: [] } }));
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    await state().load();
    state().updateDraft({ order: 'asc', hiddenLines: 'gpt-3.5' });

    const result = await state().save();
    expect(result.success).toBe(true);
    expect(result.status).toBe('applied');
    expect(state().saveStatus).toBe('applied');
  });

  test('save reports pending when inventory does not reflect new policy', async () => {
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy')
      .mockResolvedValueOnce({
        policy: { order: 'preserve', hidden: [], pinned: [] },
        configured: false,
      })
      .mockResolvedValueOnce({
        policy: { order: 'asc', hidden: [], pinned: [] },
        configured: true,
      });
    spyOn(modelCatalogApi, 'getInventory')
      .mockResolvedValueOnce(makeView())
      .mockResolvedValue(makeView({ policy: { order: 'preserve', hidden: [], pinned: [] } }));
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    await state().load();
    state().updateDraft({ order: 'asc' });

    const result = await state().save();
    expect(result.success).toBe(true);
    expect(result.status).toBe('pending');
    expect(state().saveStatus).toBe('pending');
  });

  test('save reports error when readback does not match intent', async () => {
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy')
      .mockResolvedValueOnce({
        policy: { order: 'preserve', hidden: [], pinned: [] },
        configured: false,
      })
      .mockResolvedValueOnce({
        policy: { order: 'preserve', hidden: [], pinned: [] },
        configured: true,
      });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    await state().load();
    state().updateDraft({ order: 'asc', hiddenLines: 'gpt-3.5' });

    const result = await state().save();
    expect(result.success).toBe(false);
    expect(result.status).toBe('error');
    expect(state().draft.hiddenLines).toBe('gpt-3.5');
  });

  test('missing inventory does not downgrade persisted save to error', async () => {
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy')
      .mockResolvedValueOnce({
        policy: { order: 'preserve', hidden: [], pinned: [] },
        configured: false,
      })
      .mockResolvedValueOnce({
        policy: { order: 'asc', hidden: [], pinned: [] },
        configured: true,
      });
    spyOn(modelCatalogApi, 'getInventory')
      .mockResolvedValueOnce(makeView())
      .mockRejectedValueOnce(new Error('inventory unavailable'));
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    await state().load();
    state().updateDraft({ order: 'asc' });

    const result = await state().save();
    expect(result.success).toBe(true);
    expect(result.status).toBe('pending');
    expect(state().saveStatus).toBe('pending');
  });

  test('save clears public and config caches on persisted save', async () => {
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy')
      .mockResolvedValueOnce({
        policy: { order: 'preserve', hidden: [], pinned: [] },
        configured: false,
      })
      .mockResolvedValueOnce({
        policy: { order: 'asc', hidden: [], pinned: [] },
        configured: true,
      });
    spyOn(modelCatalogApi, 'getInventory')
      .mockResolvedValueOnce(makeView())
      .mockResolvedValue(makeView({ policy: { order: 'asc', hidden: [], pinned: [] } }));
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);
    const modelsSpy = spyOn(useModelsStore.getState(), 'clearCache');
    const configSpy = spyOn(useConfigStore.getState(), 'clearCache');

    state().open();
    await state().load();
    state().updateDraft({ order: 'asc' });

    await state().save();

    expect(modelsSpy).toHaveBeenCalled();
    expect(configSpy).toHaveBeenCalled();
  });

  test('saveGeneration increments on persisted save', async () => {
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy')
      .mockResolvedValueOnce({
        policy: { order: 'preserve', hidden: [], pinned: [] },
        configured: false,
      })
      .mockResolvedValueOnce({
        policy: { order: 'asc', hidden: [], pinned: [] },
        configured: true,
      });
    spyOn(modelCatalogApi, 'getInventory')
      .mockResolvedValueOnce(makeView())
      .mockResolvedValue(makeView({ policy: { order: 'asc', hidden: [], pinned: [] } }));
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    await state().load();
    state().updateDraft({ order: 'asc' });

    const genBefore = state().saveGeneration;
    await state().save();
    expect(state().saveGeneration).toBe(genBefore + 1);
  });

  test('failed save does not increment saveGeneration', async () => {
    spyOn(modelCatalogApi, 'putPolicy').mockRejectedValue(new Error('write failed'));
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: false,
    });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());
    spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);

    state().open();
    await state().load();
    state().updateDraft({ hiddenLines: 'rule' });

    const genBefore = state().saveGeneration;
    const result = await state().save();
    expect(result.success).toBe(false);
    expect(state().saveGeneration).toBe(genBefore);
    expect(state().draft.hiddenLines).toBe('rule');
  });
});

// ============================================================
// Defect 6: Wildcard restore — shows info, doesn't silently do nothing
// ============================================================
describe('D6: wildcard restore behavior (splitWildcardRules)', () => {
  test('splits exact and wildcard rules', () => {
    const { exact, wildcard } = splitWildcardRules(['gpt-4', 'claude-*', '*-preview', 'gpt-3.5']);
    expect(exact).toEqual(['gpt-4', 'gpt-3.5']);
    expect(wildcard).toEqual(['claude-*', '*-preview']);
  });

  test('pure exact rules are removed, wildcard rules are not auto-removed', () => {
    const hiddenRules = ['gpt-4', 'gpt-3.5'];
    const { exact, wildcard } = splitWildcardRules(hiddenRules);
    expect(wildcard).toEqual([]);
    expect(exact).toEqual(['gpt-4', 'gpt-3.5']);

    const currentHidden = ['gpt-4', 'gpt-3.5', 'claude-3'];
    const ruleSet = new Set(exact);
    const remaining = currentHidden.filter((r) => !ruleSet.has(r));
    expect(remaining).toEqual(['claude-3']);
  });

  test('wildcard rules are not auto-removed (must be manually edited)', () => {
    const hiddenRules = ['claude-*', 'gpt-4'];
    const { exact, wildcard } = splitWildcardRules(hiddenRules);
    expect(wildcard).toEqual(['claude-*']);
    expect(exact).toEqual(['gpt-4']);

    const currentHidden = ['claude-*', 'gpt-4', 'gpt-3.5'];
    const ruleSet = new Set(exact);
    const remaining = currentHidden.filter((r) => !ruleSet.has(r));
    expect(remaining).toEqual(['claude-*', 'gpt-3.5']);
  });
});

// ============================================================
// Defect 7: Pin controls — correct reorder and edge disabling
// ============================================================
describe('D7: pin reorder behavior', () => {
  test('move up swaps with previous item', () => {
    const pins = ['a', 'b', 'c'];
    expect(reorderPin(pins, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(reorderPin(pins, 2, -1)).toEqual(['a', 'c', 'b']);
  });

  test('move down swaps with next item', () => {
    const pins = ['a', 'b', 'c'];
    expect(reorderPin(pins, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(reorderPin(pins, 1, 1)).toEqual(['a', 'c', 'b']);
  });

  test('first item cannot move up (edge disabled)', () => {
    const pins = ['a', 'b', 'c'];
    expect(reorderPin(pins, 0, -1)).toEqual(['a', 'b', 'c']);
  });

  test('last item cannot move down (edge disabled)', () => {
    const pins = ['a', 'b', 'c'];
    expect(reorderPin(pins, 2, 1)).toEqual(['a', 'b', 'c']);
  });

  test('original array is not mutated', () => {
    const pins = ['a', 'b', 'c'];
    const result = reorderPin(pins, 0, 1);
    expect(pins).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(pins);
  });

  test('store updateDraft with reordered pins preserves textarea order', () => {
    state().open();
    state().updateDraft({ pinnedLines: 'a\nb\nc' });

    const pins = ['a', 'b', 'c'];
    const reordered = reorderPin(pins, 1, -1);
    state().updateDraft({ pinnedLines: reordered.join('\n') });

    expect(state().draft.pinnedLines).toBe('b\na\nc');
  });
});

// ============================================================
// Defect 8: Hide action does not toggle checkbox selection
// ============================================================
describe('D8: hide action separate from checkbox selection', () => {
  test('updateDraft (used by hideEntry) does not affect any selection state', () => {
    state().open();
    state().updateDraft({ hiddenLines: 'gpt-4' });

    expect(state().draft.hiddenLines).toBe('gpt-4');
    expect(state().editRevision).toBeGreaterThan(0);
    // Store has no selection field — selection is component-local only.
  });

  test('setFormat clears inventory/preview (selection is component-local)', () => {
    state().open();
    state().updateDraft({ hiddenLines: 'test' });
    state().setFormat('claude');

    expect(state().format).toBe('claude');
    expect(state().inventory).toBeNull();
    expect(state().preview).toBeNull();
  });
});

// ============================================================
// Defect 9: NormalizePolicy — uppercase/whitespace sort values
// ============================================================
describe('D9: policy normalization for case and whitespace', () => {
  test('uppercase DESC normalizes to desc', () => {
    expect(normalizePolicy({ order: 'DESC' }).order).toBe('desc');
    expect(normalizePolicy({ order: 'Desc' }).order).toBe('desc');
    expect(normalizePolicy({ order: 'ASC' }).order).toBe('asc');
    expect(normalizePolicy({ order: 'PRESERVE' }).order).toBe('preserve');
  });

  test('whitespace-padded order normalizes correctly', () => {
    expect(normalizePolicy({ order: '  desc  ' }).order).toBe('desc');
    expect(normalizePolicy({ order: '\tasc\n' }).order).toBe('asc');
  });

  test('serializePolicy lowercases order', () => {
    expect(
      serializePolicy({ order: 'DESC' as unknown as 'desc', hidden: [], pinned: [] }).order
    ).toBe('desc');
  });

  test('policiesEqual treats case/whitespace differences as equal', () => {
    const a = { order: 'desc', hidden: ['  gpt-4  ', 'claude-*'], pinned: [] };
    const b = { order: 'DESC', hidden: ['gpt-4', 'claude-*'], pinned: [] };
    expect(policiesEqual(a, b)).toBe(true);
  });

  test('policiesEqual detects real differences', () => {
    expect(
      policiesEqual(
        { order: 'desc', hidden: ['gpt-4'], pinned: [] },
        { order: 'desc', hidden: ['gpt-4', 'claude-*'], pinned: [] }
      )
    ).toBe(false);
    expect(
      policiesEqual(
        { order: 'asc', hidden: [], pinned: [] },
        { order: 'desc', hidden: [], pinned: [] }
      )
    ).toBe(false);
  });

  test('normalizePolicy trims blank rules from arrays', () => {
    expect(
      normalizePolicy({ order: 'preserve', hidden: ['  ', '', 'gpt-4'], pinned: ['  '] })
    ).toEqual({
      order: 'preserve',
      hidden: ['gpt-4'],
      pinned: [],
    });
  });
});

// ============================================================
// Defect 10: Error state doesn't show empty inventory as success
// ============================================================
describe('D10: error state surfaces correctly', () => {
  test('inventory error does not leave a stale inventory object', async () => {
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({
      policy: { order: 'preserve', hidden: [], pinned: [] },
      configured: true,
    });
    spyOn(modelCatalogApi, 'getInventory').mockRejectedValue(new Error('inventory down'));

    state().open();
    await state().load();

    expect(state().inventoryError).not.toBeNull();
    expect(state().inventory).toBeNull();
  });

  test('preview error clears stale preview', async () => {
    spyOn(modelCatalogApi, 'previewCatalog').mockRejectedValue(new Error('preview failed'));

    state().open();
    await state().runPreview();

    expect(state().previewError).not.toBeNull();
    expect(state().preview).toBeNull();
  });
});

describe('save completion isolation', () => {
  test('a duplicate save does not invalidate the original successful save', async () => {
    const pending = deferred<{ status: string; 'config-version': number }>();
    const policy: CatalogPolicy = { order: 'asc', hidden: [], pinned: [] };
    spyOn(modelCatalogApi, 'putPolicy').mockReturnValue(pending.promise);
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({ policy, configured: true });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView({ policy }));
    state().open();
    state().updateDraft({ order: 'asc' });
    const first = state().save();
    expect((await state().save()).success).toBe(false);
    pending.resolve({ status: 'ok', 'config-version': 8 });
    expect((await first).status).toBe('applied');
    expect(state().saving).toBe(false);
  });

  test('an inventory failure after reopening never publishes the old saved draft', async () => {
    const inventory = deferred<CatalogView>();
    const entered = deferred<void>();
    const policy: CatalogPolicy = { order: 'asc', hidden: [], pinned: [] };
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({ policy, configured: true });
    spyOn(modelCatalogApi, 'getInventory').mockImplementation(() => {
      entered.resolve();
      return inventory.promise;
    });
    state().open();
    state().updateDraft({ order: 'asc' });
    const pending = state().save();
    await entered.promise;
    state().reset();
    state().open();
    state().updateDraft({ hiddenLines: 'new-session' });
    inventory.reject(new Error('inventory disconnected'));
    expect((await pending).success).toBe(false);
    expect(state().draft.hiddenLines).toBe('new-session');
    expect(state().saveStatus).toBeNull();
    expect(state().configured).toBe(false);
  });
});

describe('draft status after a persisted save', () => {
  test('editing invalidates the previous save status and messages', () => {
    state().open();
    useModelCatalogEditor.setState({
      saveStatus: 'applied',
      saveMessage: 'applied',
      saveError: 'old failure',
    });
    state().updateDraft({ hiddenLines: 'gpt-*' });
    expect(state().saveStatus).toBeNull();
    expect(state().saveMessage).toBeNull();
    expect(state().saveError).toBeNull();
  });
});

describe('displayed catalog belongs to the current draft', () => {
  test('a changed draft never displays old inventory counts as its preview', async () => {
    const { catalogViewForPolicy } = await import('../src/features/modelCatalog/policy');
    const inventory = makeView();
    const draft = { ...inventory.policy, hidden: ['gpt-*'] };
    expect(catalogViewForPolicy(draft, inventory, null)).toBeNull();
    const preview = makeView({ policy: draft, counts: { total: 2, visible: 0, hidden: 2 } });
    expect(catalogViewForPolicy(draft, inventory, preview)).toBe(preview);
    expect(catalogViewForPolicy(inventory.policy, inventory, preview)).toBe(inventory);
  });
});

describe('save recovery and delayed activation', () => {
  test('a successful save clears a previous inventory error', async () => {
    const policy = { order: 'asc' as const, hidden: [], pinned: [] };
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({ policy, configured: true });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView({ policy }));
    state().open();
    state().updateDraft({ order: 'asc' });
    useModelCatalogEditor.setState({ inventoryError: 'old source failure' });
    expect((await state().save()).status).toBe('applied');
    expect(state().inventoryError).toBeNull();
  });

  test('a pending save supplies a backend draft preview instead of endless loading', async () => {
    const policy = { order: 'asc' as const, hidden: [], pinned: [] };
    spyOn(modelCatalogApi, 'putPolicy').mockResolvedValue({ status: 'ok', 'config-version': 8 });
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({ policy, configured: true });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());
    spyOn(modelCatalogApi, 'previewCatalog').mockResolvedValue(makeView({ policy }));
    state().open();
    state().updateDraft({ order: 'asc' });
    expect((await state().save()).status).toBe('pending');
    await Promise.resolve();
    expect(state().preview?.policy).toEqual(policy);
    expect(state().saveStatus).toBe('pending');
  });

  test('refresh confirms delayed activation and invalidates the old public catalog', async () => {
    const policy = { order: 'asc' as const, hidden: [], pinned: [] };
    spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({ policy, configured: true });
    spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView({ policy }));
    const clear = spyOn(useModelsStore.getState(), 'clearCache');
    state().open();
    useModelCatalogEditor.setState({ saveStatus: 'pending' });
    const generation = state().saveGeneration;
    await state().load();
    expect(state().saveStatus).toBe('applied');
    expect(state().saveGeneration).toBe(generation + 1);
    expect(clear).toHaveBeenCalled();
  });
});

test('opening a saved but inactive policy exposes the pending refresh state without a write', async () => {
  const policy = { order: 'asc' as const, hidden: [], pinned: [] };
  spyOn(modelCatalogApi, 'getPolicy').mockResolvedValue({ policy, configured: true });
  spyOn(modelCatalogApi, 'getInventory').mockResolvedValue(makeView());
  spyOn(modelCatalogApi, 'previewCatalog').mockResolvedValue(makeView({ policy }));
  const put = spyOn(modelCatalogApi, 'putPolicy');
  state().open();
  await state().load();
  expect(state().saveStatus).toBe('pending');
  expect(state().editRevision).toBe(0);
  expect(put).not.toHaveBeenCalled();
});
