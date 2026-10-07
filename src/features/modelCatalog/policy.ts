/**
 * Catalog display policy normalization and serialization.
 *
 * The policy is a small grouped config under `client.model-catalog`:
 *   order: 'preserve' | 'asc' | 'desc'  (default 'preserve')
 *   hidden: string[]                     (default [])
 *   pinned: string[]                     (default [])
 *
 * Omitted fields on GET are filled with defaults before the UI sees them.
 * Serialization trims whitespace, removes blanks, and deduplicates while
 * preserving first-occurrence order.
 *
 * Normalization mirrors the backend: order values are case-insensitive
 * (raw YAML may persist `DESC` or `Desc`), and pattern entries are trimmed.
 */

import type { CatalogPolicy, CatalogOrder, CatalogView } from './types';

export const DEFAULT_CATALOG_POLICY: CatalogPolicy = {
  order: 'preserve',
  hidden: [],
  pinned: [],
};

const VALID_ORDERS: readonly CatalogOrder[] = ['preserve', 'asc', 'desc'];

const normalizeOrder = (value: unknown): CatalogOrder => {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if ((VALID_ORDERS as readonly string[]).includes(lower)) {
      return lower as CatalogOrder;
    }
  }
  return 'preserve';
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

/** Fill omitted/invalid fields with defaults. Non-mutating. */
export function normalizePolicy(raw: unknown): CatalogPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_CATALOG_POLICY };
  }
  const record = raw as Record<string, unknown>;
  return {
    order: normalizeOrder(record.order),
    hidden: normalizeStringArray(record.hidden),
    pinned: normalizeStringArray(record.pinned),
  };
}

const dedupePreservingOrder = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
};

/** Clean a draft policy for wire transmission: trim, drop blanks, deduplicate. */
export function serializePolicy(policy: CatalogPolicy): CatalogPolicy {
  const cleanStrings = (arr: string[]): string[] =>
    dedupePreservingOrder(arr.map((s) => s.trim()).filter((s) => s.length > 0));
  return {
    order: normalizeOrder(policy.order),
    hidden: cleanStrings(policy.hidden),
    pinned: cleanStrings(policy.pinned),
  };
}

/**
 * Structural equality on normalized policies.  Used for save readback
 * verification so that `DESC` vs `desc` or trailing whitespace do not
 * produce false mismatches.
 */
export function policiesEqual(a: CatalogPolicy, b: CatalogPolicy): boolean {
  const na = serializePolicy(a);
  const nb = serializePolicy(b);
  return (
    na.order === nb.order &&
    na.hidden.length === nb.hidden.length &&
    na.pinned.length === nb.pinned.length &&
    na.hidden.every((v, i) => v === nb.hidden[i]) &&
    na.pinned.every((v, i) => v === nb.pinned[i])
  );
}

/** Parse a textarea into pattern lines (one per line, trimmed, blanks removed). */
export function parsePatternLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Format an array of patterns back into textarea text (one per line). */
export function formatPatternLines(patterns: readonly string[]): string {
  return patterns.join('\n');
}

/** Whether a pattern contains the `*` wildcard. */
export function isWildcard(pattern: string): boolean {
  return pattern.includes('*');
}

/**
 * Split entry hidden_rules into exact and wildcard groups.
 * Exact rules can be safely auto-removed; wildcard rules require manual review.
 */
export function splitWildcardRules(rules: readonly string[]): {
  exact: string[];
  wildcard: string[];
} {
  const exact: string[] = [];
  const wildcard: string[] = [];
  for (const rule of rules) {
    if (isWildcard(rule)) wildcard.push(rule);
    else exact.push(rule);
  }
  return { exact, wildcard };
}

/**
 * Reorder a pinned-pattern list by swapping the item at `index` with its
 * neighbour in `direction`.  Returns the original list unchanged if the
 * target index is out of bounds (edge disabling).
 */
export function reorderPin(lines: readonly string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (target < 0 || target >= lines.length) return [...lines];
  const next = [...lines];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Display only backend results computed for the current draft. */
export function catalogViewForPolicy(
  policy: CatalogPolicy,
  inventory: CatalogView | null,
  preview: CatalogView | null
): CatalogView | null {
  if (preview && policiesEqual(preview.policy, policy)) return preview;
  if (inventory && policiesEqual(inventory.policy, policy)) return inventory;
  return null;
}
