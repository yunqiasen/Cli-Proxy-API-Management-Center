# Native Retrieval Provider Settings

Requires the CPA fork backend with native `/v1/embeddings`, `/v1/rerank`, and
OpenAI-compatible retrieval support in `/v0/management/provider-connectivity-test`.
Deliver the built `dist/index.html` as the backend's `static/management.html`.

## UI contract

- Edit an **OpenAI Compatible** provider and expand a custom model.
- **Endpoint type** selects the existing default, **Embeddings**, or **Rerank**.
  The optional upstream path is appended to the provider base URL.
- Retrieval hides thinking/image controls. Returning to default restores the
  controls; serialization omits retrieval-only settings for that type.
- Retrieval probes use the public alias with its prefix, including when the
  model selector displays the upstream name; alias-specific payload rules match.
- Save and test share `providerFormSerialization.ts` and
  `openAIProviderContracts.ts`. Unknown provider/model fields remain intact;
  saves keep their latest server values instead of replaying stale form snapshots.
- A row test uses only that row's key; provider tests default to the first key.
  Only the explicit all-keys action tests a list. `openai_config` excludes the
  pool and represents cleared settings with null.
- Retrieval tests use the production backend executor and response validator,
  not `/api-call`. Settings changes and unmount cancel obsolete requests; no
  browser whole-response deadline is added. Existing Chat/Codex paths retain
  their current transport.

## Verification

`bun run verify` covers test, lint, TypeScript, and single-file build checks.
`tests/retrievalProvider.test.ts` covers load/save round trips, selected-key draft
payloads, field clearing, unknown options, and removal of hidden chat settings.

Browser QA on 2026-09-20 used a temporary CPA binary and local upstream with
synthetic keys. Checked one request for the selected key, draft path/header
changes, Embeddings/Rerank switching, restored default controls, error status
for an invalid `{}` upstream response, and persistence after saving. Probes left
the saved configuration unchanged. The edit sheet was visually checked at
1440 x 1050; fields, badges, path help and Save/Cancel remained visible.

This is local fixture verification, not paid-upstream acceptance. Full backend
configuration and protocol details are in CPA's `docs/native-retrieval.md`.

After review repairs, browser verification also captured a single selected-key
probe using the prefixed public alias and observed the alias-specific payload
rule in the real upstream request. While the same form stayed open, the test
changed hidden server fields externally, then saved an alias edit: updated
values and removed flags were preserved. Final UI verification: 703 tests,
zero failures, plus lint, TypeScript and build.
