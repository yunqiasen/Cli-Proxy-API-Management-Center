# V8 management UI merge verification

Baselines: fork `4fb2063f82593555ee83d68ff1c424d9ce4a9b4a`, upstream
`752e0ee772220ce49aae1221a3f39f23236590d7` (v1.25.2).

The merge retains named native multikey editing and existing-key reveal, selected
key/all-key production probes, provider usage details, model aliases, request logs,
ZIP credential export, bounded background quota refresh, and plugin deletion.

Independent review found and repaired four UI entry-point regressions rather than
merely adjusting helper tests: native form/save/probe wiring; media workbench
mutations and grouping; retrieval edit/save/probe capabilities; and native runtime
cooling precedence over stale legacy fields. Media grouping preserves source
indexes across categories; retrieval saves and probes use the same form builder.

Parent validation: 1721 tests passed; type-check and build passed; lint reported
zero errors and two warnings (the exposed initializer test seam's React refresh
warning and an existing unused test import). Actual browser editing revealed the
existing key, renamed and saved the provider without dropping either key or its
first-output policy, then ran a successful production V8 selected-key probe.
The independent follow-up review found no open P1/P2 in the reviewed scope.

Backend bundle regression checks accept the V8 usage route as the equivalent of
the preserved legacy usage-route token. CI releases the `management.html` asset
on the `cpa-ui-v8-*` prerelease channel; it does not replace the V7 stable channel.

Evidence: `/tmp/cpa-fix-20261004/ui-parent-final2.log`,
`providerUiSpecRegression.test.ts` (14 real-wiring regression cases),
`browser-key-visible.txt`, `browser-saved.json`, `browser-probe-result.txt`, and
`spec-followup-report.md`. Production credentials/configuration were not edited.
