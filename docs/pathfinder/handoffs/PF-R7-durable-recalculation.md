# PF-R7 — durable coalesced recalculation and exact proposal provenance

Status: **READY FOR IMMEDIATE EXECUTION** after this metadata handoff commit.

The user separately authorized immediate sequential implementation through R10.
R6 is technically committed at the scope below. Create an inherited local
`pf-r7-durable-recalculation-local-20261019` branch after this handoff commit and
execute immediately without a routine stage pause. The prompt is not itself
implementation, R8 background authority or engineering acceptance.

## 1. Purpose, source baseline and required root reconciliation

Implement accepted plan32 R7: meaningful engineering changes become durable,
coalesced requests for calculations against the latest complete coherent scope.
Ready cables receive proposals with exact provenance. Superseded results remain
history; they cannot acquire Review/Apply authority. No automatic Review/Apply.

Workspace: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
R6 started on `pf-r6-model-revisions-local-20261019` at
`b22c1f2d7bf95e01407b540994ccd5fbf1787118`; R5 technical commit is
`c9d42429077c5be415eb3d71aa7ee458eb568fd9`.

Verified R6 technical commit **0c4937d0c0667c252259ebe672389f96fc1fe573**:92files/6670insertions/29deletions.
At 2026-10-19T04:39:43.658Z, branch pf-r6-model-revisions-local-20261019, no tracked working changes; only the
historical denied .pf0-work/.pf2-work and new metadata receipts are untracked.
Cached origin/main comparison0behind/57ahead is local cached evidence only.
This handoff is the following metadata commit; inspect actual HEAD after commit
and branch from it, never reset to the earlier R6 starting commit.

Fresh configured GitHub GET at 2026-10-19T04:39:03.669Z confirms WFCmain
e1ef20202598bb4d3d78e4772cbbb9747ec23a00 and PathFindermaster
45c24bf5f433f13e102600b36f20327c77961d0a;0remoteR6refs/0PR. Unpublished
candidate CI/review NOT_ESTABLISHED. See evidence/revision-comparison/
handoff-local.json and handoff-remote-r7final.json.3referencecheckout branches/
HEAD/status/trackedpatchhashes remain exact, including old PF localchanges.

Report **42-r6-model-revision-comparison.md** and its revision-comparison evidence
record combined93files1439PASS/0FAIL/5optional lookup-worker NOT_RUN. Final narrow
latest-overall-intent recovery/no-op correction:62scopedPASS/freshservertypes/lint.
Actual15rollback-onlyPGmechanicsphases/11HTTPedges, normalUIold/currentBC001
8→9objects/17unresolved/11candidateedges/0matches, exact/semantic API replayPASS.
Actualv4controls9syntheticproposals/6stale/6Review409refusals/3finalsuccessfulroutes,
normalpreview7.478969923197742m/InstrumentationControl, yellow/filledGhost/opaque/
Clear and finalreloadPASS. No realphysicalmapping/frameacceptance/Apply. Latest
recovery fixture test is not an actual injected DB recovery sequence.

Strict final auditPASS all110tables:64oldtables byte-for-value rowmultisetexact,
36receipt-qualified oldtable deltas,10newcomparison tables reconciled. All63old
PF_ROOTfiles13834192bytes exact/all51newfiles closed by references/cachehashes;
114files17384086bytes final.1374oldstorageobjectmetadata exact/173newresources
rawSHAverified/1547total. Two conservative classifierFAILs retained beside exact
wrapper/auth/job/cache/catalog reconciliation. No ordinary business/cable/Details/
Review/Apply/drawingpolicy field changed. Four exactNEW completed synthetic
calculation jobs were normalDELETEpaused solely to quiesce final audit; all52old
jobs preserved. No R7enrollment exists yet; do not treat this pause as R7authority.

Final candidate4 source context
6374a1493beb3dd783d1e7841d52d7f3fe70e400c8a769aff47c6da0b539b203/1378files/
1214non-docfiles; APIimagecae50e6368f5d26a7959ce7e265025b60b2ca1c7db29cff63efedaffafddd1b9,
Webimage39225998e73df4d2226ef5808d5f323f1417ec12b072e50bbc0559f1527f47ee.
APIcontainer9cd8072c556f5c3322acd64ce41a5b58e612bb5511eb2a2bbbd18a57df115b19,
Web81df32517a4d50efc04700696039ef2d308b9879d9256e95275fbf207648d100.
Owned R6work .scratch/tray-catalog-28d3491f-e33c-46cb-95c9-d72688340ba5 holds
operator default r6-approved-runtime6.private.json; this exact descriptor is the
source for a NEW R7ownedwork/profile, not reusable wx phase labels. PG/MinIO/
storage-ready/4volumes/2networks/18outsidecontainers remain exact.6unusedownR6
candidateimages removed; no newtestcontainers, no deniedpath retry/prune.
Checkpoint469c37ef-ff35-4e76-985d-19e59d8f57f2 retains8members/4images/verified
dumpTOC/1368baseline raw-hashedmodelresources and separateprivatecompanion; full
restoreNOT_RUN. New R7schema needs its own consistentcheckpoint/baseline.

Read applicable AGENTS, plan32 sections3/R7–R10, R0
`geometry-revision-contracts.md` sections6–9, R0 examples/specification/validation
matrix/reference catalogue, final reports40/41/42 and R6 handoff. Preserve frozen
expected data; PF0 receipt-writing tools are not handoff-read commands.

## 2. Isolation and current capability boundaries

Root remains the sole actual Docker/runtime/SQL/HTTP/browser/engine executor.
Other agents edit separated source files, run permitted pure checks and review.
No original WFC/old or canonical PF checkout/synced `sources/`/5190 changes, no
push/PR/merge/deployment, no generic Docker up-all/prune/retire, no arbitrary
cleanup and no automatic business Apply. Preserve all concurrent work and all
historically refused scratch children/parents/Temp paths. Never retry a refused
delete through another path/tool.

The owned demonstration is loopback5191, owner
`8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, Docker project
`wfc-pathfinder-local-0cba87606e9b`. Root must load the final approved exact profile,
not reuse an old image/operator phase or infer a container ID. Protect this demo
explicitly even though it originated as a restore. Only reviewed owned API/web
replacement is allowed; preserve PG/MinIO/volumes/networks/resources and outside
containers. Obtain a new consistent pre-R7 checkpoint with verified private
companion and a complete fresh baseline before schema/runtime mutation.

Retained synthetic UI project56eadef6-8382-49f8-a652-c8f12026602e has3R5cables/
1type/3existing locations/testDetails0/0/0/gap1. Originalactive model
098a7e6f-6e39-4935-a98b-ba3b683875a5, selection3, current aggregate
adfd8568-327d-4487-9279-dddd3c344055/geometry5/catalog3/trace
c7a0fe81-a9da-4314-b871-1e37773fdf79/frame7b695d22-5c67-443a-a587-538e3cba4cd2.
Older versionc9810c49-cf53-450c-9667-516894b2a509/173resources is retained once.
Currenttargetcomparisona2dafdd9-4d7e-4b9c-99cc-b7218503e773/counter3 remains
diagnostic/unqualified. Exact private3point baseline/restore and seed manifests
are retained; do not repeat seed/import/one-shotcontrols. NormalUIadminac288aa9-
eb51-4dd6-872b-ec52dfeecbc9 differs from fixtureactor9ac1ea26-8bee-4719-87c5-
1693df5682b4; obtain valid currentlogin normally, no invented credentials.
Copiedbusinessproject1af0f807-7653-40ea-8391-7eea6c54e7d4 has330trays/2140cables/
51types/Details7/5/10/gap1, no invented realbindings/lengths/Apply. Browser2/tab6
handlepfr1Page is current5191UIprojectPath, normalmodelloaded; rewriteCUAdocs after
compaction. Preserve it, snapshots/ZIP/archives/privateevidence.

Level A is this stage: after protected Viewer preparation and required explicit
binding/review work, calculate from the published coherent scope while a current
enrolled administrator login authorizes it. A closed browser after preparation
does not itself invalidate an unexpired login, but R7 promises neither new
closed-browser extraction nor indefinite autonomous authority. R8 owns explicit
calculation grants and a separately qualified managed geometry producer.

R4 facts remain immutable observations: source/document/instance/logical identity,
object-local basis/intrinsic/placement signatures and a common engineering frame
can be unavailable. R6 manual correspondence and reviewed frame evidence are
explicit human decisions; they do not qualify real object-local Follow or native
equivalence. Pending geometry/ambiguous bindings/unavailable evidence must remain
concrete blockers, not fake successful calculations or zero-valued origins.

## 3. Existing implementation to reuse, not repeat

Inspect live versions before editing; the following behavior was source-mapped:

- `server/pathfinder/worker.ts`: advisory-owned serialized engine/cache lane,
  job owner/lease fencing, one-second authority heartbeat, cancellation, three
  interrupted recovery attempts, dispatch/completion dependency checks and
  immutable proposals. Preparation shares the lane; do not start a second engine.
- `jobs.ts` / `jobsSchema.ts`: bounded10,000-cable jobs, blocked items, progress,
  force retry, request-hash dedup, immutable results and explicit human Review.
  `apply.ts` already checks current authority/dependencies/cable write token,
  atomically writes routing/design and preserves installLength/history.
- `dependencies.ts`, `jobContracts.ts`, `routingScope.ts`,
  `endpointCalculationProvenance.ts`, `comparisonCalculationProvenance.ts`:
  strict current v4 scope includes model/selection, trusted aggregate/frame,
  routing-only policy/catalog, exact endpoints, target-specific comparison scope,
  Details/options and cableWriteRevision. v2/v3 are historical, not new authority.
- `settings.ts`: Details is authoritative. Gap is projected to RoutingOptions;
  S/E/P remain the existing strict C# decimal design DTO. Instrumentation→Control
  and all native Core math/guards/ties/double-to-decimal/SECONDARY behavior remain.
- `worker.ts` already chooses C# `design` when an exact geometry hash finds a
  successful retained route. `mergeRetainedGeometryResponse` preserves its path,
  diagnostics and original category; missing original preferences force refusal.
- `previews.ts` has an independent transient diagnostic preview lifecycle/v4
  dependencies. Ordered lookup is diagnostic. Neither creates authoritative
  shared bindings or bypasses R7/project planning policy.
- `engineSession.ts`, `preparationEngineLane.ts`: bounded process/transport,
  duplicate-safe messages, cancellation/terminate/join and ownership quarantine.
- `src/pages/ProjectDetails/PathFinderResults.tsx` currently starts browser-local
  automatic calculations from an in-memory key. `hooks/usePathFinder.ts` polls
  jobs/proposals at2s while running and otherwise15s, with current access/model
  fences. Retain useful UI/results/Ghost/Clear behavior while removing duplicate
  scheduling authority.

R7 gaps in the existing automatic path:

1. `worker.automatic()` scans only the latest COMPLETE calculation job with an
   unexpired originating login every15s, five project rows with a cursor. No first
   job means no producer. There is no durable event/dirty/coalescing/enrollment
   state. Failed/cancelled latest jobs can pause later automatic work.
2. Browser and worker both create work. Dedup is scoped to actor+login+requestHash,
   so two valid logins may create equivalent engineering work. Lost-create ACK
   followed by changed inputs is not an exact-command receipt protocol.
3. Worker FIFO claims a job then loops all its items before yielding. Fairness is
   currently at job/preparation boundaries, not bounded per-project work quanta.
4. Dependencies retain a static engineVersion label rather than a complete actual
   four-DLL/rules/projection fingerprint. R4 fingerprint helpers are a lead, not
   automatically the correct R7 computational projection.
5. No durable latest desired generation/blocker reason survives restarts. Generic
   statuses do not fully distinguish preparation/comparison/settings/location
   pending versus no path/deadline/cancelled/authority expiry.

## 4. Required implementation

### 4.1 Durable events, coalescing and conservative impact

Add server-owned durable project desired generations/events with exact reasons,
source revision references, timestamps and bounded retention/paging. Emit/update
them in the SAME protected transaction as meaningful engineering mutations:
trusted preparation publication, routing catalog/permissions, confirmed shared
binding, current comparison decision/token, engineering Details/options, manual
or imported cable inputs. Model selection may mark Geometry pending; it cannot
manufacture a current aggregate. No stale artifact may be blessed with new tokens.

Rapid events coalesce to the latest complete coherent dependency set. Snapshot a
desired generation, collect ready/blocked cables under coherent current locks,
then publish/enqueue one logical bounded batch. Completing old work must never
clear a newer desired generation. Preserve superseded jobs/results as history.
If dependencies are pending, persist a precise blocker and retry only on a
meaningful new generation/explicit retry/bounded backoff, not repeated all-blocked
COMPLETE jobs every poll. A persistent pause/cancel has an explicit resume policy.

Initially reroute every ready project cable for uncertain connectivity/category
impact. Added permission/new shortcut can improve routes that never used the
changed tray. Do not filter only by previous routing membership. Shared binding
changes cover both endpoints/all aliases/all cables; uncertainty expands scope.
Category/component narrowing requires positive proof and is not required first.

Drawing-only policy, tray dimensions/material/grounding/trefoil/bundle/divider,
full-catalog audit snapshots and declared length changes do not create PF events
or engineering staleness. Audit nested manifest/trace/plan hashes as well as top
level fields; do not accidentally import full-source/drawing/audit identity into
the functional routing/design hash.

Classify PathFinder's own routing/design Apply outputs separately from new cable
engineering inputs. Apply must still advance/check cableWriteRevision, but that
output-only write must not form a perpetual proposal→Apply→recalculate loop.
Manual/import edit-then-restore still invalidates authority through its write
token. Do not weaken cable-write fencing merely to make dedup appear stable.

### 4.2 Bounded current-login enrollment — not an R8 grant

Provide explicit current-admin enrollment/request for Level-A automatic proposals
without requiring a prior completed job. A proposed new API family is
`/recalculations` with context/status, enrollment, pause/resume and explicit retry;
freeze exact fixed paths/shared DTOs before parallel edits. Do not reuse a generic
arbitrary URL command surface.

Enrollment records project/actor/login identity, server-verified login expiry,
enrollment revision/epoch, finite expiry, bounded calculation preferences/limits,
enabled/paused state and exact command receipt. No administrator bearer is stored.
Expiry cannot exceed the signed current login or a fixed short server limit;
freeze that limit before coding (suggest30min initially, never indefinite).
Bound active enrollments to one per project/login and at most one claimed
automatic logical generation per project. Bound projects/page, cable/page, request
bytes, work quantum, attempts/backoff and cleanup/retention explicitly. Reuse
existing10,000-cable request bound or introduce coherent paged batches with exact
union/cursor identity; never silently select an arbitrary subset.

Every enrollment/read/write and dispatch/final result publication checks current
admin, login revocation/expiry, project and epoch. Engineer edits may record dirty
events but do not grant calculation authority. No enrollment/current login means
Awaiting administrator enrollment, not an invented worker principal. Revocation
or expiry stops/rejects queued/running automatic work and leaves a precise state.
Restarts may recover only still-valid enrollment/claims, never revive expired
authority. Enrollment cannot Review/Apply, extract arbitrary resources, create
engineering acceptance or mutate another project.

### 4.3 Versioned provenance and actual engine identity

Introduce strict `pathfinder.dependencies.v5` when adding the engine/provenance
fields. Keep v2/v3/v4 historical readers; new admission/dispatch/completion/Review/
Apply must agree on the new version. Never mutate the strict C# runner v1 DTO or
spread main-state objects into it. Continue projecting only supported exact
From/To points/category/options/Details to unchanged mathematics.

Freeze complete current preparation/geometry/routing policy/bindings/comparison/
settings/options/cable inputs and actual relevant engine implementation facts:
runner/model/core/adapter DLL digests, rule/fitting/numeric/projection policy
versions and supported options. Resolve canonical regular module paths and
recheck implementation identity at required boundaries. Avoid reading/hashing
four DLLs once per cable in a10,000-cable loop; use a coherent bounded admission
fingerprint/service and verified reuse policy. A static version label alone is
not proof of unchanged binaries.

Keep immutable full evidence references as provenance where needed, but use
explicit validated engineering projections for functional reuse/invalidation.
Drawing/full audit facts must not enter transitively through trace/manifest SHA.
Do not drop real authority tokens when separating these domains; refuse unsafe
reuse when unchanged engineering inputs cannot be positively established.

Proposal envelope v2 should expose job/dependency/proposal hashes, old accepted
receipt/model/result when available, exact new engine result, relevant comparison
reasons/currentness, full-route versus verified design-only calculation mode,
retained diagnostics/readiness and explicit human review state. Result bytes and
dependencies bind the hash. Historical results stay inspectable with historical
provenance and no new Apply authority. R9 owns richer grouped delta Review/Apply;
R7 must keep existing fresh single-proposal Review/Apply safe now.

### 4.4 Design-only reuse

Only S/E/P allowance changes may reuse an exact successful retained route when
model/preparation/geometry/ownership/policy/gap/options/endpoints/comparison and
relevant implementations are positively unchanged. Retain original route points,
order/ties, actual length/distances, SECONDARY flags/replacements and diagnostics.
Use the C# design operation with current Details. Never multiply a rounded prior
designLength or replace geometry with an approximate browser result.

Gap, endpoint/mode/evidence, policy, geometry, frame or routing preferences require
a fresh search. Missing retained route/options/category/diagnostics requires full
calculation or explicit blocked status, not guessed defaults. Preserve end reserve
once before percentage, exact decimal behavior/final ceiling, real gap accounting
and Details-authoritative gap default1m.

### 4.5 Lifecycle, fairness and operational UI

Integrate with the existing serialized engine lane, owner fencing, heartbeat,
cancel/terminate/join and lease recovery. Never release/reuse a lane whose owned
process/worker termination is unconfirmed. Record bounded attempts/backoff and
work progress durably. Yield after a fixed item/time quantum so a large project
cannot monopolize other projects or preparation indefinitely; preserve already
completed items and deterministic cable/input order.

Logical automatic identity binds project, ordered bounded cable scope, calculation
mode and coherent dependency identity, independently of which valid login wakes
the same work. Human force retry is explicit/audited and must not create concurrent
owners or a duplicate Apply. Exact lost-ACK replay precedes new CAS after current
authority; same key/different body conflicts. Cross-login semantic dedup must not
return another actor's credentials or give an expired/revoked actor authority.

Use English stacked status/progress/reasons in the existing Path tool. Distinguish
Waiting for geometry/comparison/endpoints/settings/admin enrollment, queued,
calculating, superseded/stale, cancelled/paused, no connected path and limits.
Frozen unknown commands retain exact body/key and explicit reconciliation.
Project/token/model/selection/generation changes discard late UI responses; never
send historical object IDs/points to the current viewer. Preserve3tools, yellow
path, original colours, filled Ghost, Clear and protected bridge limits. Existing
human Review and Apply remain explicit, fresh and separate from automatic success.

## 5. Ownership and sequencing

Agree versioned shared DTOs, semantic dedup/enrollment/transaction-client seams,
limits and lock order FIRST. Suggested nonoverlapping assignments:

- A: NEW shared recalculation/enrollment/proposal-v2/v5 schemas and pure dependency
  projection, event coalescing/impact/design-reuse planner plus synthetic tests.
  No database/runtime imports. Coordinate actual fingerprint facts with root.
- B: NEW recalculationSchema/Repository/Producer/Routes and mock/control harness
  files. Durable generations/enrollments/claims/receipts/status and caller-client
  event hooks. Heavy work outside locks; exact final coherent recheck. No edits
  to existing core worker/jobs/app/schema without root assignment.
- C: NEW fixed-path API/hook/status panel/fixtures/tests. Minimal existing UI edits
  only after root assigns them. Server-owned automatic status replaces duplicate
  browser scheduling; preserve existing tools/results/model fences.
- Root: sole existing app/runtime/schema/routes/repository/policy/binding/
  preparation/comparison/settings/jobs/worker/dependencies/jobContracts/Review/
  Apply and PathFinderTab writer, actual runtime/SQL/HTTP/browser/checkpoints,
  verification/docs/local commit. Serialize overlapping integration.

Inspect current source rather than duplicating already implemented functionality.
Retain old job/proposal/review/apply rows. Disable/coherently adapt the old
`automatic()` and browser effect for projects using the durable producer; two
independent producers must not race. No new SDK geometry decoder or producer in
R7. Freeze all Docker-context writers before root's full-context build.

Useful existing tests: dependencies/settings/worker-retained/worker-session,
engineSession/preparationEngineLane, jobs/Apply integration, endpoint/comparison
provenance, usePathFinder/PathFinderTab/PathFinderResults. Preserve frozen Core
and all strict mathematical fixtures; extend only meaningful new boundary cases.

## 6. Acceptance and verification

Record PASS/FAIL/BLOCKED/NOT_RUN with exact source, inputs, revision, limits and
receipt scope. Counts overlap; do not add unrelated suites or carry old PASS into
new code. Root alone performs real fixture/runtime checks and owns mutable scheduling.

1. One logical engineering change produces one latest durable generation and one
   semantic work scope across duplicate HTTP commands/two valid logins. Repeated
   no-op polls and blocked dependencies do not create job storms.
2. Rapid changes, event during collection, event during calculation and old work
   completion preserve the newest desired generation. Restart/crash/lease expiry
   recover exact valid work; exhausted attempts and paused cancellation remain clear.
3. First enrollment without prior jobs works for ready protected-prepared input.
   No enrollment, expired login, logout, demotion, project deletion and epoch
   change block dispatch/final publication. No stored bearer or implicit R8 grant.
4. Changes at admission/start/completion/Review/Apply make old outputs stale with
   precise reasons. Unrelated target comparisons and drawing-only mutations do
   not invalidate current engineering inputs. All aliases/From/To uses are covered.
5. Added shortcut/permission and uncertain component effects conservatively reroute
   every ready cable, including cables not using the old changed tray. Missing or
   ambiguous input stays blocked, never origin/default-success.
6. S/E/P-only controls use verified design-only mode and preserve byte/exact-value
   route, order/category/diagnostics. Gap/options/endpoints/policy/frame/binary
   change require full routing. Same frozen input retains actual PF path/tie/length.
7. Actual engine/rules/projection fingerprint changes fence reuse and results.
   No arbitrary fields reach strict C# v1; v2/v3/v4 history remains inspectable but
   cannot acquire new v5 Apply rights by cast or partial deployment.
8. Queue fairness/control limits are demonstrated with at least two projects and
   bounded work quanta. Cancel joins owned engine before terminal status; uncertain
   termination quarantines the lane. Bounded deadlines/RSS are reported honestly.
9. Normal admin browser shows durable states/progress/retry/pause and proposals;
   nonadmin/deep links deny. Exact unknown-command recovery and late response
   fences work.3tools/Ghost/yellow/Clear/Details/drawing access remain functional.
10. Automatic computation never Review/Applies. Output-only PF Apply does not loop
    scheduling; manual/import edit/restore invalidates exact write authority.
    Install length and unrelated cable/business values remain unchanged.
11. Fresh baseline/checkpoint and final old/new table, PF_ROOT/storage/resource,
    outside-container/reference-source audits prove only exact owned deltas.
    Cleanup only proved unnecessary owned resources, retaining demo/archives/
    companions/proofs and all denied residue. No unreviewed real engineering
    approvals, repeated conversion, synthetic substitution or native parity claim.

## 7. Deliverables and immediate next stage

Deliver operational Level-A durable automatic proposals, strict contracts and
explicit unavailable states; report43 with source/check/runtime scopes, bounded
performance evidence, validation/progress updates and a local technical commit.
Root fills exact branch/commit/runtime/checkpoint/fixture/source-control observations.
No push/PR/merge/deploy. Technical implementation/verification is not human or
native engineering acceptance.

After R7 technical closure, apply prepare-stage-handoff to produce the detailed R8
prompt from actual source/evidence and proceed immediately on an inherited local
branch. R8 separately qualifies calculation-only grants and closed-browser geometry
production; R9 exact delta Review/Apply and R10 paired real/integration/restore/
offline checks remain. Missing native/source-local proof is stated concretely;
continue independent authorized work rather than inventing evidence or stopping
at a routine turn/stage boundary.
