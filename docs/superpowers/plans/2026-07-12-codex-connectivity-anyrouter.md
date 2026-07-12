# AnyRouter Codex Connectivity Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Codex provider connectivity test use a production-compatible Responses API request that AnyRouter accepts.

**Architecture:** Add a small pure request builder that generates one session UUID, applies it consistently to the `Session_id` header and `prompt_cache_key` body field, and builds the complete Codex probe payload. Keep the existing connectivity hook responsible for authentication, endpoint selection, status handling, and UI state.

**Tech Stack:** React 19, TypeScript 6, Bun test runner, Vite single-file build.

---

### Task 1: Add a regression test for the Codex probe builder

**Files:**
- Create: `src/features/providers/sheets/forms/codexConnectivityRequest.test.ts`
- Create: `src/features/providers/sheets/forms/codexConnectivityRequest.ts`

- [ ] **Step 1: Write the failing test**

Test that the builder preserves custom headers, replaces any case-variant session header, uses the same generated identifier in the header and body, preserves the selected model, and emits the complete Codex payload.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test src/features/providers/sheets/forms/codexConnectivityRequest.test.ts`
Expected: FAIL because `codexConnectivityRequest.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure builder**

Create `createCodexConnectivityRequest(model, headers, createSessionId)` returning normalized headers and the structured body with `stream: false`, `instructions`, `reasoning`, `parallel_tool_calls`, `include`, `store`, `tools`, and structured input.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bun test src/features/providers/sheets/forms/codexConnectivityRequest.test.ts`
Expected: PASS.

### Task 2: Use the builder in the Codex connectivity hook

**Files:**
- Modify: `src/features/providers/sheets/forms/useConnectivityTest.ts`

- [ ] **Step 1: Import the builder**

Import `createCodexConnectivityRequest` beside the existing request utilities.

- [ ] **Step 2: Replace the minimal probe payload**

After authorization is resolved, build the probe and pass its normalized headers and serialized body to `/api-call`.

- [ ] **Step 3: Run focused and static checks**

Run:
- `bun test src/features/providers/sheets/forms/codexConnectivityRequest.test.ts`
- `bun run type-check`

Expected: both exit 0.

### Task 3: Build, publish, and deploy

**Files:**
- Generated: `dist/management.html`
- Modify: `/home/div/1_Project_dir/AI/CLIProxyAPI/static/management.html`

- [ ] **Step 1: Build the production UI**

Run: `bun run build`
Expected: exit 0 and a fresh single-file `dist/management.html`.

- [ ] **Step 2: Commit and push `CPA-UI-fork`**

Commit the source, test, design, and plan. Push to `origin/CPA-UI-fork`, then verify the UI release workflow succeeds and publishes an asset named `management.html`.

- [ ] **Step 3: Sync the generated panel into the backend fork**

Copy the built file to `/home/div/1_Project_dir/AI/CLIProxyAPI/static/management.html`, run `node test/provider_usage_match_test.mjs`, commit on `CPA-fork`, and push to trigger the GHCR image workflow.

- [ ] **Step 4: Verify the backend image workflow**

Confirm the workflow succeeds before updating the VPS.

- [ ] **Step 5: Recreate the VPS container and refresh the panel**

In `/opt/cpa`, pull `ghcr.io/yunqiasen/cliproxyapi:cpa-fork`, recreate `cli-proxy-api`, trigger the forked panel update, and verify the served management page hash matches the released panel.

- [ ] **Step 6: Verify the original AnyRouter symptom**

Use the deployed management API with the AnyRouter provider credentials and the new production-compatible probe shape. Expected: HTTP 200 from `gpt-5.6-sol`.
