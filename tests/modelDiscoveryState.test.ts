import { describe, expect, test } from 'bun:test';
import {
  createModelDiscoveryInputSignature,
  createModelDiscoveryRequestGuard,
} from '../src/features/providers/sheets/forms/useModelDiscovery';
import {
  mergeDiscoveredMediaModels,
  modelDiscoveryResultSignature,
  reconcileModelDiscoverySelection,
} from '../src/features/providers/mediaProviderModelDiscovery';

describe('model discovery request state', () => {
  test('rejects a response when inputs change before the reset effect invalidates its request id', () => {
    const guard = createModelDiscoveryRequestGuard();
    const first = guard.begin('image||https://old.example/v1||old-key');

    expect(guard.isCurrent(first)).toBe(true);
    guard.updateSignature('image||https://new.example/v1||new-key');
    expect(guard.isCurrent(first)).toBe(false);
  });

  test('includes every request-affecting input in the signature', () => {
    const first = createModelDiscoveryInputSignature({
      brand: 'image',
      baseUrl: 'https://media.example/v1',
      formHeaders: [{ key: 'X-Tenant', value: 'one' }],
      apiKeyEntries: [{ apiKey: 'key-a', proxyUrl: '', authIndex: 'auth-a' }],
      apiKeyHeader: 'X-API-Key',
      apiKeyPrefix: '-',
    });
    const second = createModelDiscoveryInputSignature({
      brand: 'image',
      baseUrl: 'https://media.example/v1',
      formHeaders: [{ key: 'X-Tenant', value: 'two' }],
      apiKeyEntries: [{ apiKey: 'key-a', proxyUrl: '', authIndex: 'auth-a' }],
      apiKeyHeader: 'X-API-Key',
      apiKeyPrefix: '-',
    });

    expect(first).not.toBe(second);
  });

  test('rejects an older request when a newer request starts with the same inputs', () => {
    const guard = createModelDiscoveryRequestGuard();
    const signature = 'image||https://media.example/v1||key';
    const first = guard.begin(signature);
    const second = guard.begin(signature);

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  test('clears selected models when the result signature changes', () => {
    const previousModels = [{ name: 'image-v1' }, { name: 'image-v2', alias: 'Image V2' }];
    const nextModels = [{ name: 'image-v3' }];
    const selected = new Set(['image-v2']);

    expect(
      reconcileModelDiscoverySelection(
        selected,
        modelDiscoveryResultSignature(previousModels),
        modelDiscoveryResultSignature(nextModels)
      )
    ).toEqual(new Set());
  });

  test('retains selected models when a rerender preserves the same result signature', () => {
    const selected = new Set(['image-v2']);
    const signature = modelDiscoveryResultSignature([
      { name: 'image-v1' },
      { name: 'image-v2', alias: 'Image V2' },
    ]);

    expect(reconcileModelDiscoverySelection(selected, signature, signature)).toBe(selected);
  });
});

describe('media discovery merge conflicts', () => {
  test('preserves every existing row and filters incoming name and alias conflicts case-insensitively', () => {
    const existing = [
      { name: 'shared-upstream', alias: 'public-generate', capabilities: ['generate'] },
      { name: 'shared-upstream', alias: 'public-edit', capabilities: ['edit'] },
      { name: 'legacy-upstream', alias: 'Legacy-Public', capabilities: ['upscale'] },
    ];

    const merged = mergeDiscoveredMediaModels(existing, [
      { name: 'SHARED-UPSTREAM' },
      { name: 'PUBLIC-GENERATE' },
      { name: 'new-name', alias: 'legacy-public' },
      { name: 'new-upstream', alias: 'PUBLIC-EDIT' },
      { name: 'fresh-upstream', alias: 'fresh-public' },
    ]);

    expect(merged).toEqual([
      ...existing,
      { name: 'fresh-upstream', alias: 'fresh-public', capabilities: [] },
    ]);
  });

  test('filters conflicts introduced by earlier incoming rows in both name and alias directions', () => {
    expect(
      mergeDiscoveredMediaModels([], [
        { name: 'first-name', alias: 'first-public' },
        { name: 'FIRST-PUBLIC', alias: 'second-public' },
        { name: 'second-name', alias: 'FIRST-NAME' },
        { name: 'unique-name', alias: 'unique-public' },
      ])
    ).toEqual([
      { name: 'first-name', alias: 'first-public', capabilities: [] },
      { name: 'unique-name', alias: 'unique-public', capabilities: [] },
    ]);
  });
});
