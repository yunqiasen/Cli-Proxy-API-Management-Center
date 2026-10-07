/**
 * Domain types for the native model catalog display policy feature.
 * These mirror the backend wire contract served under /v8/management.
 */

export type CatalogOrder = 'preserve' | 'asc' | 'desc';

export type CatalogFormat = 'openai' | 'claude' | 'gemini' | 'codex' | 'grok';

export const CATALOG_FORMATS: readonly CatalogFormat[] = [
  'openai',
  'claude',
  'gemini',
  'codex',
  'grok',
];

export interface CatalogPolicy {
  order: CatalogOrder;
  hidden: string[];
  pinned: string[];
}

export interface CatalogEntry {
  id: string;
  label: string;
  format: string;
  hidden: boolean;
  hidden_rules: string[];
  pinned_rules: string[];
  /** Zero-based visible order, or -1 when hidden. */
  position: number;
}

export interface CatalogCounts {
  total: number;
  visible: number;
  hidden: number;
}

export interface CatalogView {
  format: string;
  policy: CatalogPolicy;
  entries: CatalogEntry[];
  visible_ids: string[];
  counts: CatalogCounts;
  model_sort_enabled: boolean;
}

/** Result of reading the saved policy endpoint. */
export interface PolicyReadResult {
  /** The normalized policy (defaults when unconfigured). */
  policy: CatalogPolicy;
  /** Whether the policy group existed on the server (404 = false). */
  configured: boolean;
}
