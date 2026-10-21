# PF-B1 — Independent closed-triangle barrier kernel

Finish stageB1 of plan78. Work in
`C:/Users/todor.chankov/source/WFC-pathfinder-local`; B0 product
`95db3a0a0077e1592806a9841c6e67d382cd4246` and report80 are complete locally.
Inspect actual HEAD/status/agents/progress; create an inherited local B1 branch.
Untracked new PathFinder.Barriers and its console tests already contain authorized
work: preserve it and coordinate current owners, do not duplicate implementation.
Original checkouts/sources/5180/5190/denied paths remain untouched. No push/PR/merge.

Read plan78, matrix79, report80, shared/pathfinderBarriers.ts and its tests. B0 has
58 actual contract tests/types/lint PASS, not production collision integration.
User confirmed default-off drilling applies to all selected wall/floor/ceiling
objects only for current calculation. It will be a versioned workflow bypass,
not part of the pure geometry oracle or an engineering approval.

Own new `pathfinder-engine/src/PathFinder.Barriers/**` and
`pathfinder-engine/tests/PathFinder.Barriers.Tests/**`. Library has no Core/SDK/
database/network/filesystem dependence; tests use ProjectReference only. Root
alone runs commands/tests/runtime; agents may edit distinct library/test files.
Keep the eleven original Routing files and frozen PF-0 expected files unchanged.

Implement immutable bounded whole-mesh BVH, real indexed triangles, segment/point
collision and closed-solid containment. AABB only narrows candidates. Preserve a
connected watertight rectangular through-opening. Require complete qualified
connected consistent closed two-manifold shells with bounded embedding checks;
unsupported/open/ambiguous/over-budget input refuses, no repair/fill of holes.
Multiple independently closed shells may compose a parent and collide as a union;
trusted B2 producer must decompose/verify them and independently prove coverage.
Centreline only; do not claim physical diameter or arbitrary numerical exactness.
Distinct workflow/collision versions must align with B0. Cancellation, estimated
memory, primitive work and cooperative elapsed bounds fail closed.

Current owners: barrier_engine_map writes the new library; its child
barrier_kernel_tests writes the new console project. barrier_geometry_map reviews
read-only. Root observed an initial88-check PASS before final review/time changes.
This is preliminary, not B1 acceptance. A suspected Ericson closest-triangle
floating-point cancellation case is being reproduced: boxx[0,1e9],y[0,1e-4],
z[0,1e-3], segment(.75e9,2e-5,-.001)→(.75e9,2e-5,.002) must never report Clear.
Run the actual regression before repair, keep failure evidence, then qualify the
repair and numerical limitations. Coordinate with the owners before changes.

Root execution uses installed .NET9.0.319. Put DOTNET_CLI_HOME, NUGET_PACKAGES and
--artifacts-path under a new own engine .scratch directory; never original checkouts
or refused directories. Run meaningful kernel tests including holes/floors/inside/
edge/coplanar/transforms/reversed winding/zero length/invalid topology/cancellation/
resource refusal and the numeric counterexample. Run bounded workload smoke with
timings/RSS, while clearly separating it from full250k-triangle/real-model capacity.
No API/SQL/Docker deployment in B1. No normal calculation or real Apply to test it.

Require independent source review and exact source/revision receipts. Record
PASS/FAIL/BLOCKED/NOT_RUN and any repaired failure honestly. Complete with local
commit/report, apply prepare-stage-handoff to write PF-B2-barrier-capture.md, then
execute independent B2 work immediately. Real5191 browser access is still refused;
do not repeat/bypass it. Continue independent modules, keep actual capture checks
pending. Automation is ACTIVE for this authorized scope; do not disable it merely
because a current turn is ending or real browser checks are deferred.
