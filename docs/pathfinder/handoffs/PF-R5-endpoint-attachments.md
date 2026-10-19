# PF-R5 — durable shared endpoint bindings and safe object attachments

Status: **READY FOR IMMEDIATE EXECUTION**. R4 technical delivery and final
preservation are committed locally; root has reconciled this handoff. The user has
separately authorized the sequential handoff/implementation cycle through R10;
do not stop routinely between stages. Preparing this document does not itself
perform R5 implementation, acceptance, publication or deployment.

## 1. Purpose and traceable baseline

Implement durable From/To binding modes for the existing shared project location
registry. A single confirmed location/alias must serve every matching From and To
occurrence in every project cable, including cables not selected in the current
screen. Preserve old/new points, derivation, attachment evidence, displacement,
decisions and history. Missing or ambiguous evidence must never become an origin
or a confirmed attachment. Exact calculation points remain inputs to the unchanged
C# algorithm; routing and design length remain proposals subject to Review/Apply.

- Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
- R4 technical commit: **403504d4763efb97fabc1f4cc2f137ae0e3be370**. Final source/
  runtime,95table and1374object preservation is recorded in report40 and its evidence.
- At this handoff inspection, 2026-10-19T02:25:11Z, live branch was
  `pf-r4-geometry-trace-local-20261019`, HEAD
  `3d78bc245e15957c1607c4ebc2dd95a31a44f8b4`; the R4 implementation, evidence,
  report40 and progress changes were uncommitted. They are necessary work, not
  disposable residue. The cached `origin/main...HEAD` comparison was0behind/
  52ahead. This is a cached reference, not a current remote observation.
- R3 technical commit is `8c65ee1ccf9cb4b07c80bba99a475942fc6538e3`.
- After R4 closure, create a new inherited local branch
  `pf-r5-endpoint-attachments-local-20261019`. First inspect live HEAD, status,
  agents and `automation-progress.md`; do not recreate an already active R5 run.
  Preserve all parallel/foreign changes and refused scratch directories.
- Read applicable AGENTS instructions; plan32 sections3/R5/R6/R7;
  `r0/geometry-revision-contracts.md` sections2/4/5/6/7;
  `r0/geometry-revision-examples.json`; report40 and the final R4 evidence;
  `00-specification.md`, `00-validation-matrix.md` and the frozen parity catalogue.
  PF0 receipt-writing validators are not handoff preparation commands.

Read-only original checkout inspection at this handoff found WFC main
`e1ef20202598bb4d3d78e4772cbbb9747ec23a00` clean; canonical PF master
`45c24bf5f433f13e102600b36f20327c77961d0a` clean; old PF master
`35f4fb46f7762503576bdacd9668f34a1be2b0ed` retains modified
`AddinRibbon/AddinRibbon.csproj`, `AddinRibbon/ClAddin.cs` and untracked `.vscode/`.
Their cached remote comparisons were0/0. Keep all three reference-only; never
build them. Root subsequently refreshed configured GitHub GET observations:
main/master heads above remain current,0R4refs/0PR; candidate CI/review remain
NOT_ESTABLISHED. See geometry-trace/remote-closure.json. Before
R5 closure root should refresh configured source-control observations if
available, without push/PR/merge or external mutation. Lack of candidate CI does
not prevent authorized isolated local work and is not an acceptance PASS.

### R4 implemented and verified scope

R4 adds optional actual C# fitted-output export, immutable per-aggregate geometry
traces, strict current-admin history/object/evidence APIs and protected completed
capture observations. Ordinary v1 snapshot/prepare/Core mathematics remain
unchanged. Large parsing/building runs in a bounded refs-only worker; manifests
are<=256KiB, index/diagnostic pages<=1MiB, individual objects<=512KiB, capture
evidence<=4MiB, fitted export<=32MiB and transient export allowance128MiB.

Read these actual public receipts rather than assuming the older report40 draft
has already caught up with later runtime work:

- `evidence/geometry-trace/source-checks.json`: frontend/server types,36changed
  TS/TSX lint and frozen19artifact/Core/reference checks PASS; no expected data
  regeneration. Root's coordinated source run:63files/1039PASS/0FAIL/
  5optional NOT_RUN;11protected-runtime suites178PASS. Counts overlap and must
  not be added. R4's own B scoped run149PASS overlaps that larger run.
- `evidence/geometry-trace/actual-repository-controls.json`:11actual bounded
  repository/PostgreSQL phases PASS. Some fencing checks are explicitly
  transaction-primitive-only and history independence uses rollback/savepoints;
  do not relabel them full publication-race or committed-switch proofs.
- `evidence/geometry-trace/actual-completed-capture.json`: actual protected UI
  capture, GET/exact PUT replay/hash and foreign-part refusal PASS;17041evidence
  bytes/22fragments; completed payload identity matches. Observed/derived/
  unavailable values remain distinct.
- `evidence/geometry-trace/actual-publication-role-fence.json` retains the initial
  post-admission role-revocation refusal. `actual-publication-recovery.json`
  demonstrates natural-lease-expiry recovery of that exact original command/
  intent with retained staging: trace `0dd84cd9-b64d-48fc-8e3d-81fbfc5a25c3`,
  aggregate `7ca536d8-29a0-4fbc-ad4e-e31bd2fd747c`,13objects/6segments/
  23points/10ports, one completed-capture reference, exact replay PASS.
- `actual-http-derive.json`, `actual-http-edges.json`, `checkpoint.json` and
  `retire-engine-fixture.json` contain their own exact scopes. All observed trace
  results retain `engineeringAccepted:false` and `nativeParity:not-performed`.

R4 final closure PASS:75of89oldtables exact,12strict owned-fixture deltas,2ordinary
auth tables;6new trace tables all owned fixture,1374objects exact metadata;
1149non-doc build files identical,18outside containers intact. Computer-use11checks
and durable C#39receipt PASS. Report40 is current. These facts do not infer human
acceptance, native equivalence, a qualified common frame or full real-project
geometry. Cached local branch is now53ahead/0behind. Technical commit above
supersedes the earlier uncommitted inspection snapshot, which is historical.

## 2. Isolation and exact runtime constraints

Root remains the sole actual runtime/Docker/SQL/HTTP/browser/engine executor.
Delegate disjoint source edits, pure tests and independent reviews. No original
checkout, original container,5190, synchronized `sources/`, original database,
storage or volume changes. No push, PR, merge, deployment or automatic real Apply.

Owned demonstration: loopback5191, Docker project
`wfc-pathfinder-local-0cba87606e9b`, runtime owner
`8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, retained runtime directory
`pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`.
At the root-supplied R4 observation, candidate1 is installed with exact images:

| Role | Image |
|---|---|
| API | `sha256:0e48aa23e742624302ec7045dc3c213b4d2c0ee06fc913b0edcbe7dd4d0be886` |
| web | `sha256:c89c9c5171f4852cf49343b737d2898859f757fd388e3e74ca80f4f03139db76` |

The reviewed current private profile3 is in
`pathfinder-engine/.scratch/tray-catalog-80f5e81a-7f8b-40c3-b41e-f6f57a2e771e`.
Root must inspect its exact descriptor/operator before any next operation; do not
guess container IDs or reuse an obsolete image profile. Keep PostgreSQL/MinIO
volumes/networks/storage-ready and18outside containers intact. Only reviewed
API/web replacement with the explicit owned profile and no-deps is permitted;
never generic start/up-all/retire or Docker prune. Builds bind the complete
frozen Docker context, including relevant untracked inputs.

Retain R4 checkpoint `ed1b2fa8-f832-45df-b5de-8eec4fe693ff` and its separate private
companion. It has8hashed members/4images and verified ready-model resources;
that checkpoint's full restore is NOT_RUN. Root obtains a fresh exact baseline
and recoverable checkpoint before R5 migration, enumerating all current tables,
PF_ROOT artifacts, storage objects and protected resources rather than assuming
R4's pre-migration table count still applies.

The full reusable UI fixture is project
`56eadef6-8382-49f8-a652-c8f12026602e`, model
`098a7e6f-6e39-4935-a98b-ba3b683875a5` with342healthy independently copied
resources. Use its current private owner/auth metadata; do not assume the browser
account remains admin. The metadata-only R3 engine fixture was precisely retired
before R4 checkpoint and must not be recreated from an obsolete handoff.

The copied real project `1af0f807-7653-40ea-8391-7eea6c54e7d4` has330trays/
6purposes/2140selected cables,0real routing rules,0trusted project aggregate and
1527unresolved shared endpoint names at the last recorded baseline. Do not seed,
import, invent bindings or qualify it from the small UI fixture. Inspect current
counts before claiming they remain unchanged.

Current/old model packages remain available under the previously recorded owned
scratch paths. The older NWD conversion is already complete:173resources and ZIP
SHA256`a4538444641bfc96ce8915a0ef24c1adfebb50a72c1575a23cc475d9bd781183`.
Do not resubmit/upload/convert or silently select that package. There is no
Navisworks licence; converted comparison plus explicit manual engineering review
is the accepted validation policy. All historically refused scratch children,
their parents and refused Temp residue remain untouched, without retries or
alternate deletion mechanisms. Clean only proved owned unnecessary new resources;
retain demonstration, needed archive/companion, fixtures and evidence.

## 3. Existing interfaces and capability boundary

Read the actual source before choosing final names:

- `server/pathfinder/repository.ts`: shared registry/aliases, v1 binding mutation,
  matching, `activeModel`, `latestArtifact`, `bumpRegistry`, state DTO.
- `schema.ts`, `contracts.ts`, `matching.ts`, `audit.ts`: current v1 schema,
  `normalizeLocation` NFC/trim/uppercase semantics, alias uniqueness, point bounds
  and append-only location audit. Preserve lookup semantics and display spelling.
- `dependencies.ts`, `jobContracts.ts`, `routingScope.ts`, `jobs.ts`, `worker.ts`,
  `apply.ts`: v2 calculation wrapper, current dependency collection and fences.
- `shared/pathfinderGeometryTrace.ts`, `geometryTraceRepository.ts`,
  `geometryTraceSchema.ts`: exact historical per-object evidence and tenant joins.
- `preparationSessions.ts`, `preparationPlans.ts`, `preparationPublisher.ts`:
  immutable aggregate, trusted current pointer, capture frame and routing scope.
- `server/routes/pathfinderRoutes.ts`, `src/api/pathfinder.ts`,
  `src/pages/ProjectDetails/hooks/usePathFinder.ts`, existing location controls,
  ViewerController/types and protected picking: current UI/API boundaries.

The current R4 object contract intentionally fixes `logicalObjectId`, proven
source/document/instance/export-entity identity, `qualifiedProjectFrame`,
`objectLocalToProjectMetres`, intrinsic-shape signature and placement signature
to null. Observed model placement matrices do not alone establish a per-object
local frame or cross-revision identity. A capture frame is not a qualified common
engineering frame. Two null signatures never prove equality.

Therefore R5 must implement the complete attachment contract/evaluator with
truthful capability reporting, while enabling only what actual evidence supports:

1. Current-aggregate manual/picked fixed points can be explicitly confirmed in
   that exact canonical capture frame. Do not label that confirmation a proven
   cross-revision project frame. Keep `captureFrameId` explicit and common-frame
   qualification nullable; never manufacture a project-frame ID or rewrite R4.
2. Object-derived equipment-bottom-AABB anchors can be calculated server-side
   from an exact immutable object record and explicitly confirmed as approximate.
   They are not measured physical terminals.
3. Follow model object requires actual qualified local/connector identity and a
   proven transform basis. Current unsupported cases must be disabled/explained
   and refused server-side. AABB centre/minima do not define orientation; do not
   construct a pseudo-local frame to make the feature appear available.
4. Cross-revision carry requires an immutable reviewed frame mapping and unique
   identity decision. R6 owns comparison/identity decisions. Define a strict
   evidence adapter now; missing evidence yields stale/unsupported/suggestion,
   never a name/dbId/nearest-bbox fallback. Positive synthetic rigid-move/rotation
   tests qualify evaluator mechanics, not the real converted model's identity.

Any future qualified evidence is a new separately versioned record/reference;
do not insert nonnull facts into the strict immutable R4v1 trace or silently
reinterpret already published coordinates. Corrected units/axes/root/alignment
need a new immutable mapping/frame and appropriate new aggregate/geometryRevision.
Native and engineering acceptance remain independent.

## 4. Required implementation and proposed interfaces

Agree shared schemas and exported transaction/client interfaces before parallel
edits. Routine naming may change coherently; preserve the following invariants.

### 4.1 Additive persistence and history

Use the existing `pf_locations`, `pf_location_aliases` and
`pf_project_state.registry_revision` as the single project registry. Add:

- Immutable binding-revision records with stable binding ID, project/location/
  model/aggregate/projection/frame identity, binding revision, status/mode, exact
  canonical point, derivation, attachment/source-decision references, preceding
  binding ID, confirmed actor/time, reason and canonical content hash.
- One current head per project location, referencing the confirmed immutable
  binding. Its project/location composite FK must prevent another location's or
  tenant's revision from becoming its head. Historical models/aggregates remain
  inspectable without switching the active model.
- Immutable migration decisions and same-command receipts. Freeze source binding,
  target aggregate, matching/frame/attachment policy versions and evidence hashes.
  Retrying identical inputs returns the same decision; changed input makes a new
  decision. Confirmed heads cannot be overwritten by a late suggestion.

Use composite tenant FKs to locations/model/aggregate/trace/object where relevant;
add prerequisite nonpartial unique indexes before new composite FK definitions.
Structured binding/history records must preserve old and new points, displacement
vector/magnitude, derivation/mode, bounds/transform/shape/frame evidence, all
candidates, disposition and actor/reason. Preserve the original binary64 points;
display tolerances must not round engine inputs. History and receipts are append-
only, with only the established explicit project cascade permitted. Mutable heads
are server-owned CAS pointers, not mutable proof records.

Do not bulk rewrite existing v1 bindings at startup. Keep their values/history,
aliases and all cable fields. A deterministic/on-demand legacy observation may
freeze their existing value as fixed-world evidence with exact old revision;
it must not grant missing frame qualification or current R5 authority. Legacy
picked/manual points are never silently upgraded to Follow model object. Existing
automatic anchors retain their real `equipment-bottom-aabb` provenance and still
need explicit current confirmation under the new policy.

### 4.2 Strict versioned commands and reads

Use duplicate-safe bounded raw JSON before generic `express.json`, strict nested
schemas/versions, finite coordinates, absolute-end UUID/revision/hash validation,
canonical decimal-string revisions<=signed64, bounded arrays/pages/reasons and
private/no-store responses. A reasonable initial control-body ceiling is64KiB,
page limit<=100 and response<=1MiB; measure and reject excess explicitly rather
than raising existing global limits. Do not return paths, SQL messages, secrets
or arbitrary model-resource URLs.

Suggested APIs under `/api/projects/:projectId/pathfinder`:

- `GET /endpoint-bindings` with strict bounded filters/paging and explicit
  current/stale/legacy/capability reasons.
- `GET /locations/:locationId/binding-history` with stable revision paging.
- `PUT /locations/:locationId/endpoint-binding`: idempotencyKey, expected registry/
  location/head revision or ID, expected active selection/model, exact aggregate/
  projection/trace/object references, mode-specific input and reason.
- `POST /endpoint-bindings/migrations`: freeze a bounded proposed migration.
- `POST /endpoint-bindings/migrations/:decisionId/confirm`: confirm the exact
  reviewed current decision, with expected revisions and same-command identity.

Prefer these paths over colliding with existing `/locations/:id/binding` handlers.
Root must explicitly mount/order them and adapt old callers; no suffix-swallowing
router or old write path may bypass the new validation. Reads and all mutations
require current admin/login checks, including deep links and historical access.
No broadened engineer/catalog/drawing rights or persistent admin bearer.

Use discriminated mode variants:

- `fixed-world`: exact manual/picked point; `attachment:null`; source object, if
  retained, is provenance only. It cannot imply automatic following.
- `object-derived`: exact R4 object revision plus versioned supported anchor rule;
  server computes the point from immutable bounds/anchor evidence. Client point
  override is rejected. Preserve the approximation and original bounds.
- `object-attached`: exact server-owned qualified identity/local-frame/connector
  evidence and picked world point or durable connector. Compute local point only
  by an actually validated inverse transform; reject singular, ill-conditioned,
  scale/shear/reflection/deformation or unsupported evidence. Matrices supplied
  by a request cannot qualify themselves. Do not invent an engineering tolerance;
  numerical validation policies and engineering tolerances are explicit versioned
  inputs/evidence, with unknown qualification blocking automatic carry.

Represent unresolved status distinctly: confirmed, suggested, missing, ambiguous,
stale, unsupported-attachment. Only a confirmed binding for the exact current
aggregate/frame is calculation-ready. Blank cable endpoint text remains a cable
input defect, not a shared location at `[0,0,0]`.

### 4.3 Backend transaction/client boundary

Proposed repository functions, called inside the existing caller's transaction:

```ts
readEndpointBindingScope(client, {
  projectId, locationId, modelVersionId, aggregateId,
  projectionSha256, captureFrameId,
}): Promise<ConfirmedEndpointScope | EndpointBlocker>

evaluateEndpointMigration({
  sourceBinding, targetAggregate, objectMapping, frameMapping, validationPolicy,
}): EndpointMigrationDecision
```

The evaluator is pure; R6 supplies immutable reviewed identity/frame decisions
later. Do not call public R4 repository functions that open a nested transaction
from a confirmation transaction. Add a narrow transaction-client reader or
strictly validate the existing immutable trace/object rows with their manifest/
record hashes and tenant/aggregate membership in the current transaction.

Mutation sequence:

1. Bounded connection/SQL acquisition and project `FOR NO KEY UPDATE`; current
   user role and login `FOR SHARE`, with project absence disclosed only after
   current authority. Reuse established project→user→login ordering.
2. Exact historical command receipt lookup after authority and before new CAS.
   Same key/different payload conflicts; exact lost-ACK replay returns its original
   immutable receipt even if newer legitimate binding revisions now exist.
3. Lock registry, location/head, selection/model, current preparation pointer and
   necessary referenced rows in a consistent documented order. Verify healthy
   active model, aggregate/projection/frame and exact source object/decision.
   Freeze heavyweight migration inputs; compute outside SQL if necessary; final
   transaction revalidates those exact identities and current authority.
4. Derive/validate point and mode server-side, insert immutable decision/revision,
   update the head by expected revision, advance binding/location/registry exactly
   once per meaningful shared change and write audit/receipt atomically. An exact
   duplicate is not a second event or revision. A multi-location batch, if added,
   has an explicit atomic/bounded revision policy; never an unbounded lock loop.
5. Check cancellation/login expiry before every bounded page operation and
   immediately before COMMIT. Hold role/login/dependency locks through COMMIT.
   Rollback or COMMIT transport ambiguity discards the uncertain connection;
   preserve/reconcile the command instead of reporting a fabricated rollback.

Do not use `readPreparationContext()` as a generic binding gate if it would demand
the aggregate's frozen registry revision still equals current registry after a
binding edit. Saving a binding changes endpoint dependencies and proposal
readiness, not the immutable geometry. It must not cause a recapture loop or
advance geometryRevision merely to refresh location/audit metadata.

### 4.4 Legacy write closure and calculation dependencies

Current v1 `locations()` regards a matching model and nullable artifact as
confirmed; `collectDependencies()` accepts `artifact_id=NULL`. Those shortcuts
must not authorize new R5 work. Preserve historical readers, but make new
project-mode calculations require the explicit binding ID/revision and current
aggregate/frame disposition. Existing `/match` becomes candidate discovery/
suggestions or delegates to the new service; it cannot silently create confirmed
v1 rows that bypass R5. Existing manual-binding APIs must delegate coherently or
return an explicit upgrade-required refusal for new project-mode writes.

Current `pathfinder.dependencies.v2` has only locationId/bindingRevision/point for
each endpoint. Introduce an explicit **v3** calculation wrapper when adding binding
IDs/modes/frame/source-decision provenance; do not redefine historical v2 silently.
Strict dispatch keeps old proposals readable but prevents missing endpoint
authority from acquiring new Review/Apply rights by cast or downgrade. Include:

- exact model/selection/fingerprint and current aggregate/artifact/projection;
- registry revision; From/To location/binding ID/revision, mode, exact point/frame,
  source object revision and migration/frame decision refs when applicable;
- unchanged routing-only catalog/policy scope, Details settings/options and
  server-owned cableWriteRevision; future R6 comparison remains explicit nullable
  until the comparison pipeline exists, never a made-up current revision.

Update dependency collection, geometry reuse hash, dispatch/start/completion,
proposal staleness, Review and Apply together. A changed endpoint/mode/evidence
invalidates route reuse even if a displayed point rounds to the same value.
Drawing-only tokens/full-catalog/audit hashes remain excluded. Do not mutate the
strict C# v1 DTO: project exact confirmed points into its existing From/To fields.
Keep exact guards/ties/double-to-decimal behavior, SECONDARY replacement, one end
reserve before percentage and actual gap accounting. All project values come
from Details: Secondary tray length, For end connection, Additional % for bending,
Connection gap(default1m). Instrumentation follows Control; missing values and
unknown categories require resolution.

### 4.5 Safe migration and UI behavior

Fixed-world carry keeps the same qualified project point after an explicit valid
common-frame mapping. Without one it is stale, not moved toward a nearby object.
Object-attached carry needs unique reviewed identity and a proven rigid placement
change; evaluate the new transform/connector once. Object-derived carry uses the
same versioned anchor rule on the reviewed unique target; changed geometry,
replacement/deformation or missing connector yields a suggestion requiring review.
Split/merge/missing/ambiguous identities never average coordinates or union rights.

Store migration dispositions such as carried-fixed/carried-rigid/rederived versus
suggested-review/missing/ambiguous/split/merged/replaced/deformed/connector-missing/
frame-unverified/unsupported-transform. Do not call two absent signatures unchanged
or a reused dbId proof of identity. Names/properties/hierarchy/unscoped externalId
are candidate evidence only. Retain all relevant candidates and source facts.

English UI shows Fixed world coordinates, Follow model object, Object-derived
anchor, exact derivation and capability/blocking reason. Show old/new points and
displacement/history and state clearly when an anchor is approximate. Reuse the
protected Viewer picking/load/model/generation fences; no direct NOP_VIEWER product
interface. Project/token/model/selection/context changes abort and discard late
responses. Unknown saves retain the exact body/key for explicit reconciliation;
do not manufacture a new key after a timeout. Filled Ghost, original route colors,
yellow line, exact path points and Clear/restore remain unchanged.

R6 owns general revision comparison and R7 owns coherent automatic recalculation;
R5 provides safe bindings/evaluator/readiness hooks without inventing those
completed capabilities. A current shared binding change must immediately affect
dependency collection for every alias/From/To use and stale existing proposals.
Do not rewrite cable routing/design/install fields during binding confirmation.

## 5. Sequencing and nonoverlapping ownership

Suggested A: new shared endpoint contracts, pure attachment/migration evaluation,
math/rigidity evidence validation and synthetic fixtures/tests. Suggested B: new
endpoint binding schema/repository/routes, atomic history/receipts and pure/mock
tests. Suggested C: API/hook/panel, mode/capability/history/migration confirmation
and picking integration with focused UI tests. Root: existing shared app/schema/
runtime/router/repository/dependencies/jobContracts/jobs/worker/Apply changes,
actual execution, baseline/checkpoint, report/progress/handoff and local commit.

Agree exact names/DTOs first, including current capture-frame versus qualified
project-frame semantics, historical version dispatch and transaction-client reader.
One writer per existing shared file; serialize overlaps and preserve others'
changes. Reuse existing adapters and immutable evidence rather than adding a
replacement registry/geometry producer. Freeze all Docker-context writers before
root build. Delegate independent source/evidence reviews; root remains the only
actual executor and owns all mutable fixture scheduling.

## 6. Acceptance and validation

Record each check as PASS/FAIL/BLOCKED/NOT_RUN with exact revision/source hashes,
inputs, scope, limits and evidence. Do not regenerate frozen expected results.

1. Strict unknown/duplicate/escaped-member/version/finite/byte/revision/page/
   cross-project validation. Current admin/login authorization precedes project
   disclosure and body work where appropriate; engineer/catalog rights do not
   suffice. Head/body/stream limits retain typed errors through normal proxy.
2. One alias/location serves both ends and multiple cables; confirming once is
   reused for unselected cables. Blank/missing/ambiguous/stale endpoints remain
   distinguishable. Alias spelling/normalization semantics and collisions remain.
3. Exact replay, concurrent duplicate, conflicting body, lost ACK and crash/retry
   give one immutable binding/revision/audit/registry advance. A late migration
   suggestion cannot overwrite a newer manual head. Historical reads work after
   a model switch, without treating history as current authority.
4. Pure qualified synthetic move/rotation carries attached points and all shared
   endpoint uses correctly; fixed-world stays fixed. Reject unqualified/singular/
   ill-conditioned/scaled/sheared/reflected/deformed/missing-connector/ambiguous/
   split/merge/replaced evidence. Identical names/dbIds or absent signatures do
   not auto-confirm. Real current traces must truthfully refuse Follow model
   object while local-frame/identity/common-frame evidence remains absent.
5. Current-aggregate manual/picked confirmation and server-derived approximate
   AABB anchors work through normal protected UI. Fixed modes do not become
   object-following; no repeated transform or default-zero proof promotion.
   Explicitly separate current-frame confirmation from cross-revision engineering
   qualification and synthetic evaluator success from real acceptance.
6. Legacy rows/history remain intact; old match/bind/partial rollout cannot bypass
   v3 endpoint authority. Old proposals stay inspectable but cannot acquire new
   Apply authority. Binding change fences dispatch/completion/Review/Apply and
   route reuse without geometry recapture or drawing-only invalidation.
7. Actual root PostgreSQL/HTTP checks cover rollback/immutability/tenant FKs,
   exact final authority/role/login/selection/model/current-pointer/delete fencing
   and concurrent CAS. Primitive-only probes are labelled as such; test the full
   confirmation path where that is the claimed guarantee. Check cancellation/
   lock deadlines/uncertain connections and same-command recovery.
8. Preserve all11Core files, v1 computational/runner contracts and frozen expected
   data; appropriate existing mathematical/regression/parity checks stay PASS.
   Verify Details allowances/gap/category behavior, route/Ghost/yellow/Clear and
   normal project/Details/drawing access remain usable.
9. Root records observed time/memory/SQL/body/page/storage bounds on actual scoped
   fixture operations; no sampled RSS is called exact peak. Use fresh owned
   synthetic rows for positive qualification tests, not fabricated qualifications
   of the converted/business model. No additional cloud operation is needed.
10. Final exact table/storage/PF_ROOT/container/source preservation allows only
    owned R5 fixture/binding/receipt/audit/auth changes. Existing real cable
    routing/design/install/write revisions, unrelated aliases/locations, models/
    resources, aggregate/R4 traces/pointers and drawing-only inputs remain as
    recorded. Cleanup only exact proved unnecessary owned resources; retain
    needed reusable fixtures/demo/checkpoint/evidence.

R5 technical completion requires the useful current-aggregate modes, durable
shared binding lifecycle, no-bypass calculation fences, migration evaluator and
honest capability boundary to be implemented/verified. If the current producer
cannot prove real object-local identity/frame evidence, record that specific
Follow/migration case BLOCKED and continue independent R6 work; do not invent
facts or equate that limitation with completion of the real engineering goal.
Do not stop merely because a turn ends, and do not repeat unchanged external
entitlement failures. Native parity and final human engineering acceptance remain
NOT_RUN unless separately evidenced by the authorized user.

## 7. Deliverables and next stage

Deliver implementation/contracts/UI/history, scoped pure and actual evidence,
`docs/pathfinder/41-r5-stage-report.md`, updated validation/progress and a local
technical commit without secrets/private business rows/screenshots. Report exact
worktree/branch/commit, current runtime/fixtures, changed files, verification
revision and remaining evidence limits. Distinguish implemented, verified and
accepted; an operating feature is not automatic user acceptance.

After technical closure apply `prepare-stage-handoff` to create the self-contained
PF-R6 revision-comparison/managed-readiness prompt, account for actual R4/R5
evidence and qualified/unsupported attachment capabilities, and execute it
immediately on a new inherited local branch. Continue the authorized cycle to
R10; no routine stage approval pause. No push/PR/merge/original deployment.
