# Upstream compatibility batch — 2026-09-13

## Scope

The upstream sync line is `f4b3043` (v1.22.18). The fork selectively integrates
compatible fixes, rather than replacing its provider workbench with upstream.
Backend companion: CPA's four-patch batch documented in its same-named document.

| Upstream commit | Integrated behavior |
| --- | --- |
| `3be19df` | Clearing models invalidates stale in-flight requests. |
| `d3cdc46` | Preserve YAML merge strategy across visual/source mode switches. |
| `7b93570` | Preserve YAML payload nodes, comments and aliases while editing. |
| `f0c229d` | Match backend boolean defaults and explicit toggle writes. |
| `ef7997e`, `38ea35c` | Accept backend integer sentinels; reject unsafe integers. |
| `dc1dc01`, `9320c87` | Guard log read/clear/session races; explicit error-viewer states. |
| `97fbadd` | Cmd+B / Ctrl+B sidebar toggle with input exclusion. |
| `e5d4626`, `9731ca4` | Drawer motion and segmented-control contrast. |

## Fork resolutions

- Preserve Home log loading, per-request Home IP downloads and the separate
  request-log tab; apply upstream request ownership before mutating these fields.
- Preserve provider draft serialization, shared production Codex probe execution,
  single-key selection, cancellation and stale-result invalidation unchanged.
- Do not introduce Antigravity sensitive-word fields from conflict context.
- Preserve custom usage, aliases, key reveal, ZIP downloads and plugin controls.
- Two existing lint issues surfaced with locked dependencies: remove an unused
  endpoint initialization and retain the cause of direct media-probe timeout
  errors using an ES2020-compatible error object. No transport change.

- Browser regression caught an error-viewer close race: a newly allocated close
  callback caused the Modal effect to cancel its Escape close timer after late
  state updates. Memoize that callback and retain the Escape-close browser check.

## Review

One parallel Standards/Spec review completed. Corrected English-only comments and
removed a redundant test ternary. Backend defaults match config_load.go/parse.go;
provider probe validation is definitely assigned on both try and catch paths.
The proposed broad AST abstraction is deferred to keep this compatibility batch scoped.

## Verification

- 696 Bun tests pass; ESLint, TypeScript and single-file Vite build pass.
- Red/green checks cover models cache, YAML merge/payload/default/integer fixes
  and the sidebar shortcut; upstream log queue/viewer regression tests pass.
- `tests/browser/codexProbeLifecycle.cjs` checks single-key probes, draft edits,
  cancellation and late results using intercepted responses, without paid calls.
- `tests/browser/upstreamMerge.cjs` checks log read/clear ordering, error viewing,
  retained request-log tab and sidebar keyboard behavior with intercepted writes.
- Copy `dist/index.html` to CPA `static/management.html`, then run CPA's
  `node test/provider_usage_match_test.mjs` and compare served panel hashes.

## Deferred updates

Provider catalog rewrites, fingerprint controls, Kimi/OAuth additions and newer
backend-dependent settings remain deferred until their backend contracts and
fork behavior have been reviewed together. This is not a full upstream merge.
