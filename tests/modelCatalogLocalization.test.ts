import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

const MODEL_CATALOG_KEYS = [
  'title',
  'manage_display',
  'format_label',
  'order_label',
  'order_preserve',
  'order_asc',
  'order_desc',
  'format_openai',
  'format_claude',
  'format_gemini',
  'format_codex',
  'format_grok',
  'filter_label',
  'filter_visible',
  'filter_hidden',
  'filter_all',
  'search_placeholder',
  'hide_selected',
  'hide',
  'restore',
  'hidden',
  'pinned',
  'hidden_by',
  'no_entries',
  'hidden_rules_label',
  'pinned_rules_label',
  'pattern_hint',
  'pinned_hint',
  'move_up',
  'move_down',
  'preview_title',
  'count_total',
  'count_visible',
  'count_hidden',
  'visible_order',
  'overlap_notice',
  'saved_policy_active',
  'inventory_error',
  'save_status_applied',
  'save_status_pending',
  'save_status_error',
  'wildcard_restore_hint',
  'no_inventory_error',
];

function resolveKey(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key];
    return undefined;
  }, root);
}

describe('model catalog localization', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    test(`${locale} has all model_catalog keys`, async () => {
      const messages: unknown = await Bun.file(`src/i18n/locales/${locale}.json`).json();
      for (const key of MODEL_CATALOG_KEYS) {
        const value = resolveKey(messages, `model_catalog.${key}`);
        expect(value).toBeString();
        expect(String(value).trim().length).toBeGreaterThan(0);
      }
    });
  }

  test('all four locales have the same key set', async () => {
    const locales = await Promise.all(
      ['en', 'zh-CN', 'zh-TW', 'ru'].map(async (loc) => {
        const messages: unknown = await Bun.file(`src/i18n/locales/${loc}.json`).json();
        const keys = Object.keys(
          (resolveKey(messages, 'model_catalog') ?? {}) as Record<string, unknown>
        );
        return { loc, keys: new Set(keys) };
      })
    );
    for (let i = 1; i < locales.length; i++) {
      for (const key of locales[0].keys) {
        expect(locales[i].keys.has(key)).toBe(true);
      }
      for (const key of locales[i].keys) {
        expect(locales[0].keys.has(key)).toBe(true);
      }
    }
  });
});

describe('model catalog editor static markup', () => {
  test('ManageDisplayButton renders translated accessible label', async () => {
    const { ManageDisplayButton } =
      await import('@/features/modelCatalog/components/ModelCatalogEditor');
    const translations = i18n.cloneInstance({ lng: 'en' });
    const markup = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: translations }, createElement(ManageDisplayButton))
    );
    expect(markup).toContain('Manage Display');
    expect(markup).toContain('<button');
  });

  test('ManageDisplayButton renders in zh-CN', async () => {
    const { ManageDisplayButton } =
      await import('@/features/modelCatalog/components/ModelCatalogEditor');
    const translations = i18n.cloneInstance({ lng: 'zh-CN' });
    const markup = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: translations }, createElement(ManageDisplayButton))
    );
    expect(markup).toContain('管理展示');
  });
});

test('Chinese entry label matches the approved Center Info workflow', async () => {
  const messages = await Bun.file('src/i18n/locales/zh-CN.json').json();
  expect(messages.model_catalog.manage_display).toBe('管理展示');
});
