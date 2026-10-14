import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { providersApi } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import {
  buildNativeProviderConfig,
  buildNativeProviderDraft,
  buildNativeProviderFormInput,
} from '@/features/providers/nativeProviderForm';
import type { ProviderKeyConfig } from '@/types';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

const families = ['codex', 'gemini', 'claude'] as const;
const update = {
  codex: providersApi.updateCodexConfig,
  gemini: providersApi.updateGeminiKey,
  claude: providersApi.updateClaudeConfig,
};

for (const brand of families) {
  describe(`${brand} priority and weight V8 round trip`, () => {
    for (const priority of [12, 0, -3, undefined]) {
      test(`editing key 10 priority to ${String(priority)} preserves weights and sibling keys`, async () => {
        let groups: Record<string, unknown>[] = [
          {
            name: 'priority-fixture',
            priority: 6,
            'base-url': 'https://fixture.invalid/v1',
            'future-group-field': 'preserved',
            keys: [
              {
                name: 'priority-fixture',
                'api-key': '',
                'future-row-field': 'preserved',
                'api-key-entries': Array.from({ length: 10 }, (_, index) => ({
                  'api-key': `fixture-key-${index + 1}`,
                  priority: 9,
                  weight: 1,
                })),
              },
            ],
          },
        ];
        const initial = structuredClone(groups);
        apiClient.get = (async (url: string) => {
          expect(url).toBe('/config');
          return { 'api-keys': { [brand]: structuredClone(groups) } };
        }) as typeof apiClient.get;
        apiClient.put = (async (url: string, body: unknown) => {
          expect(url).toBe(`/config/api-keys/${brand}`);
          groups = structuredClone(body as Record<string, unknown>[]);
        }) as typeof apiClient.put;
        const [existing] = normalizeProviderGroups(groups) as ProviderKeyConfig[];
        const form = buildNativeProviderFormInput(brand, existing);
        expect(form.priority).toBe(6);
        expect(form.apiKeyEntries?.[9].priority).toBe(9);
        form.apiKeyEntries![9].priority = priority;
        const saved = buildNativeProviderConfig(brand, form, existing);
        expect(buildNativeProviderDraft(brand, form, existing)).toEqual(saved);
        await update[brand](existing.apiKey, existing.baseUrl, saved);
        const keys = groups[0].keys as Record<string, unknown>[];
        const entries = keys[0]['api-key-entries'] as Record<string, unknown>[];
        expect(entries[9].priority).toBe(priority);
        expect(Object.hasOwn(entries[9], 'priority')).toBe(priority !== undefined);
        expect(entries[9].weight).toBe(1);
        expect(entries[9]['api-key']).toBe('fixture-key-10');
        const initialKeys = initial[0].keys as Record<string, unknown>[];
        expect(entries.slice(0, 9)).toEqual(
          (initialKeys[0]['api-key-entries'] as unknown[]).slice(0, 9)
        );
        expect(groups[0].priority).toBe(6);
        expect(groups[0]['future-group-field']).toBe('preserved');
        expect(keys[0]['future-row-field']).toBe('preserved');
        const [reloaded] = normalizeProviderGroups(groups) as ProviderKeyConfig[];
        const reopened = buildNativeProviderFormInput(brand, reloaded);
        expect(reopened.apiKeyEntries?.[9].priority).toBe(priority);
        expect(reopened.apiKeyEntries?.[9].weight).toBe(1);
        expect(reopened.priority).toBe(6);
      });
    }
  });
}
