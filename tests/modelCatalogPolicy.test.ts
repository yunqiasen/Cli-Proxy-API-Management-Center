import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CATALOG_POLICY,
  normalizePolicy,
  serializePolicy,
  parsePatternLines,
  formatPatternLines,
  isWildcard,
} from '../src/features/modelCatalog/policy';

describe('catalog policy normalization', () => {
  test('undefined input yields default preserve/empty policy', () => {
    expect(normalizePolicy(undefined)).toEqual({
      order: 'preserve',
      hidden: [],
      pinned: [],
    });
    expect(DEFAULT_CATALOG_POLICY).toEqual({
      order: 'preserve',
      hidden: [],
      pinned: [],
    });
  });

  test('omitted fields are filled with defaults', () => {
    expect(normalizePolicy({})).toEqual({
      order: 'preserve',
      hidden: [],
      pinned: [],
    });
  });

  test('preserves explicit order and arrays', () => {
    expect(normalizePolicy({ order: 'asc', hidden: ['gpt-4'], pinned: ['claude-*'] })).toEqual({
      order: 'asc',
      hidden: ['gpt-4'],
      pinned: ['claude-*'],
    });
  });

  test('invalid order falls back to preserve', () => {
    expect(normalizePolicy({ order: 'random' }).order).toBe('preserve');
    expect(normalizePolicy({ order: 42 }).order).toBe('preserve');
    expect(normalizePolicy({ order: null }).order).toBe('preserve');
  });

  test('non-array hidden/pinned become empty arrays', () => {
    expect(normalizePolicy({ hidden: 'gpt-4', pinned: 3 })).toEqual({
      order: 'preserve',
      hidden: [],
      pinned: [],
    });
  });

  test('non-string entries in arrays are filtered out', () => {
    expect(normalizePolicy({ hidden: ['a', 1, null, 'b'], pinned: [true, 'c'] })).toEqual({
      order: 'preserve',
      hidden: ['a', 'b'],
      pinned: ['c'],
    });
  });
});

describe('catalog policy serialization', () => {
  test('produces a clean wire payload with trimmed entries', () => {
    expect(
      serializePolicy({
        order: 'desc',
        hidden: ['  gpt-4  ', '', 'claude-*'],
        pinned: ['claude-3', '  '],
      })
    ).toEqual({
      order: 'desc',
      hidden: ['gpt-4', 'claude-*'],
      pinned: ['claude-3'],
    });
  });

  test('preserves empty arrays (never null)', () => {
    expect(serializePolicy({ order: 'preserve', hidden: [], pinned: [] })).toEqual({
      order: 'preserve',
      hidden: [],
      pinned: [],
    });
  });

  test('deduplicates while preserving first-occurrence order', () => {
    expect(
      serializePolicy({
        order: 'preserve',
        hidden: ['a', 'b', 'a'],
        pinned: ['x', 'x', 'y'],
      })
    ).toEqual({
      order: 'preserve',
      hidden: ['a', 'b'],
      pinned: ['x', 'y'],
    });
  });
});

describe('pattern line parsing', () => {
  test('splits newline-separated patterns and trims whitespace', () => {
    expect(parsePatternLines('gpt-4\n\nclaude-*\n  grok  ')).toEqual(['gpt-4', 'claude-*', 'grok']);
  });

  test('empty string yields empty array', () => {
    expect(parsePatternLines('')).toEqual([]);
    expect(parsePatternLines('   \n  \n')).toEqual([]);
  });

  test('handles CRLF and mixed line endings', () => {
    expect(parsePatternLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });

  test('formatPatternLines joins back with newlines', () => {
    expect(formatPatternLines(['gpt-4', 'claude-*'])).toBe('gpt-4\nclaude-*');
    expect(formatPatternLines([])).toBe('');
  });
});

describe('wildcard detection', () => {
  test('identifies star wildcards', () => {
    expect(isWildcard('*')).toBe(true);
    expect(isWildcard('gpt-*')).toBe(true);
    expect(isWildcard('*-preview')).toBe(true);
    expect(isWildcard('gpt-4')).toBe(false);
    expect(isWildcard('')).toBe(false);
  });
});
