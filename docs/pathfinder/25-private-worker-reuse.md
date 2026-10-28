# PF-2 continuation — bounded private worker reuse

Implementation and the scoped Linux process, lifecycle and browser controls are
complete. Final restored-target post-UI data preservation is FAIL_NOT_RETAINED:
the comparison reported a mismatch and the target was retired before its detailed
result was saved. This is a partial technical delivery, not an all-gates PASS.
The existing5190 demonstration remains on its previous images and one-shot mode.
No activation, engineering Apply or acceptance follows from this delivery.

## Revision and behavior

Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
`pf-2-worker-reuse-local-20261018`, baseline
`ed0770f39790fdedf937a190d99908681c11a532` inheriting capacity delivery
`adcb55da93564571deb0a5bc11ef9921c54c0a53`.
The [assignment](handoffs/PF-2-worker-reuse.md) follows the measured capacity
baseline in [report24](24-capacity-baseline.md). Local source changes remain
unpublished. No push, PR, merge or original installation update is performed.

The server can retain one private .NET supervisor/compute-child lane under its
existing database advisory-owner lock. `PF_ENGINE_MODE=oneshot|session` selects
the durable worker executor; the default is still one-shot. HTTP lookup-plan
retains its separate existing one-shot lane. The private ready/result protocol
uses bounded BE32 length-prefixed UTF-8 JSON and the unchanged production request
and response DTOs. Session lifecycle telemetry is unwrapped privately and is not
persisted as proposal or model data.

One prepared input identity is retained at a time. Geometry requests re-read and
hash the immutable snapshot before fitting/cache reuse; changed model/snapshot/
rules replace that cache instance. Category, endpoint options and Project Details
remain per-request. Design-only reuse intentionally uses the existing server
snapshot and dependency checks; lookup-plan needs no geometry snapshot. A cache
hit grants no authorization or engineering acceptance. The unchanged Core still
builds its endpoint-dependent graph per calculation. This delivery does not claim
a globally prepared reusable graph or whole-plant capacity.

Policies are64dispatched requests,30seconds idle,10minutes age,5seconds ready,
the existing120second request ceiling,1MiB input,32MiB whole result frame,
64KiB lifetime stderr and a nominal100ms512MiB combined sampled RSS guard.
Sampled RSS is a sequential estimate which can miss short peaks; existing shared
4GiB/256PID container limits are the hard boundary, not a separate process or
credential sandbox. Actual session mode requires Linux process-group/RSS support;
unsupported platforms refuse it. One-shot behavior remains available.

Only one call is admitted; concurrent calls refuse immediately. A dispatched
request is never silently replayed or retried. The original caller deadline spans
startup and retirement. Fault, abort or deadline retires and joins the owned group
before another lane can be admitted. Failure to reap poisons the executor and
retains a healthy advisory connection until backend termination. If that database
session has already been lost, PostgreSQL has released its lock: the code still
stops this worker and preserves publication fences, but cannot promise global
quarantine against a different backend. Shutdown reports
failure instead of returning successful exit status after a failed runtime stop.
Current auth, lease, dependency, publication and Review/Apply fences remain in
the existing server transactions; install length is unchanged.

## Source and independent review

[Final C# source/build/check receipt](evidence/worker-reuse/runner-source-final-20261018T124105Z.json)
binds ModelRunner DLL SHA256
`0a421550ac7e01a7e4659a543927cb5fd20eacac7a9cc687cc08c812a5b8c56a`:
308/308 dedicated checks and42/42 one-shot controls PASS. Thirty-one synthetic
semantic cases compare the complete decoded response except requestId and the
construction-only `prepared.loadedFromDisk` diagnostic. All numeric route/design
fields, ordered points/IDs, readiness and diagnostics remain exact. No expected
fixture is regenerated; tests reference the production projects.

The [final server receipt](evidence/worker-reuse/node-source-checks-1792327583530.json)
records55/55 affected cases, server types and scoped lint PASS.
`engineSession.ts` SHA256 is
`5cfa14c83dd0566009baecaf757ed1698f0c339043faaff48b24d36eb84a4513`.
The [closing server review](evidence/worker-reuse/server-cross-review-closed-20261018T124041Z.json)
and [closing C# review](evidence/worker-reuse/cross-review-closed-1792327496205.json)
find no remaining material issue at their explicitly recorded read-only scopes.
Reviewers inspect source and owner evidence; they do not claim independent reruns.

Both material findings and their original failed receipts are retained:

- A partial pipelined prefix/payload could wait undetected while a result was
  emitted. First-byte activity is now observed while busy and checked again
  immediately before forwarding. Actual open-input partial-prefix/partial-payload
  controls emit no false result and join. An immediate legitimate next request
  after receiving the prior result still succeeds with memory reuse.
- Abort or the original deadline could arrive while a valid response awaited
  group retirement. A common post-join guard now refuses late success. Two
  targeted cancellation/deadline-during-delayed-join checks PASS.

An earlier final-child RSS read race is also corrected: only proven child exit
can suppress a raced monitor read failure. Live unavailable monitoring still
fails closed. Three actual64request retirement sequences pass the C# suite.
Historical intermediate151/165/303 counts are not added to the final308 count.

## Actual qualification

The compiled production Node executor and final C# binary have completed these
network-none controls. The [210-check summary](evidence/session/summary-1792328175307.json)
links exact raw results, orchestrations and hashes; bounded deadline work uses a
separate additive bundle, preserving the original completed/running inputs.

- PASS117checks/100calls:31synthetic cases in forward and reversed case order,
  full decoded DTO parity, real current-reference route/design, real A/B/A
  endpoints and private same-PID memory-hit observation. Largest sampled tree
  RSS estimate198,942,720bytes. No end-user throughput claim is inferred.
- PASS77checks/69recorded successful calls plus deliberate failures:64+1count
  recycling, actual31.5second idle, immediate busy refusal, abort/crash rejection,
  whole-group reaping and fresh safe next-lane recovery.
- PASS4checks: actual test-fixture RSS threshold crossing, visible refusal and
  whole-group reap. Sampling can miss the maximum; exact peak is not established.
- PASS4checks: actual601,071.96ms lifetime observation with regular keepalives,
  retirement, complete group reaping and a new lane. The10minute policy is used.
- PASS8checks: an actual dispatched warm1ms runner deadline returns
  `deadline_exceeded`, reaps and recovers. A separate test-only warmed no-response
  fixture exercises the real Node hard guard at1,600ms for a100ms request plus
  its existing1,500ms guard margin; group reaping and next real runner succeed.

All five final disposable containers are retired; source API/PG identity/mount
checks pass. The first deadline attempt had a receipt-only label collision:
detail.status overwrote a PASS label. Its raw result and original orchestration
are preserved as historical, while the bounded corrected rerun passes8/8 with
unambiguous check labels. No production byte changed for this harness correction.
The initial fifteen methodology controls and the affected isolated Compose/profile
[19controls](evidence/worker-reuse/parent-profile-checks-20261018T1252Z.json) PASS.
Later methodology controls total23/23. Separate restored5191 durable job and
lifecycle checks are recorded below; their preservation limitation is explicit.

The first restored job driver passes10/10 controls at API323f876a:256new owned
fixture cables, current-role/login revocation during an observed running batch,
Settings proposal-ID delta staleness, cable dependency edits, deliberate expired
lease recovery, a separate actual active-owner rollover, cancellation and unique
publication. Exact Core instruction timing and per-proposal owner attribution
are not instrumented; the receipt states those limits. No Review/Apply or seed/
copied real-workflow change occurs at this earlier driver scope. The final
source-bound retake is recorded below.

The actual advisory connection-loss gate then finds a material failure: after
uniquely identified own PostgreSQL backend438 is terminated, API323f876a exits1
on an unhandled repeated Client error. The [failed operational attempt](evidence/session/target-ops-1792328401607.json)
and [sanitized context](evidence/session/lock-loss-failure-context-1792328499372.json)
remain unchanged. That attempt separately verifies the rebuilt Linux DLL's real
35.30345579516123m/design45 and full DTO repeat/memory hit before the lifecycle
failure. It does not prove graceful stop or crash recovery. Runtime qualification
was held for a minimal worker listener lifecycle correction. Only5191 is affected.

The [correction and61affected checks](evidence/worker-reuse/pg-owner-fix-1792328904528.json)
bind final `worker.ts` SHA256
`3ce7708dd65a9571571f962a4380163c11bc1433a8494893e21e1d8c9c26377f`.
A persistent error listener starts before the lock query, remains through engine
join and damaged-transport close, and the known-damaged client is discarded.
Healthy return hands off to pg-pool before removing only this owner's handler.
Unsafe close retains the connection/handler and surfaces fatal stop. Repeated
errors during join/end, early connection error, failed lock/unlock/terminal close
and healthy handoff controls pass, with types/lint. The
[independent closing review](evidence/worker-reuse/worker-owner-listener-review-20261018T130804Z.json)
has no remaining material finding and records the lost-session limitation above.
The earlier55case source receipt remains historical. C#/protocol/transport bytes
are unchanged, so the exact210measurement checks are retained at their recorded
scope; the new target image/job-driver/operational retake is recorded below.

The [corrected target readback](evidence/session/target-startup-corrected-1792328961877.json)
binds API5cd3eca8/web4d6022fa, unchanged DLL4b940d5c and compiled engineSession
bytes, plus the corrected compiled worker. The unchanged
[job driver retake](evidence/session/job-controls-corrected-1792329096322.json)
passes10/10 in65.478seconds with fresh256owned fixture cables/9jobs, including
218subsequent-ID Settings proposals all stale. Previous rows, seed fields and
all12copied real-workflow groups remain unchanged. The same-byte six guard tests
are reused explicitly, not counted as a new execution. Actual corrected
lock-loss/graceful/crash and browser controls are recorded below. These earlier
12-group comparisons do not prove final post-browser target preservation.

The [corrected operational receipt](evidence/session/target-ops-1792329135705.json)
contains21passing individual controls: exact real semantics, actual advisory
backend termination, lane join while API remains healthy,5.2seconds without worker
reacquisition, explicit restart/new owner, and graceful exit0 in507.249ms with
advisory release and stopped namespace. Its original aggregate remains FAIL:
the legacy64helper misses the live observation window and reports NOT_RUN. It
does not become a crash PASS retroactively.

A faster separate observer actually interrupts an unfinished batch, but its
[first attempt](evidence/session/crash-once-1792329339791.json) wrongly requires
an item to remain `running` after KILL. Saved state is running4/64 between items,
not a completed batch; an initial operator inference to the contrary is corrected.
That attempt aborts/cancels before recovery and remains FAIL. The bounded
[corrected actual crash](evidence/session/crash-once-1792329583015.json) passes9/9:
observed0/64 with a running item and exact supervisor/child pair, actual namespace
SIGKILL, persisted16complete+1running+47waiting with the same old owner/attempt,
then natural recovery to attempt2/all64calculated in29,001ms. Exactly64distinct
proposals, unchanged routing/design/install77/write revision, current authority
and absence of old host PIDs are verified. There is no SQL lease edit, fake
engine delay or automatic engine replay; this is an explicit new test job.

[Seven read-only closure checks](evidence/session/crash-closure-amendment-1792329745335.json)
confirm counter coherence and NULL-safe calculated statuses. The first closure
aggregate wrongly requires an optional replacement-owner UUID and is preserved
as FAIL. Completed jobs clear that token; its exact new UUID is NOT_RETAINED,
while actual attempt increment/recovery/unique completion are proved. No new crash
or calculation is run to correct this scope. Final methodology controls are23/23;
the earlier15case measurement methodology receipt retains its historical scope.

[Actual computer-use UI verification](evidence/session/browser-check-20261018T1324Z.json)
confirms outer Path Finder and Routes/Path/Path lookup, English text, protected
model664,556geometry/438,156identifiers and a real standalone Control path using
the existing shared QA endpoints. It displays35.30345579516123m, four gaps totaling
0.9840583861033791m and design45m using current Details1/3/5/10. Filled Ghost,
original route colours and yellow path are visible; Clear removes the path/result
and restores the opaque whole model. [Route screenshot](evidence/session/viewer-path-session-20261018.png)
and [Clear screenshot](evidence/session/viewer-clear-session-20261018.png) are saved.
Only the extra5191 tab was opened/closed; no original/5190 UI interaction, Review
or Apply occurred. This is visual/functional evidence, not engineering acceptance.

Actual real A/B/A fresh wall times are1,206.875/1,270.121/1,199.881ms (median
1,206.875ms,3samples). The session's first A is1,277.774ms; changed B233.885ms
and repeated A151.882ms (warm median192.884ms,2samples). These include private
validation/serialization/IPC and active process sampling; genuine same-PID
memory reuse is observed independently. Samples are small and confined to the
selected26leaf network. Fresh RSS is NOT_MEASURED in this harness, and no
application-wide latency/throughput or whole-plant guarantee follows.

[Separate target startup](evidence/session/target-startup-1792327913104.json)
records direct restoration of unchanged archive3db9fa33 to its own5191 database,
storage and volumes, API323f876a/web511ba97e and actual session-mode environment
readback. The Linux rebuilt DLL differs from the host qualification assembly's
build metadata; it requires its own actual semantic checks. The5190 runtime,
environment file, current images and working data are preserved throughout.

The test-only MemoryLane fixture crosses the RSS threshold with an owned touched
allocation; it is never production code and proves the guard branch only. Its SDK
first-run output mentioned certificate installation/ensure. The only inspected
matching certificate predates this build; no prior store inventory exists, so
actual store creation is UNKNOWN. No private key was read or certificate removed.
Later builds suppress generation. [Environment receipt](evidence/session/sdk-environment-1792326425587.json).

## Acceptance and cleanup boundary

The [retirement checkpoint](evidence/session/cleanup-checkpoint-1792330908283.json)
preserves a significant operator sequencing error. The final post-UI comparison
reported a mismatch, but its returned12-group object was not saved before an
assertion threw. Retirement then ran without conditioning on that failed result.
Only the disposable5191 target was removed; its database is no longer available
to identify the changed group. Final target workflow equality and database-level
noApply after the browser check are **FAIL_NOT_RETAINED**, not PASS. Earlier
driver/operational checks retain only their own recorded scope. The browser
interaction itself never requested Review/Apply. No recreation or replay is
presented as recovery of the lost observation.

The exact qualified Linux runner/dependencies and compiled PF modules were saved
first:50files/851,629bytes, manifest2bd5ec7d0bb85f38996e8b7ac71c0c0c3a936e9f2665b93cee13ea58c3e63001.
The owned5191 target's5containers,4volumes and2networks are retired. The
[final read-only primary audit](evidence/worker-reuse/preservation-1792330963032-1cb78243.json)
passes12/12: all12 source5190 workflow hashes/counts, all18 baseline container
identities/images/start times, source/copied geometry and denied-path presence
remain unchanged. This separate positive result does not repair the missing
disposable-target observation. The fresh
[five-group source isolation check](evidence/pf2/isolation-1792329686848.json)
also passes at its recorded source-set scope.

[Final cleanup](evidence/session/final-cleanup-1792331030292.json) also removes
four unreferenced candidate images after ownership/reference checks,479,405,178
logical image bytes; actual disk reclamation is NOT_MEASURED. No general prune,
scratch-directory removal or source5190/archive mutation occurs. The
[final source inventory](evidence/session/final-source-inventory-1792331030290.json)
binds current production, test and runtime-tool files, separately from the
qualified compiled-artifact manifest. Required captures/corpus/evidence remain.

Human route/length review remains PENDING. Native comparison remains
NOT_PERFORMED / NOT_REQUIRED_BY_USER under the explicit user decision. Selected
converted geometry and synthetic controls do not establish complete plant/source
transforms, equipment identities, engineering tolerance or capacity. No real Apply
or main integration is performed.

Keep5190, its verified archive, required evidence and final reproducible inputs.
Remove only newly created, verified disposable owned resources after their checks.
All six previously denied children remain untouched; no retry or parent deletion.
The two latest denied build/self-test directories retain2,502,799bytes after
automatic approval review returned `blocked by policy`; the earlier four are
listed in prior reports and the current handoff.
