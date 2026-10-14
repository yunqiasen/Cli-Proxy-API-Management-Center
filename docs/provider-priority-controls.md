# Provider priority and credential weight

The provider editor keeps priority and weight as separate settings:

- **Provider priority** selects the preferred eligible priority tier. Higher values
  are preferred; existing affinity and availability rules still apply.
- **Key priority** overrides that value for an individual native Gemini, Codex or
  Claude key. Clearing it restores inheritance. Zero and negative integers are
  explicit values, not an instruction to remove the override.
- **Scheduling weight** controls proportional selection within the selected tier
  when weighted round-robin is in use. It does not replace priority. The default
  weight is 1; non-positive weights are excluded from weighted selection.

OpenAI-compatible providers retain their provider-level priority and per-key
weight. Their current backend key contract does not expose a per-key priority;
this repair does not invent one. Media providers retain their existing editor.

## Regression and repair

UI merge `bc01a3b` dropped `showPriority` from the shared key editor invocation in
`BaseProviderForm`. The editor defaults that option to false, so native key cards
still displayed saved priority badges while their expanded forms omitted the
priority input. The provider-level control and the saved scheduling data remained
intact. This was a UI wiring regression, not replacement of priority by weight.

The repair restores the option for native brands only. It reuses the existing
control, inheritance hint, form state, serializers and localized strings. No
routing, provider configuration or request execution behavior is changed.

## Regression coverage

- `tests/providerPriorityControls.test.ts` renders the actual native form callers,
  verifies the missing control, retains separate weight and provider-priority
  inputs, and keeps unsupported OpenAI per-key priority hidden.
- `tests/providerPriorityRoundtrip.test.ts` exercises all three native families
  through normalized V8 groups, the real form builders, production/probe draft
  construction and save/readback. Changing key 10 to 12, 0, -3 or inherited preserves
  the other nine keys, weights, provider priority and unrelated fields.
- Isolated browser checks use the actual `/ai-providers` route with ten synthetic
  keys per native provider. The old panel reproduces the missing input. The rebuilt
  panel is checked for editing, persistence, explicit zero/negative values,
  inheritance and cancellation. No production inference probes are required.

Delivery status and detailed command results are tracked in the local diagnosis
record. Passing isolated checks is not a claim that the running panel was updated;
review approval precedes commits and local deployment for this diagnostic task.
