# PF-B8 — Independent qualification and actual-model gates

This executable handoff was prepared with prepare-stage-handoff after B7a product
d5cec2b00cb4815add3a9dd4ec8bffef26e13b24 (37 source/test files), report88 and
evidence/barriers/b7a-auto-length.json +source-files. Actual client/server types,
server/web builds, scoped tests, actual owned SQL/HTTP/restore checks are recorded
there. B7a SQL55442 is RETIRED; keep its private dump/evidence, create new fixtures.
Original WFC remains clean main96e63f13fdc2b1d30b8f8ff658dd662f25fac104;
live GitHub main matched17:16:23UTC21October2026, stagePR0/CI NOT_RUN.
Cached origin divergence is not live acceptance. No5191/original update occurred.
User explicitly authorizes automatic next-stage execution; do not pause routinely.

## Objective, baseline and boundaries

Continue in `C:/Users/todor.chankov/source/WFC-pathfinder-local` from completed
B7a product `d5cec2b00cb4815add3a9dd4ec8bffef26e13b24`. First inspect live branch/HEAD/status, active agents,
applicable AGENTS, automation-progress, plan78, matrix79, reports86/87/88 and their
public source/evidence receipts. Create a new inheriting B8 local branch only after
the B7a deliveries are committed; no reset, checkout loss or duplicate running job.

The exact B7a result matters: Auto calculated length is the server-owned exact
successful PF per-item output and read-only; Design remains manually editable.
Existing/partial Routing/Design values require exact comparison and human Apply.
The user reconfirmed only the authorized both-blank Save-triggered initial-fill
exception. Auto publication is derived output under calculation authority, not
Review/Apply or engineering authority. Its ordinary read label is conservatively
last-successful; matching the latest request identifies admission order only.

Original WFC5180,5190, original/canonical PathFinder and sources/ remain read-only.
No push/PR/merge or real-data Apply. No5191 image/schema/runtime update during B8;
that remains a coherent B9 action after a fresh verified backup. Root alone runs
actual tests/builds/SQL/HTTP/runtime; source agents have nonoverlapping ownership.
All new scripts, raw artifacts and receipts stay in a new proved-owned scratch
child. Refused scratch children and their parents stay untouched; no prune,
alternate deletion or unchanged browser-origin permission retry/bypass.

## Distinguish the four claims

1. **Independent synthetic numerical/transport/security qualification:** useful
   and authorized now. It can PASS only for the actual bounded tested revision.
2. **Synthetic protected session measurement:** new work described below. It
   measures real v2/v3 runner processes, files, guards and a bounded artificial
   workload. It is not representative Aalborg or maximum-capacity proof.
3. **AC-01/02/03 actual converted civil geometry/counterexample/2140 workload:**
   dependent on legitimate protected capture and the actual model/cable inputs.
   BLOCKED/NOT_RUN when unavailable. Synthetic output must not substitute for it.
4. **Native parity and user engineering approval:** not performed; no Navisworks
   license. User elected converted evidence plus their own manual review.

## Source facts and exact existing entry points

### Real protected transport harness

- `pathfinder-engine/tests/PathFinder.BarrierRuntime.Tests/Program.cs` is the
  independent console harness. Its current entry accepts exactly
  `--runner <absolute built ModelRunner DLL> --work-root <absent absolute child>`.
  `PathFinder.BarrierRuntime.Tests.csproj` references production assemblies once
  through ProjectReference; production C# source is not linked or copied.
- `Fixtures.cs` authors small closed boxes, a real closed rectangular tunnel and
  transformed floor. `Fixtures.Store(root, mesh)` invokes the real
  `BarrierCaptureVerifier`, writes fresh raw capture/manifest blobs, and includes
  exact topology/decomposition counts. Its deliberately synthetic B2 authority
  digest is distinct from the actual pure geometry verification digest.
- `Fixtures.Request(root, spans)` creates a synthetic planning snapshot and an
  explicit `pathfinder.model.runner.v2` request. The current request helper writes
  one snapshot each time; for warm benchmarks create it once, then deep-clone its
  request and vary actual From/To/category while keeping the exact immutable model.
- The existing harness independently rechecks every successful final segment
  against the qualified triangle kernel in `ExactSuccessful`. It covers wall,
  actual tunnel opening, floor, offset local connectors, direct-blocked fallback,
  strict context/profile/files, corruption, reverse/underflow, deadline and
  one-shot/session equality. Its session cases at lines271–299 interleave eight
  contexts, mutate only owned capture bytes and restart a lane. They are semantic
  checks, not a measured 2140-cable session or combined-memory qualification.
- `Session.Start`/`Query`/`Finish` in that harness use actual framed supervisor
  transport. A session retires/restarts explicitly; raw frames and bounded
  stdout/stderr/process metadata are retained. The private helper currently does
  not expose benchmark latency/RSS distributions; do not infer them from check
  durations.

Root build/run pattern, using a new owned artifacts path and private CLI home:

```text
dotnet build pathfinder-engine/tools/PathFinder.ModelRunner/PathFinder.ModelRunner.csproj -c Release --artifacts-path <new-owned-build-child>
dotnet build pathfinder-engine/tests/PathFinder.BarrierRuntime.Tests/PathFinder.BarrierRuntime.Tests.csproj -c Release --artifacts-path <same-owned-build-child>
dotnet <built-BarrierRuntime.Tests-DLL> --runner <built-ModelRunner-DLL> --work-root <new-absent-owned-run-child>
```

Confirm actual resolved DLL paths from build output; do not invent a bin layout.
The prior39 Windows/39 Linux results belong to B6, not a newly executed B8 run.

### Production session and physical scopes

- `server/pathfinder/engineSession.ts:createSessionEngineExecutor({observe})` is
  the production persistent executor; `EngineSessionEvent` exposes spawn, ready,
  dispatch, result, retire, rss and closed. The default dependencies use actual
  process-tree RSS/group cleanup and are **Linux-only**. A Windows fake
  residentBytes/spawn seam would not qualify the production process policy.
- `createConfiguredEngineExecutor` defaults to one-shot unless
  `PF_ENGINE_MODE=session`; no mode or limits change is implicit. `PF_ENGINE_DLL`
  and `PF_ROOT` are server-owned environment, not client paths. See engine.ts and
  the actual runner-hash helper before constructing the isolated invocation.
- `pathfinder-engine/tools/PathFinder.ModelRunner/SessionProtocol.cs` fixes64
  requests,30s idle,10min lifetime,5s ready,1MiB control,32MiB response and512MiB
  combined supervisor/child sampled RSS. Do not enlarge these for a passing run.
- `SessionExecutionContext` retains one exact fitted planning model and at most
  one qualified barrier scope. `BarrierArtifacts.cs:LoadBarriers` rereads/checks
  manifest and capture file bytes/identity every request, even for a cache hit.
  A context change drops the prior kernel before loading its replacement.
  `preparedReuse=memory` describes the fitted **planning model**, not independent
  proof that barrier qualification or I/O was skipped. Graphs remain per query.
- `requireBarrierEngineStrategy`, strict `engineResponseSchema`, exact length
  ledger and `requireBarrierWriteEvidence` are the production TS guards for real
  responses. Use them in measurement; successful process exit alone is not PASS.

### Historical capacity CLI is a different measurement

`pathfinder-engine/tools/PathFinder.CapacityBench/Benchmark.cs:Calculate` directly
calls original `RouteCalculator.Calculate` plus `CableDesignLength`, not runner v2,
barrier artifacts or production sessions. Its own README explicitly limits warm
repetitions to identical endpoints/category/options, measures one benchmark process,
and notes >100-code synthetic chains do not establish Viewer/Apply compatibility.
Its old claims of one-shot production reflect its historical stage. It can remain
useful Core evidence, but cannot qualify the current obstacle-aware worker/session,
changed endpoints or categories, selected civil geometry, combined512MiB or2140
actual project cables. Do not relabel or overwrite its historical receipts.

## Execution sequence

### 1. Freeze the checked source and reuse evidence honestly

Record actual B7a product and following documentation revisions. Inspect changed
files, hashes and running processes. Confirm pinned11 Core sources and frozen
input/expected/schema files by a fresh **read-only hash comparison**, writing a new
B8 receipt. Never execute a PF0 receipt writer merely for handoff or regenerate
expected values. Preserve originals and all foreign/uncompleted edits.

Reuse unchanged B6/B7/B7a results only with explicit revision/source hashes and a
`reused` scope. Their groups overlap: do not add the counts into a unique total.
Run affected numerical/transport guards at the frozen B8 revision and meaningful
integration checks. Do not repeat the full slow Fluent Tab suite without a new UI
change or unresolved failure just to fill a checklist.

Useful exact targets to select by scope:

- C# `PathFinder.Barriers.Tests`, `PathFinder.BarrierVerifier.Tests`,
  `PathFinder.Constrained.Tests`, `PathFinder.LocalConnectors.Tests`, the actual
  protected runtime harness, original105 regression and43 frozen parity cases,
  existing ledger/direct controls. Use their actual csproj/README entry points;
  ProjectReference remains the only route to production code.
- Shared barrier/admission/runtime/write contracts and identity/session parsers;
  protected Viewer barrier capture/selection/auth/module-closure checks, with
  mocked SDK evidence explicitly labeled as such.
- `server/pathfinder/barrierStrategy.test.ts`, `barrierFreshAdmission.test.ts`,
  `barrierCalculationScope.test.ts`, `barrierWrites.test.ts`,
  `worker-barrier-currentness.test.ts`, `jobs-barrier-history.test.ts`,
  `engineSession.test.ts`; B7 human/initial-fill and B7a store/worker/API/UI suites
  as affected. No ordinary read gains PF admin/model capability.
- Real SQL opt-in suites only against a newly verified owned fixture/config;
  old hard-coded integration controls must not target5191/default5190. B7a has
  real17-table dump/restore evidence,3 Auto tables and identity28→29; verify the
  final report/evidence before citing it as reused. Do not assume its container
  remains running or that tmpfs contents constitute a backup.

### 2. Add the smallest useful protected session benchmark

Prefer a small new **test-only fixture generation mode** in the existing
`PathFinder.BarrierRuntime.Tests` assembly plus an isolated TS driver importing
the actual production `createSessionEngineExecutor`. This avoids copying the
production algorithm or extending the historical Core CLI into an unrelated
certificate. A new helper in that test assembly can access `Fixtures` directly;
the normal39-check mode stays unchanged. Run TS through the repository's actual
tsx dependency after reviewing the installed command. Do not create a new public
HTTP endpoint or Viewer bypass for a benchmark.

Minimum meaningful bounded dataset/protocol coverage:

1. One planning snapshot with64 connected short trays, at most64 unique route
   codes. Include actual supported frozen categories; user calculations exclude
   MV. Use Control/LV and Instrumentation→Control as separate input cases.
2. One raw qualified synthetic barrier set containing a closed tunnel plus64
   disjoint closed boxes placed away from the route:65 computational solids,
   528 source vertices and800 source triangles before any verifier accounting.
   Keep every original inner tunnel face. Store/verify the actual result counts;
   if decomposition refuses, record refusal and diagnose it without filling holes.
   This size is a modest measured synthetic scope, not a representative plant.
3. At least65 successful v2 requests to cross the real64-request retirement
   boundary. Vary at least16 exact From/To combinations and categories/order;
   never present repeated identical endpoints as independence. Deep-clone one
   model identity so warm model reuse is actually exercised.
4. Record at least two real supervisor process identities and actual retirement/
   request ordinals; process recycling must occur without silent replay. Record
   ready/build/disk/memory classifications only for what the protocol exposes.
5. Include a handful of separately measured context-switch and physical controls:
   opening, solid blocking/valid detour, explicit drilling bypass, explicit-empty,
   back to the initial protected context; final scope must match every response.
   Use the known39-check fixtures for exact expected semantics; do not demand
   blocked if the kernel proves a valid detour around a newly changed synthetic wall.
6. At a small subset of distinct parameter combinations, compare full one-shot
   semantics to session output. Compare only identical semantic inputs, excluding
   request identity/timing metadata, and preserve every actual path point, strategy,
   ledger and proof. Independently recheck all successful segments against the
   raw fixture's qualified kernel; no bbox-only opening claim.

Run with default production dependencies inside one new owned Linux fixture,
network disabled, no original mounts, read-only code/build inputs and its own
scratch output. Root verifies image/owner/path/port/limits and available machine
resources before starting. Keep the existing512MiB combined sampled guard; do not
increase limits to hide an OOM, deadline or refusal. A container hard OS limit is
a separate bound; report its exact value and process coverage. Do not call100ms
sampling an instantaneous peak guarantee. Include the Node process separately if
making any whole-executor memory statement; the C# combined supervisor/worker
guard alone excludes Node/API/database/storage/browser memory.

Record source/assembly hashes, exact workload manifest/hash, geometry bytes and
counts, number of distinct endpoints/categories, accepted/refused/timeouts,
completed planned count, cold/startup and warm per-query latencies, median/p95/max
over a declared population, whole elapsed time, actual sampled RSS, restarts,
exit/OOM/join outcomes and raw bounded responses. Failed/timeout cases remain in
the receipt; no successful-only throughput claim. Use an outer finite process/
container deadline and retain partial evidence on failure. Do not infer2140-cable
or maximum-capacity throughput from65 synthetic requests.

Optional2140 synthetic calculations remain a separate explicitly artificial
workload and cannot turn AC-03 into PASS. Only do that if the smaller workload
identifies a useful open question and actual local resources/time permit it.

### 3. Actual civil/counterexample evidence gate

Current source-backed facts are bounded:

- Reports82,86 and87 explicitly say actual converted civil capture/opening survey,
  the photographed Aalborg counterexample and representative2140 capacity were
  NOT_RUN. Their actual accepted mesh/runtime tests are synthetic.
- The exact B6 test fixture generator labels `SourceKind=synthetic` and
  `AdapterVersion=barrier-runtime.independent.synthetic.v1`; its manually supplied
  B2 authority shape is not an actual protected SDK observation.
- A read-only inventory of the known host runtime configuration directory
  `.scratch/batched-capture-runtime-20261018-1600` showed configuration/build-log
  files and no child directories. This is **not inspection of its Docker volumes**
  and does not prove the actual converted model has no walls or openings.
- No broad storage scan, SQL, model extraction, browser action or capacity run
  was performed by the mapping agent. There is no independently established
  actual civil triangle capture in the bounded sources reviewed above.

Root may inspect existing permitted retained receipts/capture references after
verifying exact5191 ownership, with read-only scope. Report the concrete queried
paths/IDs/counts and limits. Do not assert global absence from a filename search,
substitute old tray meshes or use a screenshot to manufacture opening triangles.

If legitimate protected UI access is available through a **new actual permission
change**, capture the explicitly chosen parent wall/floor/ceiling objects including
all unique descendants and original triangles. Validate exact active-model/frame,
units/transforms/geometry completeness and both sides of each opening. A converted
mesh that closes a photographed hole needs corrected input/evidence, not synthetic
repair. Only deliberately registered selected objects are covered; hidden/Ghost
registered objects remain barriers.

Reproduce `=H1=KF1=TAC1=WGA1` using its actual current From/To/shared bindings and
Project Details S/E/P/gap. With drilling off require an exact unobstructed route
on reachable geometry or an explicit blocked/unsupported reason. With drilling
on require explicit bypass labeling. Compare all final segments to actual retained
triangles and exact ledger. Auto may show the checked result; existing Cable list
Routing/Design and installLength remain protected by human Apply. No agent real-data
Apply or invented endpoint/civil mapping.

The saved origin refusal is already known. Without a new permission fact, do not
retry the same request, use native/another browser/origin/CDP or manipulate
permission files. Record AC-01/02/03 as BLOCKED/NOT_RUN with the exact missing
evidence. Continue the independent tasks above and useful independent B9 recovery/
delivery preparation; no false actual-model PASS and no routine stage pause.

### 4. Finish scope-specific reporting and the next assignment

Create report89 and public no-secret B8 evidence with actual product/source hashes,
commands/receipts, precise statuses, partial failures and measured scope. Keep raw
synthetic inputs outside business data; no secrets or business rows in Git. Separate
centreline-only numerical qualification, synthetic runtime capacity, actual civil
coverage, UI access and human engineering acceptance. The64/65 boundary is a session
policy check, not2140 actual project acceptance.

Update automation-progress with active processes/ownership/results and the actual
next useful step. Commit only completed B8 deliveries locally, then apply
prepare-stage-handoff to create a self-contained B9 assignment and execute the
authorized independent portions immediately. A missing actual civil gate remains
explicit and cannot be hidden by a deployment or an empty-barriers declaration.
Do not declare the full Path Finder or queued Simplified Preparer task complete.
