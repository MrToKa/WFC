# PF-B3 — Constrained routing and honest collision decisions

Product commit `fbf7ddd7e0c0f709655bff9224299866e7a28564` on
`pf-b3-constrained-routing-local-20261021` inherits B2 product a967ddd12c8a7052f61abc290491554df75d2388
and report/handoff b98a9d844d9fd641d1bd21257c0d4000ca0787ff.
Technical implementation and synthetic checks are complete for B3.
No browser/actual converted geometry or user engineering acceptance is claimed.

## Implemented behavior

Three new Core Support files preserve all eleven pinned Routing sources.
The exact legacy endpoint pair and original graph construction/order run first.
Actual node-to-node graph edges are collision checked before Dijkstra, including
verified-port connectors and sub-micrometre gaps. Remaining Edge structures, gap
costs, tie order and length arithmetic are retained. The final exact polyline is
independently checked, including one-point occupancy. Failure diagnostics identify
a rejected attempted shell, never an invented hit point or final segment index.

If the first pair fails, deterministic per-piece nearest3D and XY/vertical
projections are considered. Vertical preference changes their bounded ranking,
not whether a straight candidate can be searched. A fresh original graph is built
for each pair, avoiding changed ContactGraph initial nodes from pooled projections.
A Clear result proves only its actual checked segments in the selected registered
scope; it makes no claim to examine every remaining pair or find a global optimum.

The original strict direct SECONDARY D<F OR D<T decision remains unchanged.
A blocked/indeterminate qualifying direct chord tries the constrained tray strategy.
Explicit drilling preserves the original strategy and is recorded as bypassed.
MV remains excluded from these new entries. Original design/decimal/rounding math
is reused without a JavaScript engineering calculator.

Additive shared v2 contracts preserve historical v1 schemas and frozen hashes.
They allow shell-level membership with surfaceWitness:null, ordered final-check
prefixes, indeterminate queries and a distance-qualified blocked direct candidate.
Integrity helpers check current binding/hash/membership, not producer authority or
collision math. Their final-proof prefix is distinct from search-wide counters:
later runner integration must collect exact ordered final checks separately.

## Bounds and accounting

One monotonic deadline and original-user cancellation cover direct comparison,
input/candidate scanning, every graph/pair and final checks. New default refusal
ceilings:16 candidates per end,64 pairs,100000 collision queries,20million counted
work,30seconds,4096 input trays,50000 pieces,100000 graph nodes,300000 connections.
Only tighter values are admitted. Existing graph internals retain their original
independent caps and share the deadline; their every CPU instruction is not counted.
Reported already-performed oracle work is retained even when the last indivisible
query exhausts the allowance/deadline; overflow saturates and refuses. It can exceed
the allowance by that last separately bounded query, with no next query admitted.
These ceilings are not maximum-capacity or combined512MiB qualification.

## Actual root checks

- PASS54 constrained checks using actual qualified synthetic closed-triangle solids:
  walls/floors/tunnels, farther accessible tray, exact graph connectors, direct
  fallback/bypass, independent final checks, deterministic ties, binary64 route
  fields and exact Core decimal representations, uncertainty/cancel/caps/work.
- PASS140 TypeScript checks:62 new v2 decisions,58 B0 barrier contracts,20 old direct.
- PASS105 original routing regressions and43 frozen golden cases/215 replay checks.
  Replay and its CLI dependencies ran from an owned scratch mirror; frozen files
  were copied read-only and expected values were never regenerated.
- PASS35 ledger checks and63 direct SECONDARY checks, including actual separate
  one-shot/session model runner transports with owned synthetic work roots.
- PASS final client/server type checks, changed TypeScript lint, independent source
  review, staged whitespace and11 original Core hashes plus frozen input/expected hashes.

Initial test build had two invalid target-typed constructors in params-call fixtures;
explicit RouteConnectionPort construction corrected them. Core itself compiled.
Review also corrected a user-cancellation race, misleading success Blocking history,
work telemetry on an exhausting oracle query and new direct version alignment.
Raw initial failures and final evidence are retained; no historical result is counted
as a fresh run.

Evidence root:
`pathfinder-engine/.scratch/barrier-routing-20261021-7e52ad81-3875-4701-adbc-4fb38acc9d1e`.
Public receipt: `evidence/barriers/b3-constrained-routing.json`.

## Remaining scope and isolation

B3 uses straight endpoint approaches. Offset openings needing turns remain B4.
Runtime/DTO/jobs/cache/dependency/Apply/UI integration and actual Aalborg counterexample
remain B5–B9. No HTTP/SQL/UI or cable/model/container updates in this stage.
Unchanged origin access refusal is not retried/bypassed; actual capture/UI is NOT_RUN.
No native parity, physical cable-radius clearance, actual model coverage or acceptance.

Ten product files changed: three new Core support files; four independent test project
files; two additive shared contract/test files; progress. Original WFC remained clean
96e63f13fdc2b1d30b8f8ff658dd662f25fac104. Original5180/5190, sources/, model/cable data
and5191 demonstration remained unchanged. No push/PR/merge/deployment.
Live GitHub main96e63f13 was read at2026-10-21T11:54:04.138Z; B3 PR search returned none.
Cached origin comparison before this product commit was145local-only/3remote-only,
not current remote parity or CI acceptance.

Automatic approval review previously refused cleanup of B2 scratch sql-root and
linux-sql with “blocked by policy”. Both paths/parents and seven historical refused
targets stay untouched. B3 created no containers. Keep needed evidence/artifacts.
Next: execute PF-B4 from its detailed handoff on a new inherited local branch.

