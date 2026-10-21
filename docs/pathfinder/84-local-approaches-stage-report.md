# PF-B4 — Bounded approaches through offset openings
Product `a7aa8bce1c2ffdda8e1a9fea10661a58624d2a96`, branch
`pf-b4-local-approaches-local-20261021`, inherits B3 product fbf7ddd7e0c0f709655bff9224299866e7a28564
and report/handoff9801488fa988120399b275d9e6c069caccd531fc.
B4 implementation and synthetic qualification are technically complete.
The isolated running5191 application has not been updated in this stage.

## Implemented
New LocalConnectorModels/LocalConnectorPlanner/LocalApproachRoute support files
add deterministic bounded endpoint connector planning. Guidance is an explicit
canonical-domain lattice; occupancy, every accepted start/neighbour/goal edge and
every exact final connector segment are checked by the actual collision oracle.
Finite-grid/domain failure is incomplete search, never evidence that no physical
opening exists. No bbox free-space declaration, fabricated portal or unverified
smoothing. Returned point arrays are immutable copied exact endpoints/waypoints.

The new strategy reserves a bounded straight phase (up to8pairs), then uses the
same global budget for local plans and fresh original graph-per-pair searches.
At most8planner attempts, including failed attempts; at most16384local checks
across all plans. Input/candidate/graph/query/work/time ceilings remain B3's.
The default search profile is0.25m step,1m padding,20m maximum axis span and4096grid
nodes. Total lattice size is checked before small array allocation; it can refuse
below any one ceiling. These are guidance/refusal limits, not physical clearance.
A coarser explicit domain than the chosen profile is refused, not silently resampled.

The graph assembly requests plans to actual stored node points (segment+Along+XYZ
cache key), preserving even floating-point joins. From waypoints precede the
unchanged graph, reversed To waypoints follow it. Actual summed approach lengths
drive the original SECONDARY threshold/replacement and graph+From+To arithmetic.
Internal fitted tray edges/cross-tray gaps are never detoured off-tray.
The entire assembled path is independently checked. B3 old entries keep straight
semantics; all11original Routing sources and Core decimal formulas remain unchanged.
Direct SECONDARY keeps its straight3D formula; blocked direct falls back to trays.
Explicit drilling makes no local planner/oracle calls and records bypass.

## Actual root verification
- PASS40 local connector checks against qualified synthetic closed solids: offset
  wall tunnel, rotated floor, both-end detours, exact waypoint/approach/SECONDARY
  math, inside/rim/narrow/domain cases, deterministic results, caps and cancellation.
- PASS numeric translated tunnel around1e6; actual near1e9 geometry with tiny-step
  refusal allocated2400bytes in the measured synchronous thread, no accepted path.
- Suite40 elapsed449.7756ms; process peak59256832bytes. These are this synthetic
  test process only, not actual/model maximum capacity or combined512MiB proof.
- PASS affected B3 suite54, original regression105,43frozen cases/215parity checks,
 35ledger and63direct SECONDARY actual one-shot/session runner transport checks.
- PASS source review, staged whitespace,11pinned hashes and frozen input/expected hashes.
  No TypeScript product changes; B3's140shared checks and client/server types/lint
  are reused for their unchanged files, not reported as newly executed B4 checks.

Initial actual B4 run was36PASS/1FAIL: the direct drilling route was correct but
its new nested disposition incorrectly remained unavailable. The source correction
sets bypassed before result construction; the original test was retained. A source
review also found the explicit-domain/coarser-step mismatch; a new refusal regression
passes. Initial and final raw receipts are retained.

Evidence:
`pathfinder-engine/.scratch/local-connectors-20261021-6d29c5f6-b3ed-495c-a3f6-f076be1e2039`.
Public receipt: `evidence/barriers/b4-local-approaches.json`.

## Limits, changes and continuation
No actual converted capture/SDK/UI/Aalborg counterexample, physical cable-radius
clearance, native parity or human acceptance. The unchanged origin refusal remains;
no alternate browser/native/CDP/origin/permission bypass. B5–B9 still must connect
UI, explicit frozen policy/profile, runner/dependencies/jobs/cache/write guards and
actual qualification before coherent demo delivery. Final ordered route proof must
be collected separately from global search counters.

Twelve product files changed: three new support files, two new-B3support refactors,
four new ProjectReference test files, progress, and EOF-only formatting repair in
report83/B4handoff. Original sources/frozen fixtures were not regenerated.
No HTTP/SQL/runtime/container/model/cable writes or real Apply.
Original WFC remained clean96e63f13;5191,5180,5190 and sources/ stayed unchanged.
Live GitHub main96e63f13 read2026-10-21T12:19:15.515Z; no B4 PR. Cached comparison
before product commit147local-only/3remote-only is not live remote/CI acceptance.
All policy-refused scratch paths/parents stay untouched; no containers were created.
Next execute B5 immediately through its detailed handoff.
