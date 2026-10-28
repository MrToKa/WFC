# PF-2 computational geometry — implemented partial delivery

This is a blocked partial delivery, not completion of PF-2. The unchanged Core
is exercised against actual selected converted meshes, but native equivalence,
complete plant geometry and reusable graph preparation are not established.

## Components and boundaries

- `pathfinder-engine/src/PathFinder.Model/` validates canonical snapshots,
  binary64 affine transforms, explicit geometry roles, hierarchy and resource
  bounds, and caches fitted centreline/port/mesh artifacts. Only explicitly
  eligible `routing-leaf` objects enter tray fitting. Hierarchy owners cannot
  become duplicate fallback segments.
- `pathfinder-engine/tools/model-capture/` serves a separately copied offline
  package at loopback port 5185. The temporary interface captures inventory and
  bounded selected meshes through the actual SDK. It is a test harness, not an
  application interface or a replacement for the protected product bridge.
- The file normalizer verifies hash-bound raw parts, complete inventory closure,
  selected identities/hierarchy, finite geometry, matrices and sample mappings.
  The comparison tool requires an explicit reviewed, hash-bound native/converted
  pairing. A name match alone cannot establish a pair.
- `pathfinder-engine/tools/PathFinder.ModelCheck/` supervises a bounded diagnostic
  worker, fits an actual normalized snapshot, checks memory/disk restoration and
  runs the unchanged ordered lookup with full output points and round-trip
  numeric companions. It does not calculate equipment approaches/design length.
- `pathfinder-engine/tools/PathFinder.NativeOracle/` is a separate test-only
  net48/x64 plugin and two bounded startup paths. Fourteen pinned files remain
  unchanged. It does not install or replace the existing add-in. The native host
  cannot currently authorize its licence, so no native reference was produced.

## Coordinates and identity

Snapshot vertices are already canonical right-handed Z-up world metres. The
reader does not transform them a second time. Recorded source, fragment and
display transforms remain evidence. Actual SDK root units are reported as
metres, with identity source/root placement and display global offset
`[42.89071492700009, -24.354130538688224, 5.195000167136811]` metres.
Independent native agreement is still unproven; these metadata observations do
not set the corresponding proof flags to true.

Capture uses the vendored SDK's `LmvMatrix4(true)` and explicitly checks
`Float64Array` storage for composition/inversion/translation. The corrected two
captures have zero recorded matrix-composition/sample residual. This proves
internal capture consistency, not recovery of any precision already lost in
conversion. Earlier duplicate-root, nonfinite-coordinate and Float32-matrix
attempts remain rejected evidence, not repaired inputs.
Triangle capture uses the pinned SDK's triangle enumerator for indexed and
nonindexed geometry. Six independent controls preserve winding/group offsets;
a fresh final browser capture retained exactly the previous valid geometry,
identities and coordinates with new provenance hashes.

The complete inventory contains 438,155 unique objects and 664,556 fragments.
Only the selected two route networks have meshes: 68 and 26 physical leaves,
257 and 99 fragments respectively. Those snapshots remain partial. dbId and
fragment identities are model-version-local; external IDs and full name chains
are evidence, not inferred cross-version identity guarantees. Native inherited
visibility is unknown and production categories are unassigned. Display Ghost,
camera occlusion and isolation never become routing exclusions.

## Cache and graph scope

The integrity-bound cache includes snapshot bytes, rules, exclusions, limits and
the pinned Core version. It retains fitted centreline points/ports and canonical
meshes; surface BVHs are reconstructed on disk restore. Actual independent cache
instances reproduced exact segment points, ports, routes, counters and diagnostics.
Queued preparation now checks cancellation while waiting for another fit.

The routing graph is still constructed per calculation. Legacy endpoint-first
insertion affects parallel attachment contacts and equal-cost node ordering;
an immutable cached final graph is not a safe replacement. The reviewed
preparation proposal and required parity controls are in
[model review](evidence/pf2/model-review.md). No graph refactor or graph-once
performance claim is made. Full-plant memory/time limits are not yet measured.

## Actual diagnostic results and acceptance limits

See [final actual run summary](evidence/pf2/model-actual-final-summary-20261017T2115Z.md)
for exact input hashes, routes, output points/metrics, timings and cache checks.
The explicit diagnostic connection tolerance was 1.0m, matching the historical
lookup experiment's setting; no Core default or engineering threshold changed.
Many straights and all selected bends used reported fitting fallbacks.

The resulting lengths, 107.55007443085563m and 37.050260813690024m, differ from
the historical rounded reports of 100.972m and 35.299m. Those historical reports
are insufficient full-precision oracles and have unverified current input
equivalence. This difference is an unresolved diagnostic discrepancy, not a
tolerance adjustment or an engineering PASS. Current ordered lookup does not
evaluate equipment From/To, project allowances or SECONDARY design replacement.

All actual preparations retain `needs_review` and
`ReadyForEngineeringWrites=false`. Native/converted engineering tolerance is
`NOT_ESTABLISHED`; the comparator's fixed 1e-9m diagnostic threshold is not an
accepted tessellation tolerance. Completing PF-2 requires an authorized complete
native reference from the same source, reviewed identity pairing, independent
units/transforms/visibility checks, representative fitting/route/design parity,
and the remaining graph/preparation and capacity work. The production design
continues to run independently of Navisworks; the native host is a validation
oracle only.
