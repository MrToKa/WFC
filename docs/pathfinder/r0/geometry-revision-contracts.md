# PF-R0 proposed geometry, identity and revision contracts

Status: **CONTRACT PROPOSAL / NOT IMPLEMENTED**. These contracts extend
[plan 32](../32-purpose-and-revision-plan.md), especially R3–R9, and the
[R0 assignment](../handoffs/PF-R0-purpose-revisions.md). They do not establish
geometry capacity, actual cross-revision correspondence, native parity,
engineering acceptance, or any completed runtime check. The companion
[examples](geometry-revision-examples.json) are entirely synthetic descriptions;
their nominal hashes are placeholders, not measured digests or signed receipts.

Scope: staged preparation, immutable traceability, shared endpoint attachments,
comparison, calculation dependencies, review and Apply. Project catalog and
purpose rules are defined by [the separate policy contract](policy-drawing-contracts.md).
The public normalized catalog is `pathfinder.project-tray-catalog.v1`. Its
`routingContentSha256` covers only the routing tray set/IDs, raw names/purposes and
normalized identity keys; catalogRevision advances only when that projection
changes. Preparation and engineering dependencies bind precisely that revision
and routing digest. They exclude full catalog contentSha256, snapshot ID,
sourceProjectionSha256, dependencyFactsSha256 and drawingInputRevision.
The distinct `wfc.pf.catalog-copy-projection.v1` is a private lossless source/copy
projection retaining declared numeric/type/grounding/trefoil/material facts. It
is not a browser, bridge or public catalog DTO, and neither strict schema accepts
the other's shape. Full public content/source-copy/dependency-facts hashes remain
audit/drawing provenance: a new full snapshot/hash can coexist with the same
catalogRevision/routingContentSha256. Dimensions/grounding/trefoil/material/layout
changes advance drawingInputRevision without creating an engineering change.
Purpose keys use NFC plus outer trim, case-sensitive; raw purpose spelling is
preserved and key collisions require explicit resolution.
No change to the mathematical Core, fitted path ordering, tie behaviour,
SECONDARY formula, double-to-decimal conversion, warnings, or installLength is
authorized by this document. Left/Right is a drawing-only concern.

## 1. Existing behaviour and explicit additions

All paths in this table are relative to the isolated WFC checkout.

| Area | Existing source behaviour | Proposed addition / implementation stage |
| --- | --- | --- |
| Producer | `viewer-runtime/model-capture.mjs` extracts selected converted meshes through the protected Viewer. Model Preparer packages SVF resources; WFC `server/modelRegistry/importService.ts` verifies/imports them. Neither existing server module produces canonical PF geometry from SVF. | R3 stages protected capture parts. R8 separately qualifies a producer without a user browser. |
| Geometry | `server/pathfinder/contracts.ts` and `PathFinder.Model/Contracts.cs` have strict `pathfinder.model.snapshot.v1`: model/fingerprint, source observations, canonical world-metre vertices, bounds, hierarchy, meshes and optional externalId. | R4 immutable trace index references exact v1 payload bytes and retained prepared output; it adds scoped identity, signatures and provenance as a sidecar. |
| Publication | `repository.ts:latestArtifact` selects one latest planning artifact. `ingestArtifact` publishes a supplied snapshot and its object index. Uploading successive independent chunks does not construct a union. | R3 staged parts never enter this selection. A validated complete requested scope gets one atomic aggregate publication. |
| Endpoint | `pf_location_bindings` stores model-version-specific world points, object/external IDs and derivation; automatic anchor is the bottom centre of the equipment AABB. Old bindings are stale for a new model. | R5 distinguishes fixed world, object-attached and object-derived bindings, and records migration decisions. Existing world points acquire no invented local frame. |
| Dependencies | `pathfinder.dependencies.v1` binds model/selection, artifact, registry, settings, options, both endpoints and server-owned cableWriteRevision. | R7 `pathfinder.dependencies.v2` additionally binds catalog/policy, aggregate/geometry and optional comparison decisions. |
| Apply | `server/pathfinder/apply.ts` requires current admin/login, exact proposal review, current dependency hash, cable revision and atomic routing/designLength/history/receipt. Manual-review provenance says native parity was not performed. | R9 extends the same transaction to the new dependency rows and writes `pathfinder.apply.v2`; it does not grant autonomous Apply. |

R0 writes no migration or feature code. New API/table names below are proposed,
not available endpoints or deployed database claims.

## 2. Common strict codec and version rollout

Every object has a version discriminator and an exact required key set for its
variant. Unknown members, unknown versions, duplicate JSON member names,
nonfinite numbers, unsafe IDs, invalid UTF-8, invalid indices and exceeded bounds
are rejected. Absence is not silently interpreted as permission or completeness.
Nullable fields are present explicitly unless a version definition says otherwise.

| Type | Proposed rule |
| --- | --- |
| Server ID | Lowercase canonical UUID; generated by the server, never a filesystem path. Existing versioned business IDs are preserved. |
| Revision token | Decimal string matching `^(0|[1-9][0-9]{0,18})$`, value at most `9223372036854775807`. It maps to current PostgreSQL BIGINT and existing revision codec. Never coerce through JavaScript Number. Overflow refuses the mutation; it never wraps or resets. |
| Hash | Lowercase SHA-256, 64 hexadecimal characters; validated against the precise declared encoding. No placeholder digest is accepted at runtime. |
| Point | Three finite binary64 values `[x,y,z]`, canonical metres, each within current `[-1e9,1e9]`. |
| Matrix | 16 finite binary64 values in the declared column-major convention; affine last row `[0,0,0,1]`. Object-local frames additionally require validated invertibility/rigidity policy. |
| Bounds | `minimum`, `maximum` Points, component-wise minimum ≤ maximum. AABB is measured evidence, not a path or terminal. |
| Numeric design value | Exact canonical nonnegative decimal string under existing C# decimal/DTO guards. Routing coordinates/lengths remain binary64; preserve engine round-trip companions when provided. |
| Timestamp | UTC RFC3339 instant plus explicit actor/basis; a timestamp is not identity evidence. |
| Property/name | Preserve original text; the separate versioned matching policy defines candidate normalization. Do not discard punctuation/leading zeroes or turn candidates into confirmed identities. |

New schema names:

- `wfc.pf.preparation-session.v1`, `wfc.pf.preparation-part.v1` and
  `wfc.pf.geometry-aggregate.v1` for R3 preparation and publication.
- `wfc.pf.object-revision.v1` for the R4 sidecar.
- `wfc.pf.endpoint-binding.v2` and `wfc.pf.binding-migration.v1` for R5.
- `wfc.pf.revision-comparison.v1` for R6.
- `pathfinder.dependencies.v2`, `wfc.pf.proposal-envelope.v2` and
  `pathfinder.apply.v2` for R7/R9.
- `wfc.pf.calculation-grant.v1` for the separately qualified R8 capability.

Historical strict v1 payloads/readers are retained. A new wrapper is not appended
to the old snapshot or engine request: an explicit adapter projects the aggregate
to the existing validated v1 C# input, preserving numerical values, ordering and
warnings. The sidecar carries traceability separately. An implementation needing
a changed engine DTO must version TS/Zod/C#/bridge together before activation.

At partial rollout, version dispatch is explicit. Old artifacts remain readable
as history; missing new dependencies/readiness cannot authorize a new project-mode
Apply. Reject unsupported versions and state incompatibility clearly; never drop
fields or downgrade a v2 proposal to bypass checks. `comparison` is required
`null` for an initial preparation with no comparison pipeline; after a revision
comparison is applicable it is a required strict reference to its completed,
current decision set. No current comparisonRevision is invented for old data.

## 3. R3 staged preparation and atomic aggregate

### 3.1 Server-owned frozen plan

Creating a preparation session requires current admin authority, or the separately
qualified calculation-only grant in R8. A proposed session has these required
fields:

| Field | Meaning / source |
| --- | --- |
| `schemaVersion`, `id`, `projectId`, `modelVersionId`, `contentFingerprint` | Fixed session and imported model identity. A ready SVF package is a prerequisite, not ready PF geometry. |
| `selectionRevision`, `catalogRevision`, `routingContentSha256`, `routingPolicyRevision`, `locationRegistryRevision` | Server-read tokens and routing-only catalog digest at planning. Full catalog/source-copy/drawing-facts hashes, drawing policy and drawingInputRevision are excluded. |
| `state`, `sessionRevision`, `createdAt`, `principal` | State, CAS token and actor identity. Principal is either current-login admin or a specific live calculation grant, never client-provided authority. |
| `coordinateFrameId`, `matchingPolicyVersion`, `partitionAlgorithmVersion`, `orderedPlanSha256` | Pinned coordinate frame, exact-name candidate policy and deterministic plan encoding. |
| `requestedScope` | Exact project tray IDs/names/purposes and ownership decisions, allowed categories from current policy, endpoint-name scope, exclusions and global ordered roots/leaves. Scope digest covers these arrays and their meaningful order. |
| `partPlan`, `limitsProfile` | Ordered expected part IDs, object/root ownership manifest, boundary dependencies and explicit limits. Parent hierarchy closure and equipment candidates are included in the budget. |
| `coverage`, `failure`, `publishedAggregateId` | Initially incomplete/nullable; later server-calculated counts and missing/ambiguous/excluded cases. |

The session source of truth is the routing projection of the project tray catalog,
not model purpose and not the browser's `allowedCategories`. A tray can own multiple confirmed roots/leaves;
that is one-to-many physical ownership, distinct from unresolved candidates. A
physical leaf attributed to different tray IDs or conflicting purposes is a
conflict; never union their permissions. Manual resolutions are audited persistent
decisions and remain subject to the same project policy.

Proposed lifecycle:

`planned → collecting → validating → published`

Any pre-publication state can transition to `cancelled`, `stale` or `failed`.
Terminal sessions are not reset. Resume reuses the same unchanged frozen plan and
hash-verified committed parts. A new plan receives a new session ID. Store
before/after state, actual actor/grant, reason and revision in an append-only log.

### 3.2 Parts and idempotency

A proposed part has exactly: `schemaVersion`, `sessionId`, `partId`, `partIndex`,
`sessionPlanSha256`, `modelVersionId`, `contentFingerprint`, `coordinateFrameId`,
`scopeSha256`, `payloadEncoding`, `payloadSha256`, `payloadBytes`, `payloadRef`,
`counts`, `coverage`, `producer`, `completedAt`. `payloadRef` is a server-owned blob
ID, never a user path or arbitrary URL. Payload schema/bytes must match the
encoding; transport envelope bytes count separately. A part claims completion of
its planned sub-scope only. Missing objects are explicit; no first-match fallback.

Idempotency key is `(sessionId, partId)`. An exact byte/hash replay returns the
same committed part; conflicting bytes fail with `PART_IDENTITY_CONFLICT`.
Duplicate receipt delivery cannot add leaves, advance meaningful order or consume
an extra logical part. Store immutable completed bytes before acknowledging them.
Incomplete temporary data is not a completed part. Existing protected bridge
authorization, cancellation, model generation fences and message limits remain.

### 3.3 Validation and publication sequence

1. Revalidate current authority and exact selection/catalog/policy/registry tokens.
   Scope/permission changes mark this session stale and refuse further publication.
2. Require every planned part, exact SHA/bytes/model/frame/plan binding and complete
   declared requested coverage. Missing/ambiguous data must be resolved or explicitly
   excluded in a newly frozen plan; it cannot be relabelled complete.
3. Merge physical records by version-local identity. Shared ancestor stubs may be
   deduplicated only after identity/properties/frame agree. Same physical leaf or
   fragment cannot appear twice or acquire conflicting ownership/categories.
4. Validate cycles/depth, root/ancestor closure, finite canonical geometry, meshes,
   indices, category policy and coordinate evidence across the union. Recompute
   ancestor AABBs from the final selected descendants; part AABBs are not full-plant
   bounds. Retain endpoint objects with their real bounds; do not invent origins.
5. Preserve the frozen global leaf/root/rule order in the v1 engine projection.
   Sorting parts by arrival time or sorting comparison signatures must not reorder
   the C# algorithm. Validate global resource ceilings before fitting.
6. Produce one immutable v1 computational payload plus one aggregate manifest and
   trace index. Cross-part ports/connectivity are evaluated in a single coherent
   network; independent part routes cannot be concatenated into a path.
7. Fit/validate the union through the existing C# pipeline. The final graph remains
   constructed per calculation under current endpoint-first/tie semantics. Do not
   substitute a shared cached final graph without separate exact parity checks.
8. Under the same authorization/dependency fence, publish aggregate/index records
   and advance the project's preparation/geometry reference atomically. A lost
   response is reconciled by session/publication identity, not republished blindly.

The aggregate contains immutable part references, `projection` `{schemaVersion,
payloadRef,sha256,bytes}`, `traceIndex` reference/hash, `coverage`, source/model/frame
identity, frozen dependency tokens, exact engine/rules versions, diagnostics and
readiness. New `geometryRevision` is server-owned and monotonic. Chunks are never
eligible `latestArtifact` rows. A failed/stale session preserves the last usable
aggregate as history; a new active model cannot use that older aggregate for Apply.

Hash closure matters as much as field names: the ordered session plan, aggregate
manifest, computational trace index, dependency and comparison hashes must not
transitively embed mutable full-catalog/source-copy/drawing-facts digests or full
catalog snapshot IDs. Computational trace carries the routing revision/digest.
Any full catalog audit snapshot link belongs to a separate provenance envelope
excluded from engineering identity. On a drawing-only update, keep the existing
preparation/aggregate/trace-index and engineering hashes unchanged; do not recapture
or publish a new geometry artifact merely to refresh audit/drawing metadata.

`requestedScopeComplete` means the exact server-requested routing/equipment scope
is complete. It does not mean all plant geometry, all model objects, native
visibility, verified native transforms, or engineering acceptance. Existing
selected-capture v1 proof flags remain false; coverage belongs in the new wrapper.

### 3.4 Measurable capacity boundary

These are actual current source ceilings, not proof the real project fits:

| Layer / source | Current ceiling |
| --- | --- |
| `viewer-runtime/capture-input.mjs` | 100 rules, 512 total selected roots; 4096 endpoint names, 256 per input chunk, 16 chunks, 1 MiB input; 300 s scope deadline. |
| `viewer-runtime/model-capture.mjs` | 4096 emitted objects including ancestors; 64 MiB/event stream and assembled snapshot; 3000 events, 24 KiB/event; one million indexed objects, 100k fragments, 5M vertices, 5M triangles, depth 512; 300 s capture. |
| Protected bridge | 4096-request lifetime; capture-start admission preserves enough remaining request budget and can require a fresh frame. No arbitrary iframe/NOP_VIEWER escape. |
| `server/pathfinder/storage.ts`, `contracts.ts`, `matching.ts` and C# `ModelLimits` | 256 MiB snapshot, one million objects, 100k fragments, 5M vertices/triangles, depth 512 and 1024 properties/object; at most two fitted models in current cache. |
| Existing graph options | Explicit maximums: 1M nodes/4M connections; current defaults 200k/1M; each calculation still has current bounded timeout. |

Partitioning must satisfy each part's existing limits without silently raising them.
The union must also fit the smaller applicable server/C# ceilings. Counting mesh
chunks does not reduce the union's triangles or graph size. R3/R4 capacity evidence
must record actual rules, roots, objects, ancestors, endpoint candidates, bytes,
fragments, vertices, triangles, graph nodes/connections, wall time, peak process
memory, disk and cancellation/recovery for both synthetic boundary cases and the
real requested project scope. If the union does not fit, return an explicit
capacity blocker and implement/qualify a separate storage/fitting optimization;
do not announce full-project readiness from the 13-object diagnostic preparation.

## 4. R4 immutable object revision and coordinate evidence

An object revision sidecar has required sections `identity`, `source`, `catalog`,
`historicalModel`, `coordinates`, `geometry`, `signatures`, `provenance` and
`diagnostics`, plus schema/id/project/model/aggregate references. Persist exact
source observations and canonical values, not only the AABB centre.

| Section | Proposed strict fields and rules |
| --- | --- |
| `identity` | Server `logicalObjectId` (nullable until resolved), immutable `objectRevisionId`; version-local `objectId`, nullable `dbId`, nullable `externalId`; source/document/instance scope; nullable stable export entity ID; matching policy/basis/evidence refs. `dbId` and fragment IDs are never cross-version identities. |
| `source` | Source content SHA and conversion/package fingerprint, source document ID and instance path, exporter/adapter version and extraction SHA. Unknown document/instance identity is explicitly null; it blocks automatic stable-ID transfer. |
| `catalog` | Nullable authoritative `projectTrayId`, exact `purposeKey`, routing-only catalogRevision/routingContentSha256, routing-policy revision and physical ownership decision. Equipment may have no tray association. Full catalog audit/drawing digests are excluded from this computational trace section. |
| `historicalModel` | Original name, leaf-to-root names, observed model purpose/properties and source spelling. A changed model purpose is visible history and never overwrites the project's purpose/permissions automatically. |
| `coordinates` | Right-handed Z-up canonical metres, `projectFrameId`, source/display units, explicit unit scale, global offset and source/display/fragment transforms as observed; `objectLocalToProjectMetres` nullable and its validation basis. Record whether transforms have already been applied. |
| `geometry` | Canonical AABB; role; immutable canonical mesh ref/hash; source bounds; nullable fitted axis/ports; geometric length; nullable declared project length and unit; measurement/fit version; full fallback/warning codes. Equipment anchor is nullable with explicit derivation. |
| `signatures` | Independent identity, intrinsic shape, placement, ports/connectivity and policy signatures; null means not established, not unchanged. Exact payload SHA remains separate. |
| `provenance` | Producer level/adapter, preparation/session/part, model/fingerprint, input/output SHA refs, engine/rules versions, timestamp and verified scope. Never use client `engineeringAccepted` as authority. |

Canonical numerical pipeline: use the current binary64 matrices, transform each
decoded local vertex to the chosen project world-metre frame once, and record the
composition. Current protected capture composes display-to-world-metres × SDK
fragment world matrix × decoded local vertex; unit/global-offset application is
not repeated as a second root/placement transform. Canonical snapshots already
contain transformed vertices (`transformAlreadyApplied=true`). Metadata matrices
are evidence and must not be reapplied when reading these vertices.

Cross-revision comparison requires a verified common project frame or a reviewed,
explicit old-frame-to-project/new-frame-to-project mapping. Both models saying
“metres” is insufficient. A changed display global offset or unit encoding must
not become a physical move when the mapped canonical points are the same.
Unknown units/frame/alignment produce `coordinate-frame-unverified`; do not infer
scale from the bbox or fit two scenes automatically and call that source identity.
Converted consistency checks/manual alignment review remain distinct from native
parity, which is not performed under the user's accepted validation policy.

Frame and alignment definitions are immutable. Correcting source units, axis
convention, root transform or a reviewed manual alignment creates a new frame or
immutable mapping-revision identity and a new aggregate/geometryRevision. Never
reinterpret already published canonical points under the same projectFrameId or
mapping identity. Requalify comparisons and invalidate jobs/proposals/bindings
whose numerical interpretation or attachment evidence depends on the corrected
mapping. Historical values remain bound to their original frame; conversion into
the corrected frame is a new explicit result with old/new mapping provenance.

Axis and port records come from retained existing fitting output, with ordered
points, fitting derivation and all warnings. A bbox diagonal is not tray length;
an AABB face centre is not a measured physical terminal. Preserve project-declared
tray length (currently `trays.length_mm`) separately and display the discrepancy
in declared units without automatically changing that business field.
The declared value retained on an immutable object revision is its historical
observation. A later drawing/business-only declared-length or dimension update
is shown through a separate current audit/catalog view; it does not rewrite the
computational trace, refit geometry, advance geometryRevision or invalidate a
route just to refresh this displayed metadata.

Signatures use a separately versioned, deterministic comparison encoding: named
sections, explicit frame, ordered semantic identifiers, finite IEEE754 binary64
coordinates and declared triangle/winding rules. No coordinate rounding or
comparison sort mutates engine input. Preserve payload bytes/round-trip values.
Shape signatures require a proven object-local frame or explicit transform-factored
basis; otherwise use null/unknown and compare canonical evidence conservatively.
Different tessellation/order/export representation can change an exact mesh hash
without proving physical shape change. Record `representation-changed` and assess
axis/ports/shape evidence under a separately documented comparison policy.

Position/length/rigidity tolerances are explicit versioned validation inputs,
measured/approved in R4/R6; R0 supplies no invented engineering tolerance. Missing
tolerances/evidence prevent automatic equivalence. Thresholding a display delta
must not change values passed to Core or erase a staleness event.

## 5. R5 shared endpoint attachment and safe migration

Locations/aliases remain one project registry shared by From/To of all cables.
One binding change advances both the binding revision and locationRegistryRevision
once; all uses reference that binding, including cables not currently selected.
Blank cable endpoint text is a separate data issue and does not create an origin.

Proposed endpoint-binding v2 common fields: `id`, `projectId`, `locationId`,
`modelVersionId`, `aggregateId`, `bindingRevision`, `locationRegistryRevision`,
`status`, `mode`, `pointProjectMetres`, `projectFrameId`, `derivation`, `attachment`,
`sourceDecision`, `confirmedBy`, `confirmedAt`, `supersedesBindingId`. Status is
`confirmed | suggested | missing | ambiguous | stale | unsupported-attachment`.
Only confirmed current bindings make their endpoints calculation-ready.

| Mode | Attachment variant | Migration rule |
| --- | --- | --- |
| `fixed-world` | `attachment:null`; explicit world-point derivation. | Keep the same project point after a qualified common-frame mapping. No nearest-AABB reassignment; if frame alignment is unverified, stale. |
| `object-attached` | Logical/source/document/instance identity and objectRevisionId; `objectLocalToProjectMetres`; either `localPointMetres` or actual durable connector identity; source shape signature; transform validation policy. | For unique verified identity and proven rigid placement change, evaluate the new transform/connector once. Unknown frame, singular/ill-conditioned transform, scale/shear/reflection change or deformation requires resolution. |
| `object-derived` | Object identity/revision plus versioned anchor rule, e.g. `equipment-bottom-aabb`; original bounds and resulting point. | Recompute the same declared rule on the uniquely matched new object. Geometry change, replacement, missing connector or changed rule yields a suggestion/manual confirmation rather than silently reattaching a physical terminal. |

For object-attached creation, compute local point only with an actual validated
object frame; inverse-transform the exact picked world point. AABB minima/centres
do not establish an object-local frame or orientation. Current endpoint capture
can provide bounds without equipment mesh/local-frame evidence; such objects can
use fixed-world or explicitly approximate object-derived anchors until the extra
evidence is available. Existing picked/manual v1 points are migrated as fixed-world
by default. They are not silently upgraded to Follow model object.

Migration is a new immutable decision per `(old binding, target model/aggregate,
matching policy, decision set)`, idempotent for the same input. Record old/new
points, displacement vector/magnitude, old/new frame/transforms/shape, evidence,
candidate identities, actor/time/reason and disposition:

- `carried-fixed`, `carried-rigid`, or `rederived` only when all mode-specific
  evidence and policies pass. Automatic calculations still yield proposals.
- `suggested-review`, `missing`, `ambiguous`, `split`, `merged`, `replaced`,
  `deformed`, `connector-missing`, `frame-unverified` or `unsupported-transform`
  retain the old binding as history and block affected new calculation readiness.

Deletion/recreation with the same name never inherits the old attachment by name
alone. Split/merge requires explicit versioned mapping and binding resolution;
there is no averaged point or union of privileges. A reviewed new association is
reused for every From/To occurrence through the shared registry.

## 6. R6 comparison and managed readiness

Comparison freezes the two immutable aggregate IDs/hashes and coordinate frames,
identity/matching/geometry policy versions, routing-only catalog revision/digest,
routing-policy revision and
prior reviewed mapping decisions. Its server-owned `comparisonRevision` covers
that complete immutable decision set. A rerun of identical inputs is idempotent;
a changed mapping/decision creates a new revision, never overwrites prior evidence.

Resolve scoped, proven source/document/instance/entity identity first. Unique
external IDs without proven scope/stability are candidates. Name/hierarchy/property
or geometric proximity are candidate evidence. They cannot resolve ambiguity or
replacement silently. Mapping entries have old/new objectRevisionId arrays,
basis/evidence, disposition and decision actor; one-to-many/many-to-one are explicit
split/merge and require review.

Change flags are nonexclusive: `unchanged`, `moved`, `geometry-changed`,
`length-changed`, `connectivity-changed`, `project-purpose-changed`,
`model-purpose-changed`, `policy-changed`, `added`, `removed`, `ambiguous`, `split`,
`merged`, `replaced`, `representation-changed`, `coordinate-frame-unverified`.
Unchanged requires positive comparable evidence; two null signatures do not agree.
Each flag carries old/new measurements or refs, method, tolerance-policy version,
confidence basis and readiness consequence. A same-AABB changed elbow is detected
by shape/axis/ports, not dismissed as unchanged. Distinguish stored observed
length delta from a physical-change claim when fitting/export evidence differs.

Readiness layers are independent:

1. package imported and healthy;
2. requested-scope geometry captured/validated and aggregate published;
3. common coordinate frame established and ownership/purpose decisions resolved;
4. current endpoint bindings confirmed and category/Details settings present;
5. calculation can produce a proposal with retained diagnostics;
6. exact proposal manually reviewed;
7. Apply passes fresh authority/dependency checks and commits.

A prior accepted cable result remains visible with its old model/provenance after
a new selection. Until the new layers are ready, show a concrete pending/blocking
reason; do not reuse the previous aggregate as current or erase accepted history.

## 7. R7 dependencies, invalidation and proposal provenance

`pathfinder.dependencies.v2` required sections:

| Section | Required content |
| --- | --- |
| `projectId`, `cableId`, `cableWriteRevision`, `cableInputs` | Current server-owned cable record token and original endpoint/MTO/type values. Instrumentation resolves through Control without rewriting MTO. |
| `model` | ModelVersionId, selectionRevision, imported contentFingerprint and verified project frame identity. |
| `catalog` / `routingPolicy` | Catalog schema `pathfinder.project-tray-catalog.v1`, catalogRevision and routingContentSha256 only; routing-policy revision and policy snapshot hash. Never use full catalog contentSha256/snapshot ID, sourceProjectionSha256, dependencyFactsSha256 or drawingInputRevision as an engineering dependency. Private copy projection is not substituted for the public routing projection. Policy is enforced again on every traversed physical tray. |
| `preparation` | SessionId, aggregateId/manifest SHA, geometryRevision, exact v1 projection SHA, trace-index SHA, ordered scope/rules SHA and coverage status. |
| `comparison` | Required null for initial/no-comparison context, otherwise comparison ID/revision, old/new aggregate refs and decision-set SHA. |
| `locations` | locationRegistryRevision; From/To location ID, binding ID/revision, mode, current point/frame and source objectRevisionId where attached. |
| `settings` | Existing settings revision and exact Details secondaryTrayLength/endConnectionLength/additionalBendingPercent/connectionGap values. Gap is also projected to existing routing options. |
| `options`, `engine` | Exact supported options, Core/model/fitting/rules versions and numeric/projection contract versions. |

`drawingPolicyRevision`, `drawingInputRevision`, full-catalog/source-copy/
drawing-facts hashes and drawing-only bundle/divider changes are excluded,
including through nested manifest/trace/plan hashes.
They stale previews/drawings, not routing/design lengths. Apply of a changed route
can subsequently change drawing membership under the same drawing algorithm.

Every job freezes the full snapshot and hash, checks it at dispatch/start,
completion, Review and Apply, and retains superseded results as history. Rapid
events coalesce by the latest complete dependency set; logical job idempotency
binds project, cable set, calculation mode and dependency hash. Job success is
not a Review, and changing a human-visible status cannot make stale data current.

| Event | Minimum conservative response |
| --- | --- |
| New active model, new/removed/replaced tray, changed shape/placement/ports, connection gap/options or coordinate mapping | Rebuild/qualify affected preparation as required; reroute every ready cable in potentially affected categories/components. If reachability impact cannot be proven, reroute all ready project cables. |
| Added permission or new connecting edge/shortcut | Invalidate potential routes even when they did not traverse the changed tray. First implementation defaults to whole-project ready-cable rerouting; category/component optimization needs a positive proof it cannot miss a new path. |
| Removed permission, changed project purpose/catalog ownership | Re-evaluate planning policy/coverage and all potentially affected paths. Historical model purpose alone is a comparison flag; a catalog change follows catalog policy. |
| Confirmed shared binding change | Reroute all cables using either end's shared location; connected component uncertainty expands the scope. |
| Only S/E/P design allowances changed | May reuse the exact retained successful route only when model/geometry/ownership/policy/gap/options/endpoints and relevant C# versions are positively unchanged; calculate a new design result/proposal with new settings revision. Missing exact route/preferences requires rerouting. |
| Manual/import cable edit, including edit then restoring old value | Existing cableWriteRevision advances, invalidating old proposal/Review. Never rely on the user's engineering revision string. |
| Drawing-only policy change | No PF job or engineering staleness; refresh only drawing/layout dependencies. |
| Drawing-only dimensions/grounding/trefoil/material facts or new full catalog audit snapshot | Keep catalogRevision/routingContentSha256 and all preparation/job/engineering hashes unchanged; advance drawingInputRevision and refresh drawings. Full catalog hash/snapshot ID changes do not bypass this separation. |

Do not update length by multiplying a previously rounded designLength. Retain
the existing engine's actual route length, actual From/To distances, SECONDARY
flags/replacements, connection gap count/length and exact C# decimal values.
Apply end connection reserve once before bending percentage and preserve existing
final ceiling/guards. Required project values come only from Details; gap retains
the user-approved default 1 m. Existing messages/fallback diagnostics remain.

Proposal envelope v2 carries job/dependency/proposal hashes, previous accepted
receipt/model/result (nullable), new engine result, comparison reasons, actual
calculation mode (`full-route` or verified `design-only`), readiness/diagnostics
and an explicit review state. The same result bytes and dependency snapshot bind
the proposal hash. Previous Review cannot authorize changed hashes or a new revision.

## 8. R8 producer levels and delegated calculation-only authority

Level A is usable after successful protected Viewer preparation: compare,
match/rederive and calculate automatically from the published aggregate. If the
user browser is closed before extraction, display Geometry pending/interrupted;
no existing worker independently decodes SVF or guarantees closed-browser capture.

Level B requires a separately qualified producer and `wfc.pf.calculation-grant.v1`:
server ID/project, grantRevision, enabled, enabledBy/current-admin linkage,
enabledAt/revokedAt, allowed model/preparation scope, allowed operations,
limitsProfile and grant epoch. Allowed operations are only prepare, compare,
match/suggest bindings and calculate proposals. Review/Apply, arbitrary business
edits, another project and broad model-resource access are absent and denied.

Do not persist a user's administrator bearer as a permanent credential. Dispatch
and final publication verify the enabled grant/current admin role and exact epoch;
revocation or role removal cancels/rejects queued/running work and future sessions.
Producer resource sessions are short, read-only, project/model/content scoped and
protected by the same ownership/capability principles as the Viewer. Restored
installations fence old sessions and require explicit reactivation of grants.

The recommended producer candidate is an isolated managed browser worker with
the pinned SDK and the same capture contracts. R8 must verify official runtime/
redistribution support, real extraction equivalence, units/identity/precision,
capacity, network/filesystem restrictions and crash cleanup before enabling it.
No assertion here establishes headless support. A different server decoder is a
new producer requiring its own equivalent qualification. A producer blocker does
not remove Level A or permit synthetic replacement of actual model geometry.

## 9. R9 exact Review and atomic Apply

Review request binds exact proposal/dependency hashes and records the current
human administrator, current login, time and manual-validation method. Grouped UI
may select an explicit immutable list of hashes; no “review all current/future”
permission. Neither a background grant nor a producer principal can create Review.

Apply request retains idempotency key, exact proposal/review IDs and expected
cableWriteRevision. Extend the existing principal transaction: acquire current
authority/project/cable/model-selection/model/artifact/catalog/policy/registry/
binding/settings/grant-as-applicable rows in one documented common lock order,
compare every required token/hash and retain protection to commit. Grant revocation
can stale a pending automated result; it cannot weaken human Apply authorization.
Implementation must reconcile this proposed row order with current
`principalTransaction`/`collectDependencies` and run concurrent deadlock controls;
this document does not claim that additional rows are already locked.

Write routing and designLength together, leave installLength intact, append cable
history and `pathfinder.apply.v2` provenance in the same transaction. Provenance
includes before/after, proposal/result/dependency hashes, aggregate/index/engine
refs, comparison reasons/decision-set ref, endpoint source/attachment decisions,
exact Details values, human review identity/time, current actor and idempotency
payload hash. Native parity is `not-performed`; manual review is scoped to this
proposal and is not model-wide acceptance. Preserve current WFC route/design
compatibility limits and report refusal instead of truncation.

Exact idempotent replay returns the same receipt after current access checks.
Different payload under the same key conflicts. A cable edit/import, role removal,
model/policy/settings/mapping change between Review and Apply refuses the write.
Reject/recalculate creates history and cannot delete the last accepted cable result.

## 10. Required contract and acceptance controls

All rows below are **PLANNED / NOT_RUN** in R0, unless the overarching R0 report
explicitly records a documentation-only check. Synthetic fixtures and the two
actual converted-model comparison are separate evidence sets; neither is native
parity. The older verified SVF from report 33 is already available and must not be
uploaded/submitted again.

| Control | Expected observable result |
| --- | --- |
| Reordered/delayed parts, exact replay, missing/corrupt/conflicting part | Same immutable union/order or explicit refusal; no partial latest artifact. |
| Shared ancestors/cross-part ports/overlapping tray ownership | Correct union AABBs/connectivity; duplicate physical fragments/conflicting ownership refused. |
| Limits at and above each layer, cancellation and restart | Actual counts/bytes/time/memory, bounded refusal/recovery and retained valid prior aggregate. |
| Same AABB, changed bend/axis/ports | Geometry/connectivity difference visible; bbox equality never means unchanged route. |
| Different export order/tessellation, offset or unit encoding | Representation/frame evidence retained; no invented physical move or modified C# input ordering. |
| Corrected unit/axis/root/manual alignment after publication | New immutable frame/mapping identity and aggregate/geometryRevision; affected comparisons/jobs/bindings stale. Existing points are never semantically rebound under the old identity. |
| Same dbId in another model/document/instance; same name after recreation | No automatic cross-version identity/binding inheritance. |
| Unique rigid equipment move/rotation; fixed point; deformation/split/merge | Qualified attachment follows once; fixed point stays fixed; unsafe migration needs resolution. |
| Shared alias on both cable ends and other cables | One confirmed binding resolution is reused everywhere with consistent revisions. |
| New shortcut on a previously unused tray or newly allowed category | All potentially improved paths are reconsidered; old used-edge lists are not the invalidation criterion. |
| S/E/P-only change versus gap/endpoint change | Verified design-only reuse versus full reroute; exact original formula/guards/warnings retained. |
| Drawing-only fact update with new full catalog/source-copy/drawing-facts hashes | Same routing revision/digest, aggregate/plan/trace/dependency/proposal hashes and no PF job; drawingInputRevision changes and the drawing becomes stale. |
| Mid-job/mid-Review/mid-Apply dependency or role change | Result marked stale or transaction refused; routing/designLength atomic and installLength unchanged. |
| Closed user browser, missing producer or revoked grant | Level A remains pending until capture; Level B only passes after actual qualified end-to-end producer check. No autonomous Review/Apply. |
| Two real converted revisions and manual engineering review | Exact source/package/capture/frame identity, measured deltas and actual human decisions; unresolved ambiguity remains explicit. |

R0 deliverable ownership: this file and its synthetic JSON are written by the
geometry-contract writer. Root owns shared R0 catalog/matrix/report/progress and
validation; policy writer owns catalog/purpose/drawing contracts. No shared code,
runtime, database, cloud resource, original checkout or synchronized source is
changed by these documents.
