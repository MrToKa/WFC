# PF-B13 — whole-parent barrier capacity plan

Status: **PLANNED**. This document is an implementation plan, not a geometry,
capacity, publication, routing or engineering acceptance receipt. Root executes
all builds, tests, SQL, HTTP, Viewer and runtime qualification. No current limit
is raised by this plan.

## Accepted goal and observed failure

Allow the administrator to select both complete converted RVM parents, preserve
all their relevant original triangle surfaces and openings, publish one complete
barrier set, and calculate against that exact set. Keep `Drill through the walls`
explicit, off by default, and scoped to the current calculation. Drilling must
not turn incomplete capture into a complete publication or claim collision
clearance. Existing cable Review/Apply, initial-fill and installed-length rules
remain in force.

Root's read-only 5191 observation confirms the active expected model and exact
content fingerprint:

`b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`

The retained converted package has package ID
`cc477b02-e0f9-47bc-b965-7064e93404fe`, support profile
`svf-local-7.130.0-v1`, and SDK 7.130.0. Local read-only analysis found:

| Exact selected group | dbId | Parent dbId | Nodes including selected parent | Geometry leaves | Render fragments |
| --- | ---: | ---: | ---: | ---: | ---: |
| `3D-Modell_BIS_20260304.rvm` | 3 | 2 | 321,834 | 249,692 | 382,095 |
| `DB2401_DESIGN_01-PIPE+GRID_20260304.rvm` | 321837 | 2 | 60,689 | 53,748 | 238,736 |
| Combined disjoint selections | — | — | 382,523 | 303,440 | 620,831 |

Every geometry leaf in these groups has at least one render fragment; no
non-leaf has a fragment. Parent/child relationships were consistent and acyclic.
The six property gzip files, FragmentList.pack and InstanceTree.bin matched
their manifest hashes. The manifest's canonical fingerprint was independently
recomputed from the published fingerprint format. SDK source was read to decode
property relationships and FragmentList v5 metadata; SDK code was not executed.
These facts prove retained hierarchy/fragment membership, not usable triangle
topology, actual holes, current eye-state or a successful capture.

Root also observed seven pending barrier intents, no published snapshot, and a
latest intent with the two selected parents but no capture allocation. B12 adds
truthful diagnosis/recovery presentation; it does not constitute full capture of
these parents or qualification of their geometry.

## Why the v1 pipeline cannot be used unchanged

The following are separate constraints, not one adjustable upload setting:

- `viewer-runtime/barrier-capture.mjs:4` limits one observation to 8,192
  fragments, 65,536 closure objects, 500,000 vertices, 250,000 triangles,
  32 MiB and 3,000 events. Enumeration currently retains the full hierarchy
  observation and fragment/geometry/transform maps before constructing capture.
- `shared/pathfinderBarriers.ts:11` applies aggregate geometry and byte ceilings;
  its v1 manifest contains all fragment summaries under a 256 KiB ceiling.
- `server/pathfinder/barrierRegistryRepository.ts:158` parses/copies the complete
  capture, then stores the original capture and one JSON mesh file per fragment.
  `barrierStorage.ts` allows 50,000 entries, 256 MiB per intent and 8 GiB globally.
- `PathFinder.BarrierVerifier/BarrierCaptureVerifier.cs:33` globally exact-welds
  vertices, constructs edges and connected shells, and qualifies one complete
  set. Arbitrary fragment slices cannot independently certify these shells.
- `PathFinder.ModelRunner/BarrierArtifacts.cs:87` rereads and requalifies the
  complete raw capture for a cold runtime. `barrierCalculationScope.ts:78`
  rereads the capture and every mesh during server admission.
- The v1 kernel has a 256-shell/250,000-triangle bounded in-memory domain.
  Its memory estimate includes topology/build data, not only final triangles.

At least 77 fragment-count-limited parts are required when keeping the parents
separate; actual triangle/vertex/byte limits can require many more. The current
per-fragment representation needs at least 49.7 MiB of binary coordinates and
indices even if every fragment contains only three vertices and one triangle.
This is a mathematical lower bound, not a measured actual geometry size.
620,831 individual mesh files already exceed the current entry quota. Even one
byte per fragment cannot fit all fragment summaries into a 256 KiB manifest.

Preserve the v1 contracts, ceilings, historical readers and qualification claims.
Add an explicitly versioned multipart path. Do not concatenate parts into a
larger v1 capture, call a partial set ready, fill holes, simplify triangles,
substitute bounding boxes for solids or bypass the protected Viewer producer.

## Geometry policy decision and qualification boundary

Whole RVM parents may include wall sheets, floor surfaces, open pipe meshes,
closed objects, nested shells, lines, points and equipment. The current kernel
requires qualified closed consistently oriented two-manifold solids; it rejects
open, duplicate, ambiguous and nested shell input. It cannot be advertised as
supporting these mixed parents merely because transport becomes multipart.

The proposed v2 collision domain is **centreline contact against every retained
original triangle surface**, with existing openings represented by absent
triangles. Open surfaces remain surfaces. They gain no invented thickness,
caps, volume, inside/outside interpretation or manifold certificate. Contact,
coplanarity and numerical uncertainty need explicit conservative outcomes.
Closed-solid endpoint containment may be added only for independently qualified
and unambiguous solids. Preserve the stronger v1 closed-solid domain when it is
applicable; do not silently relabel it as the new surface domain.

Before implementation of runtime acceptance, root must freeze the exact v2
policy/version and tests for:

1. Surface crossing, touching, grazing, coplanar overlap, zero-length segments,
   coincident surfaces, inconsistent winding and numerically uncertain tests.
2. A segment starting inside a real wall volume: surface-only checking does not
   establish occupancy. Either qualified volume containment supplies this check
   or the result explicitly refuses the unsupported occupancy case. It must not
   claim the v1 solid guarantee.
3. Nested closed surfaces and cavities. Do not union-fill cavities based only on
   enclosing bounds or guessed shell orientation.
4. Lines/points and unavailable/nontriangle primitives. Inventory them with
   exact classification and reason. A versioned policy may state that a line
   has no blocking surface; it cannot infer a solid from that line or silently
   omit triangle-bearing fragments. Unclassified or failed triangle extraction
   prevents complete publication.
5. **Accepted user decision — equipment self-contact:** allow only the initial
   exit through the cable's own chosen From object and final entry into its own
   chosen To object, up to that object's first external surface. Later re-entry
   is not exempt. Every other obstacle remains checked throughout these terminal
   portions. Do not extend this into exclusion of the whole connector, ancestor
   RVM, source file or a convenient enclosing box.

   Bind this exception to the durable saved endpoint-owner identity in the exact
   project/model/capture scope. If the chosen equipment is a parent, retain its
   exact descendant membership and geometry provenance. Selecting a whole RVM as
   a barrier does not make that RVM an endpoint self-exclusion. A matching name,
   coordinate, nearest object or bounding box alone is insufficient identity.
   Derive the initial prefix/final suffix and first external contact from actual
   geometry; prove contiguity and retain contact evidence. Do not exempt later
   contacts, re-entry or another object's surface in the same region. Missing,
   stale or ambiguous owner/exit evidence must not yield an exempt clear result.
   The behavior is accepted; its numeric boundary and actual-geometry proof still
   require implementation and qualification. No further user decision is needed
   for this terminal-only rule.

The planner and storage stages below can be implemented while these policy
decisions remain open. Their receipts say inventory/capture complete only;
neither supplies runtime admission or a geometry-qualified/clear claim.

## Stage 1 — versioned contracts and pure multipart planner

Status: **PLANNED**. One designated contract writer first freezes interfaces;
other writers consume them only after agreement.

New suggested files:

- `shared/pathfinderBarrierMultipart.ts` and focused schema tests.
- `viewer-runtime/barrier-plan.mjs`, `.d.mts` and pure planner tests.

Suggested immutable concepts:

- `BarrierMultipartScope`: existing model/frame scope, exact selected parents,
  producer/profile version and profile digest.
- `BarrierInventoryPage`: bounded ordinal range, node/fragment ownership and
  membership records, parent/page binding and page digest.
- `BarrierInventorySeal`: ordered page digest root, exact totals and explicit
  primitive classifications. No client `ready`, actor authority or path field.
- `BarrierGeometryPartPlan`: ordinal, source fragment/geometry identities,
  original triangle ranges, coordinate/transform identity and maximum payload.
- `BarrierGeometryPartReceipt`: exact staged content reference, ordinal, counts
  and original-source range coverage. It is not a qualification receipt.
- `BarrierMultipartSeal`: immutable ordered parts/catalog root and all coverage
  counts; no missing, overlapping or duplicate triangle range is permitted.

Use existing per-part ceilings as hard upper bounds, including at most 8,192
fragment references. A single unusually large fragment must be representable by
ordered original triangle ranges across parts, with explicit source vertex
identity/remapping. Do not require an arbitrary fragment to fit wholly in one
part or mistake a successful first range for complete fragment coverage.

Planning has two explicit sealed inputs: protected inventory, then protected
geometry size/range inventory. Any subdivision/refinement receives a new
immutable plan digest before its payload is accepted. No in-place mutation of an
admitted plan. Shared source mesh instancing is permitted only with exact source
bytes and per-occurrence transforms/memberships retained; it cannot remove
physical occurrences.

Checks: deterministic ordering; both parents; overlapping selections; repeated
fragment identity; unknown owners; gaps/overlaps; safe integer arithmetic; exact
size boundaries; empty/unsupported data; an oversized single fragment; immutable
input behavior; digest changes for frame, membership, ranges or policy changes.
Tests must assert that pure planning never yields publication/runtime authority.

## Stage 2 — protected paged inventory and bounded capture

Status: **PLANNED**.

Owning files: new multipart Viewer module alongside
`viewer-runtime/barrier-capture.mjs`, its protocol/types, `src/viewer/ViewerController.ts`,
`src/api/pathfinderBarriers.ts` and focused tests. Keep the v1 entrypoint intact.

Enumerate exact own-and-descendant membership in deterministic bounded pages.
Use compact visited/ownership state or externalized page state; do not retain
all transformed geometry or node snapshots. Yield/cancel between bounded work
units. Backpressure the next page/part until the exact previous acknowledgement
is received. Capture only through the protected currently loaded model and
verified physical transform path, never an unprotected page/script workaround.

Maintain project/model/load/frame/selection/Viewer-session binding throughout.
Before sealing, repeat complete hierarchy and transform identity bookends and
bind their ordered digest to the same inventory. A changed or unavailable model
cannot produce the complete seal. Do not infer completeness from counts alone.
Resumption uses exact immutable part receipts and current authority; a refreshed
session must not silently take over an old capture or extend expired authority.

Report inventory, captured parts, captured triangles, unsupported primitives and
remaining work separately. Progress is observational, not engineering approval.
No route calculation uses staged parts.

Checks: no SDK internal mutation; selection/model/load change in every phase;
missing geometry; transformed/instanced geometry; cancellation; late replies;
duplicated, reordered and lost acknowledgements; final changed bookends;
bounded events, message bytes, callbacks, per-part memory and finite duration.

## Stage 3 — packed server storage and atomic publication

Status: **PLANNED**.

Suggested new files: `server/pathfinder/barrierMultipartSessions.ts`,
`barrierMultipartStorage.ts`, additive schema and routes with focused unit/SQL
tests. Shared existing schema/routes have one designated writer.

Reuse patterns from `preparationSessions.ts` for immutable plan/part receipts,
idempotency, lease fencing, state transitions and final transaction; reuse
`barrierStorage.ts` for server UUID-only paths, no-link identity checks,
hash/readback, exclusive creation, fsync and bounded quotas. Do not borrow
`preparationUnionTask.ts` as an executor: its 2 GiB RSS allowance and merged
snapshot materialization do not satisfy this barrier design's 512 MiB guard.

Persist packed bounded parts and paged catalogs, not one file per fragment.
Binary64 coordinates and bounded integer index/range records can avoid JSON/DOM
duplication while preserving the exact exported numeric values. Freeze and test
the codec, signed-zero policy, endianness, counts and hashes before using it as
proof. Retain source transforms, original triangle indices/ranges and memberships.

Reserve bounded disk capacity before accepting a plan. Profile total staged and
published bytes, temporary external-sort space, retained prior snapshots and
concurrent reservations. The current 8 GiB quota is not evidence that this model
fits; derive estimates from the actual geometry inventory and enforce free-space
headroom. No unbounded part count, file count, job duration or disk growth.

All part writes are immutable and idempotent. Final publication requires complete
global coverage, exact qualification/catalog proofs and current authorization,
model/frame and expected head revision through COMMIT. Publish one head and one
receipt atomically. Missing/refused/uncertain parts keep the prior head. Unknown
COMMIT acknowledgement reconciles the exact command; no optimistic ready state.
Lease renewal is an explicit current-authority operation with a finite overall
job budget, not automatic renewal of a stale authoring mandate.

Checks: corrupt/truncated/replaced/link files; quota race; disk full; missing and
conflicting parts; duplicate command with different bytes; crash checkpoints;
lease expiry; actor/login/role loss; changed head/model/frame; lost COMMIT ACK;
old-head readability; no staged geometry admitted into calculations.

## Stage 4 — global qualification and bounded spatial queries

Status: **PLANNED**. Geometry policy above must be frozen before acceptance work.

Owning modules: new versioned multipart reader/qualifier in
`pathfinder-engine/src/PathFinder.BarrierVerifier`, new paged spatial oracle in
`PathFinder.Barriers`, and `PathFinder.ModelRunner/BarrierArtifacts.cs`,
`BarrierRoutingExecution.cs`, `SessionExecutionContext.cs`. Preserve routing
Core11 math and the existing v1 verifier/kernel behavior.

Process one bounded source page at a time. Global topology operations that are
actually required by the chosen policy use external exact-key sorting/indexing:
vertex identity, triangle provenance, edges, components and cross-part spatial
checks. An arbitrary part boundary is never a physical shell boundary. Do not
close an open mesh, epsilon-weld it, simplify it or remove coincident geometry
without an explicit independently qualified semantic rule.

Persist a server/engine-produced immutable spatial catalog with conservative
bounds, source/qualification roots and fixed versions. AABB/BVH bounds choose
candidate pages only; actual triangle tests determine collision. Queries use a
bounded page cache and finite work/I/O/time budgets. An incomplete catalog,
unreadable candidate page, exhausted traversal or numerical uncertainty returns
indeterminate/refused, never clear. Qualified solid containment must visit all
required solid data across pages with deterministic numeric accumulation.

Keep the existing combined engine RSS guard **512 MiB** and existing managed
worker memory policy. Do not load every raw part or all catalog pages before a
query. Cold loading verifies exact artifacts; warm reuse requires immutable
catalog identity and fresh source/currentness checks. Changed scope releases
previous cache references. No cached route or clearance result becomes authority
for a different route, policy, frame or catalog.

Checks: a shell split across parts; a real opening crossing page boundaries;
surface intersections at boundaries; containment across pages; distant-page
exclusion; large candidate sets; corrupt pages/indexes; deterministic cold/warm
results; bounded cache eviction; cancellation and resource refusal. Unit output
must distinguish surface-contact coverage from closed-solid containment.

## Stage 5 — v2 admission, proofs, historical compatibility and UI

Status: **PLANNED**.

Owning files: versioned shared barrier runtime/admission/write schemas and
`server/pathfinder/barrierCalculationScope.ts`, `barrierWrites.ts`,
`barrierStrategy.ts`; engine runtime profile/context validation; affected result
and historical proof readers. Root designates one writer for each shared file.

Admission receives only the exact published multipart root/profile reference.
Validate immutable catalog/publication membership without materializing the raw
whole-model capture on each request. A receipt or internally consistent hash
alone does not establish publisher authority. Bind exact snapshot, model/frame,
head revision, geometry semantics/profile, exact endpoint-owner/terminal-contact
policy evidence and drill choice into calculation
dependencies, results, Review/Apply, initial-fill and pending-write recovery.

Use explicit additive versions and strict readers. V1 historical results remain
readable, with their original bounded guarantees; they cannot renew current v2
write authority. Preserve the existing initial-fill rule: automatic cable-list
writes only when both routing and design length are empty; otherwise comparison,
explicit Review and Apply. Preserve installed length. Never downgrade to a
collision-unaware job when the v2 set is not ready.

The UI displays capture completeness, qualification state, actual collision
domain, declared coverage and actionable refusal separately. Selecting these
whole parents must not imply that only civil walls were selected. Keep the
previous head visible while authoring a replacement and show exact pending
command recovery after an uncertain write.

## Stage 6 — synthetic cross-part and fault qualification

Status: **PLANNED**. Root executes fresh isolated tests; retain all failures.

Required matrix combines the checks above with: missing/duplicate triangle
ranges; cross-part holes; transformed instances; overlapping selected parents;
mixed closed/open/nontriangle data; duplicated/coincident surfaces; accepted
initial-own-exit/final-own-entry behavior; later re-entry; another obstacle inside
an exempt terminal region; wrong/stale owner; parent descendant changes; attempted
whole-RVM self-exclusion; nested cavities; boundary numerical cases;
all auth/currentness changes before COMMIT; file corruption after publication;
unknown ACK recovery; stale historical proof; drill off/on; protected writes and
initial-fill refusal; cold/disk/warm equivalence; default memory/time/I/O ceilings.

A pure planner PASS, schema PASS, all-uploaded state or synthetic geometry PASS
cannot stand in for actual model qualification. Independent checks should read
the retained original source/range inventory and query results rather than reuse
the same planner's asserted totals as an oracle.

## Stage 7 — actual Aalborg cold/warm qualification and delivery

Status: **PLANNED**.

1. Root confirms the same active fingerprint, both exact parents and current
   protected frame. Preserve B12 failed attempts and the prior published state.
2. Produce complete bounded inventory, actual primitive/triangle/vertex counts,
   estimated temporary/published disk use and the immutable multipart plan.
3. Capture both complete parents with no missing triangle ranges. Retain refusal
   details if any primitive or topology policy is unsupported.
4. Qualify and publish under root's owned test/delivery process. Measure process
   RSS, disk, work, events, deadlines, page/cache counters and positive process
   exit/join proof. No limit increase or unchanged blind retry after failure.
5. Run actual cold and warm queries, including the reported cable
   `=H1=KF1=TAC1=WGA1`, blocked wall/floor crossings, genuine existing openings,
   mixed-surface controls and explicitly selected drilling. Independent retained
   source-based checks and the user's engineering review are separate evidence.
6. Verify exact result/currentness/write proofs and no unintended cable-list
   writes. Do not perform an agent real Apply as a qualification shortcut.
7. Deliver through the appropriate owned API/schema/runtime path; this is not a
   web-only update. Complete actual migration, backup/restore and authorization
   gates appropriate to the final implementation. Record remaining limitations.

## Execution split and completion rule

After Stage 1 contracts freeze, independent writers can own: (A) pure planner
and coverage tests; (B) protected Viewer paging/capture; (C) server storage/session
state and publication; (D) engine codec/qualification/paged queries. Root owns
shared integration, execution, proof-version consumers and delivery. Coordinate
overlapping protocol/schema changes before edits; preserve concurrent work.

Stages 1–3 may finish with a complete retained capture while Stage 4 is refused
or unimplemented. Such a result is useful evidence but is **not ready for
routing**. This task is complete only after all required stages have actual
passing evidence for both whole parents, truthful supported geometry semantics,
unchanged 512 MiB process guards, protected publication/admission/writes and the
reported real cable behavior. Until then each unfinished stage remains PLANNED
or its actual observed failed/refused status, never presumed PASS.
