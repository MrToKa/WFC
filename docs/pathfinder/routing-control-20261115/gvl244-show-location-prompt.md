# GVL244 saved-location display repair — executable follow-up

## Goal and baseline
User reports Show location disabled for -WD3070MS-1 although its To equipment 15-P3070 is present in the model tree. Reproduce and fix in the in-app browser. Baseline 2026-11-15 15:32 UTC: branch fix/barrier-frame-recovery-20261112, HEAD cf7c64d3845aa42276c10743b62a146b5f3ce77d plus existing dirty implementation. Local-only 5181; original5180 excluded. Remote status is not freshly inspected, and no push/deployment outside test compose is authorized.

## Proven cause and boundaries
Five previous sub-micrometre point normalizations retained current confirmed coordinates but wrote generic manual-world-point bindings without model presentation hints. Verified predecessor of15-P3070 resolves original SDK105280 through the successful bulk-match command. Recover presentation through exact, bounded immutable command/head evidence; preserve current points, head IDs, proposals, Routing and Design length. Respect explicit null display clears; do not promote a display hint to geometry/connector authority. No rescanning all From/To or recalculating271 cables for a presentation bug.

RIO1 differs: all12 RIO cabinets intentionally share the user-approved fixed gateway point; there is no verified cabinet object. Provide coordinate-only Show location with a distinct marker/focus and clear explanatory copy. Do not fabricate an SDK object, alter routing overlays, or disturb current isolation/selection. Reject stale/mismatched model/frame contexts.

## Ownership and execution
Backend writer owns numerical display-history recovery, cableEndpointDisplay fallback and tests. Frontend writer owns point-display message/adapter/controller/workspace/panel and tests. Parent integrates, deploys only wfc-test-app from D:/WFC-Test/compose.app.yml + compose.candidate.yml and validates current data and UI. Preserve all concurrent edits.

## Acceptance
1. All five normalized equipment locations regain verified object presentation without changing points or bindings.
2. -WD3070MS-1 Show To location reveals/focuses15-P3070; Show From location marks the saved RIO1 point and labels its point-only nature.
3. Existing15-P3820 centre-derived Show still works. No stale/wrong-frame selection, explicit-clear resurrection or arbitrary manual-point association.
4. Scoped regression tests, types/lint/build pass. Actual in-app browser clicks verify model-object and saved-point behavior.
5. Compare before/after hashes for1223 cables, binding revisions/commands, aliases, proposals and routing controls. Retain271 successful calculations/lengths,191 auto writes and80 protected pairs.
6. Record report with actual tests, runtime images and remaining limitations; no acceptance claim before observing the running UI.

## Evidence
D:/WFC-Test/validation/routing-control-20261115/gvl244-show-location-before.json
D:/WFC-Test/validation/routing-control-20261115/gvl244-show-location-contexts-before.json
Previous acceptance: gvl244-centre-fallback-report.md; current plan.md.
