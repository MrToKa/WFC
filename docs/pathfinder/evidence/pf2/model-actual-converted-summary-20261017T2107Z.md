# Actual converted geometry diagnostics — selected route captures

Both actual normalized snapshots passed the strict Model reader and the
unchanged Core's ordered route lookup. These are **selected converted-model
diagnostics**, not a successful native comparison or an accepted engineering
route map. The two runs used explicitly requested **1.0m diagnostic connection
tolerance**; the Core's engineering/default thresholds were not changed.

| Observed scope/result | Route 01 | Route 02 |
| --- | ---: | ---: |
| Captured physical routing leaves | 68 | 26 |
| Mesh fragments | 257 | 99 |
| Vertices | 91,934 | 34,674 |
| Triangles | 93,738 | 35,772 |
| Fitted segments | 68 | 26 |
| Validated / fallback straights | 27 / 24 | 10 / 9 |
| Validated / fallback bends | 0 / 17 | 0 / 7 |
| Segments without retained clearance surfaces | 0 | 0 |
| Ordered lookup length [m], binary64 round-trip | 107.55007443085563 | 37.050260813690024 |
| Exact output path points | 156 | 59 |
| Ordered result segment IDs | 63 | 23 |
| Diagnostic gap count | 8 | 4 |
| Diagnostic gap length [m] | 4.0474224489976445 | 1.4685352921601158 |
| First cold fit [ms] | 1008.6106 | 474.2163 |
| Memory cache read [ms] | 3.0339 | 1.2384 |
| Disk fit restore [ms] | 368.4823 | 245.2121 |
| First ordered lookup [ms] | 860.3719 | 510.4671 |
| Worker total through calculation [ms] | 3057.9464 | 1544.4361 |
| Worker peak working set [bytes] | 139,460,608 | 90,804,224 |

The independent workers ran concurrently with separate fresh owned cache
directories. These measurements describe those selected captures on this local
machine, including shared-machine contention; they do not establish capacity or
latency for the full plant. Each worker had a 120,000ms hard supervisor budget.
The in-memory second call reused the same fitted model. A separate cache
instance restored the persisted fit and produced **identical** segment points,
ports, counters, diagnostics and full ordered-lookup route JSON. The per-query
routing graph is still rebuilt; no prepared immutable graph is claimed.

## Input identity and reproducibility

Route 01 snapshot SHA256:
`0d5546c5fe1992274b27ade65da9c1815488af0b82fea3e695a348894fd441af`.
Local snapshot:
`pathfinder-engine/.scratch/pf2-converted/normalized/1792271204697-c02e718b-f05f-41bd-aa61-d3492e0b22d3/snapshot.json`.
Exact requested route:
`/BC002/BC001/C001/C101/C106/C107-1/C107-2/C107-3/C107-4/C107-5/C138-1/C138-2/C138-3/C139/BC027/SECONDARY`.

Route 02 snapshot SHA256:
`5187d096f444767ad46973f9529e14ec79d21c1d7f32829994d70928f820f060`.
Local snapshot:
`pathfinder-engine/.scratch/pf2-converted/normalized/1792271204713-58fe717c-fe0a-485e-99cc-ed4e9b2e58de/snapshot.json`.
Exact requested route:
`/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY`.

The raw inventory was separately normalized/verified by the capture worker;
neither of these mesh subsets is a complete plant geometry snapshot. Both
snapshot content hashes were rechecked immediately before these runs. Their
normalized receipts preserve actual binary64 SDK transform composition; earlier
rejected duplicate-root/nonfinite/Float32 captures were not used here.

The CLI is `pathfinder-engine/tools/PathFinder.ModelCheck/`. Exact output,
full path point arrays with `R` companions, fitted segment data, option values,
source/proof metadata, cache keys and all diagnostics are retained in:

- `model-actual-converted-lookup-01-20261017T2107Z.json`
- `model-actual-converted-lookup-02-20261017T2107Z.json`

Fresh caches are retained only in
`pathfinder-engine/.scratch/modelcheck-actual-20261017T2107-case01` and
`pathfinder-engine/.scratch/modelcheck-actual-20261017T2107-case02`.

## Readiness and remaining gate

Both results remain **`needs_review`**, with
`readyForEngineeringWrites=false`. Every selected object has an unassigned
planning category and unknown native visibility. Source-unit/root transform,
native visibility and original-source/conversion correspondence proof flags
remain false, as do complete inventory/geometry flags for these subsets.
Many straights and all bends in these captures used reported Core fallbacks:
examples include missing compatible measured cap/neighbor evidence and radial
surfaces that do not prove a stable circular bend. Retained triangle clearance
surfaces do not prove that a fallback centreline is equivalent to native fit.

Ordered lookup deliberately ignores cable category eligibility and does not
invent equipment approaches, SECONDARY allowances, authoritative Project
Details settings or design length. SECONDARY tokens are ignored by the pinned
lookup parser; both output SECONDARY flags are false. Native source execution
is blocked by the observed licence entitlement failure. Consequently, there is
no full-precision paired native reference and no native/converted parity PASS.
Historical rounded totals cannot substitute for that missing reference.

No original app/container, project/cable row, storage object or denied cleanup
directory was changed. These runs created only the explicitly owned diagnostic
cache and new evidence files; no push, merge or deployment occurred.
