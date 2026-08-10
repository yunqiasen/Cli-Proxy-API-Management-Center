import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisibleProviderGroups } from '../src/features/providers/providerGroupVisibility.ts';

const groups = [
  { id: 'gemini' },
  { id: 'lmuAI' },
  { id: 'infistar' },
  { id: 'image' },
  { id: 'video' },
  { id: 'audio' },
  { id: 'apikeyFun' },
];

test('keeps media providers out of the general AI provider category list', () => {
  assert.deepEqual(
    getVisibleProviderGroups(groups),
    [{ id: 'gemini' }, { id: 'lmuAI' }, { id: 'infistar' }]
  );
});

test('keeps a fixed media provider route isolated and visible', () => {
  assert.deepEqual(getVisibleProviderGroups(groups, 'image'), [{ id: 'image' }]);
  assert.deepEqual(getVisibleProviderGroups(groups, 'video'), [{ id: 'video' }]);
  assert.deepEqual(getVisibleProviderGroups(groups, 'audio'), [{ id: 'audio' }]);
});
