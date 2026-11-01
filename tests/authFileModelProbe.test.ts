import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(
  new URL('../src/services/api/authFiles.ts', import.meta.url),
  'utf8'
);
const modalSource = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileModelsModal.tsx', import.meta.url),
  'utf8'
);
const hookSource = readFileSync(
  new URL('../src/features/authFiles/hooks/useAuthFilesModels.ts', import.meta.url),
  'utf8'
);

describe('auth file model probe contract', () => {
  test('posts the clicked credential and model to the pinned probe endpoint', () => {
    expect(apiSource).toContain('probeAuthFileModel');
    expect(apiSource).toContain('/credentials/models/probe');
    expect(apiSource).toContain('auth_index');
    expect(apiSource).toContain('name,');
    expect(apiSource).toContain('model,');
  });

  test('the models modal offers a per-model test action', () => {
    expect(modalSource).toContain('onProbeModel');
    expect(modalSource).toContain("t('auth_files.models_probe_button'");
    expect(modalSource).toContain('models_probe_ok');
    expect(modalSource).toContain('models_probe_fail');
  });

  test('probe state is tracked per model id', () => {
    expect(hookSource).toContain('probeModel');
    expect(hookSource).toContain('probeResults');
    expect(hookSource).toContain('probeAuthFileModel');
  });

  test('localized labels exist for every locale', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
      const { auth_files: messages } = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ) as { auth_files: Record<string, string> };
      expect(messages.models_probe_button).toBeTruthy();
      expect(messages.models_probe_ok).toBeTruthy();
      expect(messages.models_probe_fail).toBeTruthy();
      expect(messages.models_probe_running).toBeTruthy();
    }
  });
});
