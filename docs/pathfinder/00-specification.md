# PF-0 — PathFinder web contracts and parity baseline

This is a **proposed specification**, not an implemented API, database migration or running service. PF-0 produces documentation and reference data only. Its baseline is WFC `e1ef20202598bb4d3d78e4772cbbb9747ec23a00` and PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a`; see [baseline](00-baseline.md), [parity fixtures](00-parity-fixtures.md), [validation matrix](00-validation-matrix.md) and [stage report](00-stage-report.md). Source findings establish implementation facts at these revisions; they do not establish cross-host numerical parity.

## 1. Accepted outcome and boundaries

The user wants the complete existing PathFinder workflow inside WFC, without installing or running desktop Navisworks for the eventual web workflow:

- A new project tab, provisionally named **PathFinder**, available **only to administrators**; all interface text is English.
- The project's selected 3D model, using the protected offline Viewer and the accepted translucent Ghost behavior already used by Routings viewer.
- Automatic resolution of each cable's From/To locations, automatic route calculation and PathFinder-equivalent geometric/design length calculation.
- Explicitly flagged cables when a location is missing or ambiguous, with manual resolution by selecting an object/point or entering coordinates.
- A location entered once is reused by other cables in the same project, regardless of whether it appears as From or To.
- All three engineering allowances come from **Project > Details**: `secondaryTrayLength`, `endConnectionLength`, `additionalBendingPercent`. The **PathFinder formula and semantics** remain authoritative.
- Automatic calculation creates a proposal. An administrator reviews and explicitly applies routing/design length to the cable list. Recalculation never silently overwrites existing cable values.
- Development uses new WFC/PathFinder branches and an isolated local environment first. PF-0 does not edit the original checkouts, running containers, PostgreSQL, MinIO, volumes, model resources or existing acceptance history. No deployment, push or merge is authorized by this stage.

This scope replaces the desktop host dependency, not the need for a model converter. The existing Autodesk conversion/Viewer path may remain. Conversion success and visual loading do **not** establish computational readiness or equivalence with native geometry.

## 2. Current WFC facts and extension constraints

The existing Viewer displays a route supplied as ordered names; it does not calculate an engineering route. [`RoutingCable`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/src/api/routingCables.ts#L4) contains nullable text From/To and routing. [`Cable`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/src/api/types/cable.ts#L26) additionally has nullable MTO, persisted design length and install length. No coordinate location registry or routing graph appears in the inspected schema.

[`calculateAutoCableLength`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/src/utils/cableLength.ts#L5) sums entire tray lengths, adds each SECONDARY token, applies the project percentage, then adds the end allowance outside that percentage. It is called only for the separate **Auto calculated length [m]** display in [`CableDetails`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/src/pages/CableDetails.tsx#L1160), with persisted **Design length [m]** displayed separately at line1402. It currently does **not** automatically overwrite persisted design length. This legacy display must not be presented as an equivalent PF result. Its eventual treatment is a later UI decision; PF-0 leaves it unchanged.

Current cable edits/imports can change routing/design length. History records source `manual` or `import`; it has no engine/model/settings provenance. [`updateCableSchema`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/server/validators.ts#L513) has no expected concurrency token; its `revision` field is an engineering revision string. The current [`update route`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/server/routes/cablesRoutes.ts#L2417) is transactional but reads the source without an update lock (`859`) and updates by project/cable identity (`2582`), then appends history (`2638`). PF apply therefore needs a dedicated transactional compare-and-apply contract; reusing today's unrestricted PATCH is insufficient.

### Strict administrator access

`canViewAll` is not an administrator check: [`canReadCatalogs`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/src/utils/permissions.ts#L8) also permits engineers, and [`canEditProject`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/src/utils/permissions.ts#L11) permits assigned engineers. Existing tab guards use these broader capabilities ([`ProjectDetails`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/src/pages/ProjectDetails.tsx#L201)). The proposed tab must use explicit `user.isAdmin` for menu, direct URL, mounting and data access.

Every new endpoint, including location/result reads, job status and exports, must require the current database administrator permission using [`requireAdmin`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/server/middleware.ts#L32), in addition to authenticated project identity validation. [`requireProjectAccess`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/server/middleware.ts#L165) alone permits assigned engineers. Revocation, deleted accounts and expired sessions must prevent later reads/applies. No graph/location/model bytes or results cross project boundaries.

## 3. Proposed processing architecture

1. **Model preparation and graph build:** extract validated geometry/properties/transforms, construct a versioned routing graph and record computational diagnostics separately from visual readiness.
2. **Independent calculation core:** preserve the PathFinder algorithms with neutral, host-independent inputs and deterministic outputs. An internal C# calculation service is a **PF-1 implementation proposal**, not an installed service or approved deployment topology. The extracted core may also be tested directly without HTTP.
3. **WFC orchestration:** own authorization, locations, cable/settings snapshots, jobs, review/apply, persistence and audit. The client cannot choose authoritative project settings or bypass stale-result checks.
4. **Protected Viewer:** render the exact computed path and support endpoint selection through bounded, validated bridge messages. Browser rendering geometry is not the length calculator.

Prepare graph artifacts once per model content/adapter/options version and reuse them for many cables. Graph generation must be reproducible; native hidden-state exclusions, category rules and manual connectivity corrections are inputs with provenance. A visually ready model can remain `graph_not_prepared`, `graph_failed` or `graph_needs_review`.

## 4. Full current PathFinder behavior to preserve

The exact source inventory and reference cases belong in [parity fixtures](00-parity-fixtures.md). At the pinned PF commit the reusable calculation families include name resolution; straight and bend geometry; mesh clearance; endpoint approach; graph construction and route calculation; manual ordered lookup; geometric/design lengths; result reversal and diagnostics. Navisworks adapters supply captured data and display behavior, not the routing mathematics. No active route export implementation was found in this reference build.

Pinned PF source anchors (commit `45c24bf5f433f13e102600b36f20327c77961d0a`): `AddinRibbon/Routing/RouteCalculator.cs` lines27,140–153,501 and862–884; `AddinRibbon/Routing/CableDesignLength.cs` lines12–27; `AddinRibbon/Routing/RouteLookupCalculator.cs` lines175–178; `AddinRibbon/Routing/RoutingModels.cs` lines150–205. Native capture anchors are `AddinRibbon/Services/RoutingSession.cs` lines213–222 and240–303, plus `AddinRibbon/Services/TrayMeshReader.cs` lines39–59. These describe the inspected original implementation, not newly extracted code or runtime tests.

### Geometry and graph

- Preserve hierarchy, effective native visibility (including ancestors), fragment geometry, world transforms, source units, metre conversion and identity mapping. Equipment input is the centre of the bottom face of the **visible world-space axis-aligned bounding box** in the native capture baseline.
- Distinguish straight centreline geometry, fitted bend polylines and documented fallbacks. Geometric bend approximation, source tessellation and transforms can change numeric outputs; exact SVF/native parity remains unproven.
- Preserve category filtering and the core's connection-gap/clearance rules. The existing default maximum connection gap is0.25m; it is an explicit snapshot value, not a hidden adapter default.
- Preserve lexicographic search priority: minimize connection-gap count, then summed clearance quantized to micrometres, then physical length. This is not simply shortest geometric distance.
- Preserve the endpoint-approach policy. Native UI defaults vertical preference to true, while the core API defaults it to false. Every snapshot must record the choice explicitly.
- A camera-occluded object is not necessarily excluded. Ghost, isolation, selection and transparency are display states; they must not silently change a prepared graph. Planning exclusions require separate explicit persisted inputs.

### Lengths and SECONDARY

Let `Lgeom` be the unrounded geometric length; `Dfrom`/`Dto` the actual approaches; `Sf`/`St` the core's SECONDARY flags; `S` the project's SECONDARY length; `E` the project's end-connection reserve; and `P` its percentage.

`Lgeom = graph physical length + Dfrom + Dto`

`Dsecondary = (Sf ? Dfrom : 0) + (St ? Dto : 0)`

`Nsecondary = (Sf ? 1 : 0) + (St ? 1 : 0)`

`Ldesign = ceil((max(0, Lgeom - Dsecondary) + Nsecondary * S + E) * (1 + P / 100))`

- SECONDARY **replaces** each flagged actual endpoint approach for design length. Do not add the actual approach again or count diagnostic gap length twice.
- Preserve the strict threshold test: approach distance **greater than**, not equal to, the threshold becomes SECONDARY; current default threshold is2m. Store the actual chosen threshold.
- Add connection reserve once per cable **before** applying percentage. There is no additional invented bend/slack formula: bends contribute through the geometric path, with the project percentage applied as the existing core does.
- Preserve the PF numeric conversion/rounding order, including the current unrounded geometric result to decimal design calculation and final ceiling to whole metres. A three-decimal UI display must never become an intermediate calculation input.
- Read all three allowances from the project row at calculation/design-length recalculation time. `S=0`, `E=0` and `P=0` are valid. `S=null` is not zero; if a result uses SECONDARY, design calculation is `settings_required`, while available geometric diagnostics may still be shown. No PF default replaces a missing project value.
- A settings-only change can recalculate design length for an unchanged valid path; it creates a new result/settings snapshot and review requirement, not a silent cable update.

### Ordered lookup, reverse and output

Manual ordered lookup preserves its distinct existing semantics: adjacent duplicate route names are merged, nonadjacent repeats remain; branches/loops and continuity diagnostics are retained. It does not fabricate equipment approach tails or SECONDARY flags. Reverse swaps endpoint-related data and path order consistently while preserving applicable aggregate metrics. Record the calculation mode so an ordered lookup is not misrepresented as an automatic From/To result.

Results include route text, **exact `PathPoints`**, ordered segment identities, geometric/design length breakdown, endpoint approaches/SECONDARY flags, gap metrics, warnings and algorithm settings. A name string or existing approximate yellow line cannot substitute for these outputs. Current native capture and display behavior is inventoried in the parity document. If an export is separately added later, it must consume the same reviewed result rather than recalculate with WFC's old helper; adding exports is not a PF-0 feature.

## 5. Proposed neutral data contracts

Contract names/fields below are **proposed**, not existing TypeScript/C# types or HTTP routes. [Contract notes and illustrative JSON](contracts/README.md) are documentation only. All identities are server-generated or server-validated, all coordinates finite, and all references are scoped to their project. Unknown schema/engine/artifact versions fail explicitly. Set bounded sizes, timeouts and cancellation rules before implementing a transport.

### A. Computational model and graph

| Field group | Required meaning |
|---|---|
| Identity | `projectId`, `modelVersionId`, source content fingerprint, source adapter/version and geometry artifact SHA256 |
| Coordinates | Declared original units, `sourceToWorldMetres`, `globalOffsetMetres`, canonical right-handed Z-up world metre convention and precision; coordinates alone are insufficient |
| Objects | Stable model identity where available, version-local identity, parent/effective native visibility, extracted properties and eligible category/name evidence |
| Geometry | Meshes/primitives, polylines, ports/bounds and derivation/fallback diagnostics needed by the pinned core |
| Graph | Graph ID/revision/hash, engine/adapter versions, explicit construction settings/exclusions, connectivity corrections and readiness/diagnostics |

Display SDK dbIds and per-capture PF counter IDs are not durable cross-version identities. Keep an explicit mapping between model objects, engine segments and WFC tray records; never infer unique identity from a nonunique displayed name. Manual bridge edges must be distinguished from modeled physical connections and participate in invalidation/review.

The proposed canonical geometry frame is **right-handed, Z-up, metres**; all engine geometry, anchors, path points and bounds use this one frame. For column-vector homogeneous coordinates the normative composition is `pWorldMetres = sourceToWorldMetres * pSource`. The column-major affine matrix includes original-unit scaling, axis conversion and the full source/root placement, and **excludes** the display offset. `globalOffsetMetres` is a vector in the canonical frame, used once for display rebasing: `pDisplayLocalMetres = pWorldMetres - globalOffsetMetres`; a picked display-local point returns via `pWorldMetres = pDisplayLocalMetres + globalOffsetMetres`. Geometry already in canonical coordinates must not be transformed a second time. A real SDK adapter with a different display axis/unit convention must declare and invert that additional display transform; it must never guess or apply both the SDK's already-applied root transform and the source matrix. PF-2 must prove this mapping and native endpoint-bottom equivalence against actual source/model transforms before enabling real-model calculation.

### B. Project location and model binding

| Record | Required meaning |
|---|---|
| `ProjectLocation` | Canonical project-scoped UUID, display name, normalized lookup key, confirmed aliases, revision and audit |
| `LocationBinding` | Project/location/model/version identity, model-object reference or explicit virtual/manual point, world metre coordinates and derivation/transform convention, source (`automatic`/`manual`), confirmation, revision and audit |
| `LocationResolution` | Original cable input, canonical location ID when known, `resolved`/`missing`/`ambiguous`/`stale`, candidate evidence and selected binding revision |

Proposed lookup normalization is conservative: Unicode NFC, outer whitespace trimming and documented invariant case comparison. Preserve leading `=`, separators, interior whitespace, punctuation and significant zeroes. Do not strip equipment hierarchy or invent aliases; normalization collisions and multiple model candidates remain ambiguous. A confirmed alias is project-scoped and audited. The same location record is reusable in **both From and To**.

Automatic lookup first consults confirmed project identities/aliases and valid current-model bindings, then extracts exact matches from configured model properties. Fuzzy matches may be suggestions only. Manually confirmed bindings have precedence over conflicting automatic proposals until explicitly changed. A missing string on a cable still needs an explicit identity; a coordinate alone must not silently invent its From/To text.

Manual entry supports selecting the equipment object, selecting an explicit3D connection point, or entering a finite coordinate with an explicit coordinate system/unit. Preserve the distinction between native-compatible equipment-bottom derivation and an intentional custom point. Saving a confirmed location reevaluates all waiting/outdated cables referencing that identity in either direction; this generates proposals only.

On a new model version, revalidate object identities, transforms and bounds. Manual virtual coordinates require explicit revalidation or a documented unchanged coordinate reference. A prior confirmed record is retained as history and cannot silently become a valid binding in a moved model.

### C. Calculation snapshot and proposal

| Field group | Required meaning |
|---|---|
| Input identity | Schema version, project/cable IDs, server-owned cable input revision/hash and original From/To/MTO values; a separate server-owned `cableWriteRevision` also binds the current destination routing/design length and manual-lock state |
| Model identity | Model version/content fingerprint, active-selection revision, graph ID/hash, adapter and engine versions |
| Endpoints | Both canonical location/binding IDs/revisions, coordinates/derivation and confirmation/source |
| Rules | Explicit PF category, category mapping version, connection gap, SECONDARY threshold, vertical preference, exclusions and mode |
| Project settings | `secondaryTrayLength`, `endConnectionLength`, `additionalBendingPercent`, settings revision/hash and `source: project-details` |
| Proposal | ID, immutable input hash, path artifact/reference/hash, exact points/segments/route text, physical and design breakdown, warnings/status and creation audit |

Cable MTO currently includes MV/LV/Instrumentation/Control, while PF routing categories are a different contract. The user explicitly confirmed the following mapping on **17 October 2026**:

| Cable MTO | PF routing category |
|---|---|
| MV | MV |
| LV | LV |
| Control | Control |
| Instrumentation | Control |
| Null, unknown or ambiguous | `category_required`; no automatic routing until resolved |

Existing tray occupancy heuristics are not this routing policy. Record the mapping version in every input/result snapshot so subsequent rule changes invalidate affected proposals.

Suggested cable-facing states are `pending`, `from_missing`, `to_missing`, `both_missing`, `location_ambiguous`, `location_stale`, `category_required`, `settings_required`, `no_path`, `calculated`, `outdated`, `applied` and `manually_locked`. Represent multiple simultaneous issues as structured diagnostics as well as a primary state. `calculated` means a proposal exists; it does not mean cable data was saved or engineering acceptance was given.

Suggested job states are `queued`, `running`, `completed`, `cancelled` and `failed`, with bounded progress/error diagnostics and per-cable outcomes. Job completion may include unresolved cables; it must not be reported as all routes successful. Browser closure does not imply cancellation; eventual job recovery/cancellation/duplicate semantics must be implemented and tested separately.

### D. Review and apply

The proposed apply command contains project/cable/proposal identity, a unique idempotency key and expected cable-input/model-selection/graph/location/settings revisions or hashes, plus the **server-owned cable write revision** captured with the reviewed proposal. `cableWriteRevision` advances for every relevant manual, import or PF write to routing/design length or manual-lock state, even when From/To/MTO are unchanged; it is distinct from the engineering `revision` string and the calculation-input revision. A stale write revision conflicts rather than overwriting a newer manual/imported value. An opaque server-issued compare token may encode these identities; a client supplied `expected` value never replaces authoritative rereading.

In one transaction, reauthorize the current administrator, validate the reviewed result and current dependencies, lock/check the cable including its write revision, apply **routing and design length only**, append cable history with calculation provenance, and record the apply receipt/idempotency key. Dependency/version checks and authorization must remain protected through commit using an appropriate transaction/locking or equivalent serialization strategy; a READ COMMITTED reread followed by an unprotected interval is insufficient. Manual/import writes increment the write revision and invalidate affected proposals in their own atomic update. Installation dates, install length, manually entered equipment labels and unrelated fields remain untouched. Concurrent dependency changes return a conflict/outdated result with no partial writes. An already successful identical replay returns the original receipt after current authorization; reuse of the key with different payload fails.

Track provenance independently of a mutable name: engine/adapter/input/path/settings/model identities, source `pathfinder` versus `manual`/`import`, author, review/apply time and prior/new values. Manual edits and imports remain explicit operations; they must invalidate related PF proposals and any claim that the modified value is still the applied PF result. A valid prior manually locked result is never overwritten by a new calculation. Repeated apply of unchanged content must not append meaningless duplicate history.

## 6. Viewer and UI contract

The new tab uses the same active project model, with a cable list/status filters, calculation actions, endpoint resolution controls, result breakdown, review and apply. A selected problem cable must show which endpoint/condition is missing. Saving one location visibly reports which other cables can now be reevaluated. Candidate routes use original tray colors, exact computed path and accepted translucent context; Clear restores the prior native state.

Current [`protocol`](https://github.com/MrToKa/WFC/blob/e1ef20202598bb4d3d78e4772cbbb9747ec23a00/viewer-runtime/protocol.mjs#L4) caps messages at65,536bytes and permits no pick/computed-path commands. A **proposed future** versioned extension uses bounded pick/selection messages and a protected result reference for large paths. That reference resolves only through WFC authorization bound to project/model/load/result identity, not an arbitrary external URL; precise resource/session authorization and integrity checks remain future implementation work. Small bounded path payloads can be considered when their full envelope stays below the limit. Do not expose unrestricted SDK objects, `NOP_VIEWER`, credentials or arbitrary script execution to the parent application.

Stale model/session/load/request responses cannot change current endpoint selection or display another model's result. Planning visibility/exclusions are separate from transient Ghost/camera state. New selection events require explicit object/point/coordinate metadata; do not reinterpret an ordinary Viewer click as a saved location.

## 7. Evidence, readiness and stopping condition

PF-0 can complete with an exact source inventory, proposed contracts, a parity case catalogue, traceable evidence gaps and consistent examples. Synthetic arithmetic/geometry examples must be labeled illustrative. They are not native captured outputs or proof that a conversion preserves geometry. Do not invent verified expected values when historical raw native outputs are unavailable.

**PF-1 prerequisites and scope proposal:** freeze core input/output/rule/numeric contracts and category-policy handling; extract/pin the independent core, establish a local runner/service boundary and executable deterministic core fixtures. Historical native capture gaps must be recorded, but need not block synthetic standalone core development. No WFC runtime deployment is implied.

**PF-2 gates:** actual converted-model geometry/identity/visibility extraction, transforms/units, graph connectivity/category mapping and native-versus-converted reference outputs must be demonstrably adequate before claiming real-model parity or enabling reviewed production cable writes. The absence of raw native reference cases blocks that parity claim, not documentation or synthetic core work. Real-model visual readiness alone never clears this gate.

Later implementation needs strict admin/project tests, location reuse and ambiguity cases, PF geometry/math golden cases, proposal/apply conflict and history tests, original Viewer regression checks, and isolated backup/recovery/performance checks. PF-0 records them as `NOT_RUN`; documentation checks do not stand in for functional tests.

Completion stops at documentation/reference-data review. No production code, UI, migration, graph build, API, service, Docker change, live data write or install is part of PF-0. Preserve original acceptance reports and evidence unchanged.
