# PF-2 continuation — bounded capacity baseline

The selected real network and four mathematical scaling inputs pass exact result
checks through the unchanged Core and the actual private ModelRunner binary.
This is a scoped technical baseline, not whole-plant capacity or engineering
acceptance. The user's manual review is still pending. No application source,
running API/web image, settings, cable or proposal was changed by this substage.

## Revision and input

Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
`pf-2-capacity-local-20261018`, inheriting
`8a726f72ab94da22681320f28ccebe1224cf8eb3`. The subsequent local commit contains
this additive delivery; use live HEAD/status. Original WFC main remains
`e1ef20202598bb4d3d78e4772cbbb9747ec23a00`, canonical PathFinder master remains
`45c24bf5f433f13e102600b36f20327c77961d0a`, and the older dirty checkout is
preserved. [Live remote/connector evidence](evidence/capacity/remote-revisions-20261018T1148Z.json)
shows unpublished candidate branch; no candidate remote CI/review is claimed.
The [handoff](handoffs/PF-2-capacity-baseline.md) implements item5 of the original
PF-2 assignment. The earlier human-review handoff did not waive this remainder.

The [read-only input receipt](evidence/pf2-capacity/input-provenance-1792324304556.json)
binds exact copied planning artifact `75c61dc7-d456-45b0-9052-2a0822240350`,
SHA256 `b47365401aaf078374607c944e22ac5100f2aa6fe4389c056fbdd963526f17ed`,
2,501,953bytes,52objects/26routing leaves. The active model is
`925c0fc0-6e36-4d47-b1ce-38b0beff5953`, project
`105913f0-7ee4-45f2-bfd8-2c01f9be9f2a`. This selected capture is explicitly
partial; its proof flags do not claim full inventory, geometry, native visibility,
units/transforms or source-link engineering validation.

Actual confirmed QA network-end names `=PF-DEMO-NETWORK-START` and
`=PF-DEMO-NETWORK-END`, exact points, category Control, options and existing
forward preview were copied without new jobs. They are not accepted business
equipment identities. Details revision2 supplies gap1m, SECONDARY3m, end reserve5m
and bending10%. No value is invented or taken from another project.

## Method and exact outcomes

New `pathfinder-engine/tools/PathFinder.CapacityBench/` references existing
Model/Adapter/Core projects. New `scripts/pathfinder-capacity/` samples the actual
private runner from existing isolated API image
`sha256:ee402f8d972256c7c912349a360c321de8ce1f19238b7a7c149fb463960daa45`.
The test container has no network/ports, read-only root, four exact new scratch
mounts,2CPU quota,4GiB memory and256PID ceiling. No source runtime volume is
mounted. The source API's existing4GiB/256PID bounds are checked separately.

Final benchmark DLL SHA256 is
`90c939476155552bf3be27bbee29e09e220e159c16996fa30dcde4f997691b2a`.
[Source/build/self-test binding](evidence/capacity/bench-source-20261018T120135Z.json)
records SDK9.0.319, zero build warnings/errors and exact source/assembly hashes.
The unused Windows apphost is omitted from a fresh Linux mount copy, with its
identity recorded; the original publish folder is preserved.

Five datasets pass65direct recorded phases: cold-fit/query, new-cache disk
fit/query, a timed memory-hit and eight identical queries against the same
PreparedModel. All15actual one-shot requests (one empty fitted cache and two
new processes using the same disk cache per dataset) match the complete direct
route/design/category semantics, including every unrounded point and field.
The real result also exactly matches its previously saved current preview:
35.30345579516123m,90points,25used segment identities,4gaps totaling
0.9840583861033791m and design45m. No Apply or review is performed.

Each synthetic chain independently requires all N known2m segment identities,
zero approaches/SECONDARY/gaps and design
`ceil((2*N + Details.endConnectionLength) * (1 + Details.additionalBendingPercent/100))`.
Results are16/128/512/2048m and24/147/569/2259m design. Chains above100route
codes probe Core capacity; they do not prove WFC Viewer/Apply compatibility.

| Input | Segments | Empty fitted-cache build, ms | Same PreparedModel identical-query median, ms (8) | One-shot empty fitted cache, ms (1) | One-shot disk-warm mean, ms (2) | Largest sampled tree RSS estimate, MiB |
|---|---:|---:|---:|---:|---:|---:|
| Selected real network | 26 | 502.407 | 0.749 | 1336.943 | 1200.382 | 146.113 |
| Synthetic2m chain | 8 | 60.766 | 0.088 | 396.620 | 462.118 | 98.637 |
| Synthetic2m chain | 64 | 95.484 | 0.613 | 405.426 | 449.478 | 100.727 |
| Synthetic2m chain | 256 | 107.154 | 1.596 | 562.346 | 444.987 | 110.102 |
| Synthetic2m chain | 1024 | 163.581 | 10.150 | 777.434 | 653.765 | 130.051 |

These are recorded small samples, not p95/service throughput promises. Cold
means no fitted artifact: prevalidation/parsing already ran, process/JIT/OS
caches are shared across direct cases, and later identical queries can reuse
mesh-clearance proof caches. Direct query timings include graph construction,
route/design calculation and semantic serialization/hash. One-shot wall time
includes new supervisor/worker/startup/fitting/serialization/sampling overhead.
They are different cost scopes; the table is not a measured end-user speedup.

Nominal20ms `/proc` scans give non-atomic process-tree RSS estimates and may miss
short peaks. Independent supervisor/descendant maxima must not be added. An
exact coincident peak and source-API memory usage are not proved. Cgroup peak
is unavailable in this run, not zero. Total measured container sequence was
17.323seconds. No limit was increased, model truncated or failing branch dropped.

## Validation and failures retained

- PASS: final self-test3mathematical datasets/21phases, Instrumentation→Control,
  pre-cancellation, deterministic cancellation during input enumeration and an
  explicit two-node graph-limit failure. This is not deepest-search latency proof.
- PASS: [17final CLI rejection controls](evidence/capacity/final-input-controls-20261018T1201Z.json),
  exact final DLL. Invalid manifests/numbers/decimals/gap/hash/identity/purpose/
  budgets/paths refuse before new output. Existing workroot/sentinel preserved.
- PASS: four actual isolated process controls: pre-cancel without spawn, hard
  deadline with observed child-group retirement, bounded-output rejection and
  cancellation of an observed production .NET supervisor/worker group.
- PASS:28final Node guard cases and syntax checks, including omitted-false mount
  normalization, exact source bindings, duplicate JSON and unordered metadata.
- PASS: independent [method review](evidence/capacity/method-review-1792324992552.json)
  at recorded source hashes. Fit-timeout propagation, phase wording, valid lookup
  refusal fixture, retained exit1 failure JSON, failure classification and RSS
  wording were corrected. Reviewer executed no tests/runtime operations.
- The first never-started container was refused by an overly strict metadata
  guard: Docker omitted `ReadOnly:false` for the writable work mount. The guard
  was corrected with targeted tests; the exact owned container was removed.
  [The failed attempt](evidence/capacity/attempt-mount-zero-value-1792325273563.json)
  and [its separate cleanup evidence](evidence/capacity/attempt-cleanup-1792325273563.json)
  are preserved. This was a tool guard failure,
  not an approval denial.
- Actual calculations pass, while the first completed outer orchestration
  receipt reports FAIL because unchanged API mount metadata arrived in a different
  array order. [That receipt](evidence/capacity/orchestration-original-1792325273563.json)
  remains unchanged. The [separate sorting-only preservation audit](evidence/capacity/preservation-amendment-1792325273563.json)
  passes normalized before/after/current bindings; route arrays are never reordered
  or recalculated. Mathematical checks were not rerun for this metadata correction.

The exact public orchestration receipts/normalization closure are recorded in the
final checkpoint below. Historical original105/215regression results are not
rerun or presented as fresh tests for these additive tools. Production/Core/Model/
ModelRunner bytes remain unchanged.

## Preservation and cleanup

[Final read-only preservation](evidence/capacity/final-preservation-1792325162813.json)
passes all12workflow hashes, all18container identities/images/start times
(13original+5own), current selection/planning identity, source/copied snapshot
bytes and manifest/reference hashes. It deliberately excludes unordered mount
array presentation from identity fields. The [five-group source/environment audit](evidence/pf2/isolation-1792325122300.json)
passes Core/regression source pins, frozen PF-0 prefix/data, native source pins,
original checkouts/dirty files and original containers. This is not an original
database-content audit. No original data write was performed.

Disposable benchmark containers are removed, with no networks/volumes/images
created. The demonstration, verified archive, needed copied inputs/final binaries
and evidence remain. [Four redundant copied control files](evidence/capacity/control-input-cleanup-20261018T1205Z.json)
were removed after verification, freeing10,010,214bytes. Manifests/receipts and
the original retained copied dataset remain reproducible.

[Cleanup of two superseded own build/self-test directories](evidence/capacity/bench-cleanup-blocked-20261018T120432Z.json)
was rejected by automatic approval review with `blocked by policy` before process
creation. They retain2,502,799bytes; deletion0bytes. There is no retry, alternate
tool, parent deletion or bypass. These two are added to the four earlier denied
children; all six exist. Never remove these or their parents in a continuation.

## Remaining scope and next action

The data justifies investigating a bounded persistent private worker: the current
fresh-process path repeatedly pays startup/JIT/cache-restore costs even for this
small network. It does not establish the benefit for varied endpoints/categories
or a larger real network. A follow-up must preserve per-request authoritative
settings/identity, exact C# math and hard cancellation/crash isolation, and measure
mixed-query equivalence before any throughput claim. It must be a new inheriting
local branch with no changes to originals or real Apply.

True reusable graph remains NOT_IMPLEMENTED; graph is rebuilt by unchanged Core
per query. Whole-plant real geometry/category/completeness and capacity remain
NOT_RUN. Native comparison is NOT_PERFORMED/NOT_REQUIRED_BY_USER, not PASS.
Human engineering acceptance, cross-computer restore and host-wide offline
disconnection remain separate pending checks. No push/PR/merge/deployment occurs.

## Final checkpoint

Scoped technical outcome PASS. The [compact summary](evidence/capacity/summary-1792325273563.json),
[raw measurements](evidence/capacity/measurements-1792325273563.json),
[direct benchmark](evidence/capacity/benchmark-1792325273563.json) and
[source manifest](evidence/capacity/source-manifest-1792325273563.json) bind the
five datasets/65phases/50direct queries/15one-shot queries and all four process
controls. The manifest distinguishes the copied tools actually executed from the
later metadata-only comparator correction; they are not claimed byte-identical.
Initial failed outer receipts remain failures, with the derived closure above.
Local commit and the following self-contained worker-reuse handoff record the
next authorized technical action. Overall PF-2 engineering/whole-plant acceptance
is not established by this substage.
