import { afterEach, describe, expect, test, spyOn } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { modelCatalogApi } from '../src/services/api/modelCatalog';
import { DEFAULT_CATALOG_POLICY } from '../src/features/modelCatalog/policy';
import type { CatalogView } from '../src/features/modelCatalog/types';

const notFoundError = Object.assign(new Error('not found'), {
  status: 404,
  apiCode: 'not_found',
  name: 'ApiError',
});

const makeView = (overrides: Partial<CatalogView> = {}): CatalogView => ({
  format: 'openai',
  policy: { ...DEFAULT_CATALOG_POLICY },
  entries: [],
  visible_ids: [],
  counts: { total: 0, visible: 0, hidden: 0 },
  model_sort_enabled: false,
  ...overrides,
});

describe('modelCatalogApi.getPolicy', () => {
  const originalGet = apiClient.get;

  afterEach(() => {
    apiClient.get = originalGet;
  });

  test('returns normalized policy when configured', async () => {
    const spy = spyOn(apiClient, 'get').mockResolvedValue({
      order: 'asc',
      hidden: ['gpt-4'],
      pinned: ['claude-*'],
    });
    const result = await modelCatalogApi.getPolicy();
    expect(spy).toHaveBeenCalledWith('/config/client/model-catalog');
    expect(result.configured).toBe(true);
    expect(result.policy).toEqual({ order: 'asc', hidden: ['gpt-4'], pinned: ['claude-*'] });
  });

  test('returns default policy and configured=false on 404', async () => {
    spyOn(apiClient, 'get').mockRejectedValue(notFoundError);
    const result = await modelCatalogApi.getPolicy();
    expect(result.configured).toBe(false);
    expect(result.policy).toEqual(DEFAULT_CATALOG_POLICY);
  });

  test('rethrows non-404 errors', async () => {
    const serverError = Object.assign(new Error('server error'), {
      status: 500,
      name: 'ApiError',
    });
    spyOn(apiClient, 'get').mockRejectedValue(serverError);
    await expect(modelCatalogApi.getPolicy()).rejects.toThrow('server error');
  });
});

describe('modelCatalogApi.putPolicy', () => {
  const originalPut = apiClient.put;

  afterEach(() => {
    apiClient.put = originalPut;
  });

  test('serializes and sends the entire policy to the config group', async () => {
    const spy = spyOn(apiClient, 'put').mockResolvedValue({
      status: 'ok',
      'config-version': 8,
    });
    const result = await modelCatalogApi.putPolicy({
      order: 'desc',
      hidden: ['  gpt-4  ', '', 'claude-*'],
      pinned: ['claude-3'],
    });
    expect(spy).toHaveBeenCalledWith('/config/client/model-catalog', {
      order: 'desc',
      hidden: ['gpt-4', 'claude-*'],
      pinned: ['claude-3'],
    });
    expect(result).toEqual({ status: 'ok', 'config-version': 8 });
  });
});

describe('modelCatalogApi.getInventory', () => {
  const originalGet = apiClient.get;

  afterEach(() => {
    apiClient.get = originalGet;
  });

  test('calls /models/catalog with default openai format', async () => {
    const view = makeView();
    const spy = spyOn(apiClient, 'get').mockResolvedValue(view);
    const result = await modelCatalogApi.getInventory('openai');
    expect(spy).toHaveBeenCalledWith('/models/catalog', { params: { format: 'openai' } });
    expect(result).toEqual(view);
  });

  test('passes the format query parameter for each supported format', async () => {
    const spy = spyOn(apiClient, 'get').mockResolvedValue(makeView());
    for (const format of ['claude', 'gemini', 'codex', 'grok'] as const) {
      await modelCatalogApi.getInventory(format);
    }
    expect(spy).toHaveBeenCalledTimes(4);
  });
});

describe('modelCatalogApi.previewCatalog', () => {
  const originalPost = apiClient.post;

  afterEach(() => {
    apiClient.post = originalPost;
  });

  test('posts format and serialized policy to the preview endpoint', async () => {
    const view = makeView({ format: 'claude' });
    const spy = spyOn(apiClient, 'post').mockResolvedValue(view);
    const result = await modelCatalogApi.previewCatalog('claude', {
      order: 'asc',
      hidden: ['gpt-4'],
      pinned: ['claude-*'],
    });
    expect(spy).toHaveBeenCalledWith('/models/catalog/preview', {
      format: 'claude',
      policy: { order: 'asc', hidden: ['gpt-4'], pinned: ['claude-*'] },
    });
    expect(result).toEqual(view);
  });
});
