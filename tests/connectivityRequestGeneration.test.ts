import { describe, expect, test } from 'bun:test';
import { createRequestGeneration } from '@/features/providers/requestGeneration';

describe('createRequestGeneration', () => {
  test('keeps concurrent work in one form generation and invalidates it after edits', () => {
    const generation = createRequestGeneration();
    const first = generation.begin();
    const second = generation.begin();

    expect(generation.isCurrent(first)).toBe(true);
    expect(generation.isCurrent(second)).toBe(true);
    expect(generation.invalidate()).toBe(1);
    expect(generation.isCurrent(first)).toBe(false);
    expect(generation.isCurrent(second)).toBe(false);
    expect(generation.isCurrent(generation.begin())).toBe(true);
  });
});

import { createResourceLeaseRegistry } from '@/features/providers/requestGeneration';

test('a stale probe completion cannot release a newer resource lease', () => {
  const leases = createResourceLeaseRegistry();
  const first = leases.acquire('provider-a');
  leases.clear();
  const second = leases.acquire('provider-a');

  expect(leases.release('provider-a', first)).toBe(false);
  expect(leases.has('provider-a')).toBe(true);
  expect(leases.release('provider-a', second)).toBe(true);
  expect(leases.has('provider-a')).toBe(false);
});
