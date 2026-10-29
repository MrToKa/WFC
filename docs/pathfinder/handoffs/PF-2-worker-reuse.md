# PF-2 continuation — bounded private worker reuse

Prepared with prepare-stage-handoff after the verified capacity delivery. Execute
now under the user's standing automatic stage-loop and current continuation
request. This is a measured PF-2 performance remainder, not a new PF-9 or an
engineering acceptance decision.

## Baseline and preserved scope

- Work only in `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
  `pf-2-worker-reuse-local-20261018`, inheriting capacity delivery
  `adcb55da93564571deb0a5bc11ef9921c54c0a53`. Tracked tree initially clean.
  Two inherited denied untracked roots remain untouched. Inspect live status and
  agents; preserve all concurrent changes. No push/PR/merge/deployment to originals.
- [Report24](../24-capacity-baseline.md) records5datasets/65phases/50direct/
  15one-shot queries and four process controls PASS. Real selected26segments:
  fresh-process disk-warm mean1.200s(2), repeated identical same-model median
  0.749ms(8). These are different scopes, not a promised application speedup.
  Query-order/category independence is not established by that benchmark.
- [Current local/live-remote/connector observation](../evidence/capacity/next-handoff-baseline-20261018T1214Z.json)
  records this unpublished branch,25ahead/0behind cached main; separately observed
  live main remains `e1ef20202598bb4d3d78e4772cbbb9747ec23a00`. No candidate remote
  PR/review/CI is established. Canonical PathFinder remains
  `45c24bf5f433f13e102600b36f20327c77961d0a`; old dirty checkout remains unchanged.
- Eleven pinned Core files, Model library, frozen PF-0 sources/fixtures/receipts,
  original checkouts/sources/ and all original13containers/data stay unchanged.
  No Core fork, prebuilt-graph claim, raised limit or synthetic native PASS.
- Existing own5190 APIee402/web1895 demonstration, current data and verified
  archive remain unchanged during implementation/qualification. Use private
  copied inputs and a networkless test container; later actual job checks use a
  separate restored target/database/storage/volumes. Do not Apply or confirm
  human engineering review. No UI/schema feature is needed for this substage.

## Implemented facts and intended improvement

`server/pathfinder/engine.ts` starts one .NET supervisor per request.
`worker.ts` calls it separately for lookup/preview/cable/design. Its DB advisory
lock serializes durable execution. HTTP lookup-plan has a separate bounded lane.
`ModelRunner/Program.cs:92` constructs a new FittedModelCache per Execute;
the cache already keys exact snapshot/rules/limits/engine identity. Core still
builds an endpoint-dependent graph per query. PreparedModel surfaces retain
bounded mutable peer/station proof caches; reuse must be qualified with varied
requests and order, not merely timed identical repeats.

Add one persistent private lane above unchanged Core, preserving per-request
authorization, file integrity, deadlines and publication fences. A cache hit is
never an authorization, settings or engineering acceptance token. Shared4GiB API
memory/PID limits are existing container bounds, not a separate credential or
per-process memory sandbox.

## Ownership and agreed private interface

1. One C# writer owns `pathfinder-engine/tools/PathFinder.ModelRunner/**` and its
   dedicated runner tests. Extract/reuse a validated executor without changing
   Core/Model. One server writer owns `server/pathfinder/engineSession.ts`, scoped
   engine/worker integration and their new tests. Runtime/test owner owns new
   `scripts/pathfinder-session/**` and explicitly coordinated isolated mode/profile
   support. Parent owns docs/progress/report/integration. No overlapping edits;
   writers are not alone and must preserve/adapt to others' work.
2. Preserve old one-shot mode. Add `--session-supervisor` and internal
   `--session-worker`, retaining independent .NET supervisor hard deadline plus
   Node hard deadline/process-group kill. One lane may contain supervisor+child;
   it is not a multiworker pool. Keep lookup-plan HTTP on existing one-shot path.
3. Frames are unsigned32-bit big-endian byte length plus exact UTF-8 JSON, with
   no newline. Ready handshake is closed:
   `{schemaVersion:'pathfinder.engine.session.v1',type:'ready',runnerSha256,
   engineVersion,maxInputBytes:1048576,maxOutputBytes:33554432}`.
   Validate protocol/binary/engine identity before any dispatch. One request in
   flight; concurrent calls refuse immediately, with no hidden queue.
4. Request payloads retain the current private request DTO. The private result
   wrapper is closed:
   `{schemaVersion:'pathfinder.engine.session.v1',type:'result',
   response:<unchanged existing ModelRunner response DTO>,
   session:{requestOrdinal,preparedReuse:'none'|'build'|'disk'|'memory',
   retireAfterResponse:boolean}}`.
   Node validates/unwraps the response and requestId; session telemetry is private
   for lifecycle/tests, not persisted/published as model/proposal data. Final
   C#/server writers must acknowledge one exact schema before editing.
5. Preserve1MiB request/32MiB whole response-frame/64KiB lifetime stderr limits.
   Reject invalid UTF-8, duplicate/unknown fields, wrong IDs, partial/oversize/
   unsolicited/late frames and malformed handshakes by retiring/reaping the lane.
   Stdout is protocol only. No client executable/cache paths or secret logging.

## Cache, lifetime and job safety

- Keep only one prepared input identity in memory, replacing its FittedModelCache
  instance when exact normalized snapshot bytes or exact rules identity changes.
  Leave ModelLimits and cache-key serialization unchanged. Re-read/SHA-check input
  bytes and project/model/content/purpose on every request. Lookup resolves its
  own exact scope before preparation. Category/options/Details remain per request.
  Graph remains per calculation; LoadedFromDisk still describes construction,
  while separate private telemetry proves memory reuse.
- Initial server-owned policies:64dispatched requests,30s idle,10min lifetime,
  5s ready handshake. Recycle before dispatch when remaining lifetime cannot cover
  the request. Preserve existing120s request ceiling and original call deadline
  across startup/retirement; never reset it or silently replay dispatched work.
- Use a sampled512MiB combined supervisor/worker RSS retirement guard, nominal
  100ms, under unchanged existing4GiB/256PID hard container bounds. It is a soft
  sampled guard, not an exact hard per-process allocation ceiling. Report platform
  support honestly; Linux runtime proves actual enforcement. Thresholds are
  provisional policies requiring actual validation, not plant capacity evidence.
- Abort, deadline, resource/protocol/process or unexpected executor faults retire
  and await the entire owned lane, invalidate interrupted state and fail visibly.
  Only the next request can create a new lane. Preserve ordinary domain result
  semantics such as no_path/settings_required. A configured one-shot fallback
  remains available; any automatic fallback is permitted only before dispatch,
  bounded by the original deadline and explicitly tested.
- Inject an executor into executeJob/createPathFinderWorker only while holding
  its existing DB advisory-owner lifetime. Close/kill/join before releasing it.
  Keep all current admin/login, heartbeat/lease/owner-token, dependency and
  principalTransaction publication guards. Cache state never bypasses these.
  Preserve durable recovery attempts/unique publication/idempotency/installLength.
  Stop rejects new work, aborts active work, reaps child, then requeues/finishes
  through existing SQL lifecycle. Keep one-shot default until qualification gates.

## Required actual checks before activation

- Existing affected runner/engine tests plus new strict frame/handshake/bounds/
  busy/deadline/cancel/partial-output/child-crash/idle-count-age/RSS/shutdown checks.
  Use ProjectReferences; never duplicate Core source or regenerate frozen expected.
- Compare complete fresh one-shot vs persistent route/design/category/status
  semantics, every exact point/flag, across A/B/A endpoints, reverse, MV/LV/
  Control/Instrumentation, changed gap small/large/small, approach/sample/SECONDARY/
  allowance settings, no-path/resource cases, ties/parallel attachments, model/
  rules/snapshot changes/eviction, lookup/calculate/design interleaving and different
  request order. Include actual copied selected real input plus honest synthetic
  controls. Prove genuine private memory hits and single-lane identity; do not
  infer reuse from faster timings alone.
- Cancel/deadline/fault followed by valid work must use a fresh safe lane. Verify
  independent .NET deadline and Node kill/join, no late response/extra child,
  output/RSS failure refusal, no hidden retry/deadline reset. Any semantic mismatch
  or unreaped process blocks activation; retain failing evidence/one-shot mode.
- In a separate isolated restored target, prove actual jobs, authority revocation,
  dependency/settings changes, stop/lock loss/crash recovery and unique publication
  under the new mode. No real Apply. Keep5190/original data/container IDs unchanged.
- Measure actual private persistent production requests with validation/serialization,
  cold startup and varied-query warm phases. Report exact source/binary/image/input
  bindings, sample sizes, RSS estimate limitations and all PASS/FAIL/BLOCKED/NOT_RUN.
  Do not label the direct benchmark as an application speedup or whole-plant proof.

## Delivery, cleanup and next handoff

Deliver source/tests, `25-private-worker-reuse.md`, exact receipts under a new
evidence directory, appended matrix and current automation-progress. Make a local
commit without secrets; prepare the next evidence-supported handoff and continue
authorized independent work. Human engineering acceptance and main integration
remain separate decisions; native comparison remains not required by the user.

Preserve demonstration/archive/evidence. Remove only proven new unnecessary own
resources with exact ownership/path checks, no prune. Six denied children and
parents are never retried/bypassed: the four in report23, plus engine/.scratch/
`capacity-bench-build-6134b7566e7a43c9a3bd05843a30018f` and
`capacity-bench-selftest-0e06d25a9f8c459594fe6a376c0660ee`.
The latter2,502,799bytes remain after automatic approval review `blocked by policy`.
The earlier combined startup/health and shell-handoff-overwrite refusals remain
in force. Keep useful independent work moving; do not fabricate missing data,
acceptance, capacities or successful checks.
