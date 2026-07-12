# Codex Connectivity Test Compatibility Design

## Problem

The Codex provider connectivity test currently sends a minimal Responses API payload:

```json
{"model":"<model>","input":"Hi","stream":false}
```

AnyRouter rejects this payload with `400 invalid codex request`, although the same provider and model work when CPA sends a normalized Codex request.

## Root Cause

AnyRouter requires the connectivity request to follow the Codex request shape. It also requires the same session identifier in the `Session_id` request header and the `prompt_cache_key` body field. A direct production-like request with these fields returns HTTP 200.

## Design

Update the Codex connectivity test for every Codex provider, without checking provider domains.

The request will:

- Generate one UUID per test attempt.
- Send the UUID as both `Session_id` and `prompt_cache_key`.
- Use structured Responses API input.
- Include the standard Codex request fields: `instructions`, `reasoning`, `parallel_tool_calls`, `include`, `store`, and `tools`.
- Keep `stream: false` because the management panel only needs the final HTTP status.
- Continue testing the selected provider directly through the management `api-call` endpoint, so another provider cannot hide a failure.

## Error Handling

Existing timeout and upstream error rendering remain unchanged. A non-2xx response still shows the upstream status and message.

## Testing

Add focused tests for the request builder:

1. The body contains the complete Codex connectivity payload.
2. `Session_id` equals `prompt_cache_key`.
3. The selected model is preserved.
4. Existing custom headers remain available and the generated session header is applied consistently.

Run TypeScript checks, the focused test, and the production build before release.

## Scope

This change only affects the Codex provider connectivity-test request. It does not alter saved provider configuration, runtime routing, or backend request execution.
