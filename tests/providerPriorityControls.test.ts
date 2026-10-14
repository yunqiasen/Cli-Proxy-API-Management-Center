import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { BaseProviderForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import { ApiKeyEntriesEditor } from '@/features/providers/sheets/forms/ApiKeyEntriesEditor';
import en from '@/i18n/locales/en.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

const render = (component: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, component));

const numericInputs = (html: string) => html.match(/<input\b[^>]*type="number"[^>]*>/g) ?? [];

describe('provider priority controls remain editable alongside weight', () => {
  for (const brand of ['codex', 'gemini', 'claude'] as const) {
    test(`${brand} create form exposes per-key priority alongside weight`, () => {
      const html = render(
        createElement(BaseProviderForm, {
          brand,
          resource: null,
          mode: 'create',
          mutating: false,
          formId: 'priority-form',
          onSubmit: async () => {},
        })
      );
      // The only blank key starts expanded; this exercises the actual caller's props.
      expect(html.includes(i18n.t('providersPage.form.keyPriority'))).toBe(true);
      expect(html.includes(i18n.t('providersPage.form.weight'))).toBe(true);
    });
  }

  test('expanded supported key exposes priority 9 and weight 1 as separate inputs', () => {
    const html = render(
      createElement(ApiKeyEntriesEditor, {
        entries: [{ apiKey: '', proxyUrl: '', priority: 9, weight: 1 }],
        showPriority: true,
        removeDisabled: true,
        mutating: false,
        statuses: [],
        isTestingAny: false,
        onUpdate: () => {},
        onAdd: () => 0,
        onRemove: () => {},
        onTest: () => {},
        onTestAll: () => {},
      })
    );
    expect(html.includes(i18n.t('providersPage.form.keyPriority') + ': 9')).toBe(true);
    expect(numericInputs(html).some((input) => /\bvalue="9"/.test(input))).toBe(true);
    expect(numericInputs(html).some((input) => /\bvalue="1"/.test(input))).toBe(true);
  });

  test('OpenAI compatibility keeps only provider-level priority supported by its API', () => {
    const html = render(
      createElement(BaseProviderForm, {
        brand: 'openaiCompatibility',
        resource: null,
        mode: 'create',
        mutating: false,
        formId: 'priority-form',
        onSubmit: async () => {},
      })
    );
    expect(html.includes(i18n.t('providersPage.form.keyPriority'))).toBe(false);
    expect(html.includes(i18n.t('providersPage.form.priority'))).toBe(true);
    expect(html.includes(i18n.t('providersPage.form.weight'))).toBe(true);
  });

  for (const brand of ['openaiCompatibility', 'codex', 'gemini', 'claude'] as const) {
    test(`${brand} retains saved provider-level priority`, () => {
      const html = render(
        createElement(BaseProviderForm, {
          brand,
          resource: {
            raw: {
              name: 'priority-fixture',
              apiKey: 'fixture-key',
              baseUrl: 'https://fixture.invalid/v1',
              priority: 6,
              weight: 1,
              apiKeyEntries: [{ apiKey: 'fixture-key', priority: 9, weight: 1 }],
            },
          } as never,
          mode: 'edit',
          mutating: false,
          formId: 'priority-form',
          onSubmit: async () => {},
        })
      );
      expect(numericInputs(html).some((input) => /\bvalue="6"/.test(input))).toBe(true);
    });
  }
});
