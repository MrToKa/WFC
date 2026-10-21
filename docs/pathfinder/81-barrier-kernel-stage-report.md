# PF-B1 — Standalone barrier kernel

Product commit `66c1772436e131d19f4fa3deec3dbf768ecb4a0c`, branch
`pf-b1-barrier-kernel-local-20261021`, inherits B0 documentation `dc939bd`.
Technical standalone stage complete; integration and engineering acceptance remain pending.

The new `PathFinder.Barriers` library qualifies connected closed consistent triangle
shells and builds an immutable bounded BVH. Segment and point queries use actual
triangles and solid containment. A connected watertight tunnel retains its opening.
Unsupported topology, numeric conditioning or resource exhaustion refuses/returns
indeterminate, never a free-space certificate. Separate closed solids form a union.
Tests use ProjectReference; the eleven pinned Core files remain unchanged.

## Actual verification

- PASS: root executed 94 console checks, zero failures, after final source freeze.
- PASS: seeded 200 transformed trials: 159 ready, 41 conservatively refused,
  318 blocked queries, zero unsafe Clear; all 40 ordinary cases ready.
- PASS: workload smoke, 200 solids/1,600 vertices/2,400 triangles/2,000 queries:
  1,000 blocked and 1,000 clear, zero mismatches/indeterminate. Build 517.4916 ms,
  queries 34.9566 ms, test-process peak working set 52,543,488 bytes.
- PASS: read-only audit of all 11 Core hashes against frozen provenance.
- PASS: independent final source review and Git whitespace check.
- NOT_RUN: maximum capacity, combined API/engine RSS, converted-model capture,
  routing integration, actual Aalborg counterexample and UI acceptance.

The initial 88-check pass was insufficient. Root reproduced an unsafe Clear for a
huge-aspect slender box (88 pass/1 fail). Plane projection/half-space closest-point
arithmetic replaced cancellation-prone dot products. Conservative conditioning
guards now cover admission, contact, containment and embedding qualification in
both directions. The failure and corrected runs are retained in owned scratch;
the failure was not discarded or relabelled an environment issue.

## Limits and evidence

Centreline collision only; physical cable radius and bend radius are not qualified.
No geometry repair, general subtractive B-rep/cavity inference, detours or whole-plant
coverage claim. Allocation estimates are not hard RSS bounds; elapsed checks are
cooperative, not hard process deadlines. The measured smoke is not maximum-capacity
qualification. Public receipt: `evidence/barriers/b1-kernel.json`; private raw receipts
under `pathfinder-engine/.scratch/barrier-kernel-tests-20261021/`.

Only new library/test files and progress changed in the product commit. No runtime,
API, database, model, cable or original checkout writes. Foreign scratch and refused
paths preserved. No push/PR/merge. Live GitHub main was `96e63f13fdc2b1d30b8f8ff658dd662f25fac104`
at 2026-10-21T10:33:00.378Z; no B1 PR returned. Cached origin/main comparison is
142 local-only/3 remote-only commits, not a live remote comparison. No remote CI
claim is made for this unpublished local stage.

Next: execute PF-B2 capture/immutable registry handoff immediately. Actual model
capture remains unavailable under the unchanged browser refusal; independent source
implementation continues. The app heartbeat is ACTIVE.
