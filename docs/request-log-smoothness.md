# Request log browsing and search

## Repair contract

- Keep the request tab inside the log workspace's shared content slot. An empty
  flex sibling must not consume half of the viewport.
- The request card and table use the remaining vertical space; only the table
  scrolls. The final row, action buttons and bottom pagination remain reachable.
- Keep the action column pinned on the right and the header pinned at the top.
  Preserve horizontal scrolling, keyboard focus and the existing row content.
- Hide the duplicate top pagination on narrow or short viewports, not the bottom
  pagination. Do not hard-code the table height to one monitor resolution.
- Debounce input by 300 ms. Replaced queries, disconnected sessions and closed
  detail dialogs invalidate response ownership in addition to aborting transport.
- Keep loaded rows on a refresh error. Background polling must neither overlap
  nor replace the reading position: pause while below the top, on a historical
  page, typing an unsettled query, viewing details, or in a hidden document.
- Reset page and search state when the connection changes, including a pending
  debounce, so an old filter does not remain stuck on the new connection.
- Preserve native log and error tabs, full details, filtered CSV/JSONL exports,
  model/provider labels, legacy refresh behavior, and single-file deployment.

## Automated checks

```sh
bun test tests/requestLogSmoothness.test.ts tests/logWorkspaceUi.test.ts
bun run verify
```

The Bun tests cover ownership and the shared layout structure; they are not a
substitute for running the browser checks below.

## Browser checks

Start Vite on a loopback port. The harness supplies synthetic management responses
and intercepts model requests, writes and non-local network requests. No real key,
provider probe or live model request is involved. The interaction harness drives
only the panel's five-second poll clock explicitly; input and animation clocks
remain real.

```sh
bun run dev --host 127.0.0.1 --port 18542
# In another terminal; install Chromium once if needed:
uv run --no-project --with playwright==1.53.0 python -m playwright install chromium
uv run --no-project --with playwright==1.53.0 python tests/browser/request_logs_layout.py \
  --url http://127.0.0.1:18542/ --output /tmp/cpa-request-log-check --assert-fixed
uv run --no-project --with playwright==1.53.0 python tests/browser/request_logs_interactions.py \
  --url http://127.0.0.1:18542/ --output /tmp/cpa-request-log-interactions
```

Set `CPA_BROWSER_EXECUTABLE` to an existing compatible Chromium executable to
reuse it instead of installing another copy.

Layout checks cover 1445x950, 1366x768, 1024x768, 768x720, 390x844 and 1024x600.
They require room for the header and at least two rows; a zero-height table must
fail. They also check the last row, footer and right-pinned action with horizontal
scroll at both ends, and reject page overflow or JavaScript errors. JSON reports
and synthetic-data screenshots are saved to the requested output directory.

Interaction checks cover debounced input, superseded success and failure replies,
reading-position preservation, pagination and query reset, detail cancellation,
filtered export and empty results, raw/error tab switching, and connection changes.
The connection case uses a Vite source import strictly inside the test harness.

Repeat both browser checks against a loopback static server hosting the built
single-file panel. Use `--skip-dev-store-check` only for the built-panel interaction
run; the source-only connection check must still pass against Vite. The backend's
`node test/provider_usage_match_test.mjs` must pass with that same generated bundle.

## Diagnosis baseline

- UI fixed point: `f38492a357b5c675e09f94721121b29070dc3790`.
- Backend fixed point: `efba8cd31f9f56d38e826ef3c7a16608e25ff107`.
- The deployed panel originally clipped the table and bottom pagination. A first
  flex-only repair still left an empty sibling consuming space; explicit minimum
  usable-height and parent-slot assertions caught this false positive.
- Backend search uses a separate compact/shared-content SQLite index; see the
  backend's `docs/request-log-search.md`. This UI does not narrow or truncate the
  search query to mask server-side latency.

## Reviewed delivery

The approved repair received independent standards and behavior reviews. Neither
axis identified a UI behavior defect or added feature scope. All 1,845 Bun tests,
lint and the single-file build passed; browser checks passed for all six viewport
sizes, eight source interaction cases and seven built-panel interaction cases.
The source-only eighth case verifies connection switching. Backend query-review
refinements and migration trade-offs are recorded in `docs/request-log-search.md`
in the backend repository. Production delivery must still verify the served
bundle and the authenticated request-log path after the scoped commits.
