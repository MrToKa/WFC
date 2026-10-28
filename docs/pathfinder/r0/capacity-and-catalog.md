# PF-R0 — catalog source audit and preparation capacity

Status: **contracts/source audit**, not R1 import or R3 full-network acceptance.
Baseline: `916256f0da14b8f21ca039b34bfae2de33b2bb0d`, isolated branch
`pf-r0-purpose-contracts-local-20261019`. The parent executes runtime operations;
this audit performed no SQL, HTTP, tests, environment reads or application edits.
Applicable scope: [plan 32](../32-purpose-and-revision-plan.md) and
[R0 assignment](../handoffs/PF-R0-purpose-revisions.md).

## 1. Observed data, with distinct evidence scopes

The parent's [fresh guarded counter receipt](evidence/catalog-counts.json),
recorded at `2026-10-18T21:21:45.507Z` / 19 October 00:21:45 Europe/Kyiv,
is **PASS for the stated read-only count query**. It binds port 5191, owner
`8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, copied project
`1af0f807-7653-40ea-8391-7eea6c54e7d4` and active model
`a613151e-c370-45c5-80f3-42ae58603b9a`; the active-model identity matches.

| Selected-project observation | Actual count |
| --- | ---: |
| Trays / purpose report-template mappings | 0 / 0 |
| Cables / cable types | 2140 / 50 |
| Types missing purpose / diameter | 50 / 50 |
| Active Path Finder jobs | 0 |

These counts do not prove source catalog completeness, type fact fidelity,
full-model geometry, historical purposes or engineering acceptance.
The earlier [stage31 backup receipt](../evidence/copied-recovery/drill-1792346855507-3c0a7ebd.json)
pins manifest SHA256 `89b2c63ff10b97e36fab42bed3195d50f9f2d99522d3ee529a98b16fb39f335a`.
That retained manifest also has zero rows for `trays` and
`project_tray_purpose_templates`, across the entire 5191 backup database at
18 October 18:06–18:07 UTC. This historical observation is separate from the
fresh selected-project query. The stage31 27-table lossless audit excludes these
two tables; its preservation result is not tray-catalog fidelity evidence.

## 2. Existing persistence and transport contracts

- [Tray schema](../../../server/db.ts:871): project-owned UUID/name/type/purpose,
  NUMERIC width/height/length in millimetres, grounding and trefoil settings,
  timestamps/change log. `(project_id, lower(name))` is unique. `purpose` is free
  TEXT; the [five UI suggestions](../../../src/constants/trayPurposeOptions.ts)
  are not a database enumeration.
- [Public tray mapping](../../../server/models/tray.ts:60) converts NUMERIC to
  JavaScript `number`. It is suitable for the existing UI, not a lossless numeric
  transfer proof. Retain exact source numeric strings and NULLs independently.
- [Tray validation](../../../server/validators.ts:589): name up to 200 characters,
  type/purpose up to 500; numeric dimensions 0–1,000,000 mm. The database alone
  does not establish that every historical row satisfies current input validation.
- [XLSX import](../../../server/routes/traysRoutes.ts:799) is a normal supported
  alternative, first worksheet only; [upload bound](../../../server/utils/excelUpload.ts:7)
  is 5 MiB. It transactionally upserts case-insensitive names. Matching material
  tray dimensions override workbook dimensions. It does not import grounding,
  trefoil, support or report-template dependencies, nor preserve numeric text.
- Grounding references `cable_types`; the mutation route verifies same-project
  membership. Material tray type is a text lookup, with load-curve, image-template,
  rung and weight dependencies. `project_support_distances` can reference a support.
  [Project tray data](../../../server/routes/projectTrayDataRoutes.ts:13) supplies
  the required project-scoped catalog view without exposing global authoring.
- [Purpose report templates](../../../server/db.ts:172) map purpose to a file
  belonging to the same project; [synchronization](../../../server/routes/projectsRoutes.ts:88)
  validates ownership and replaces the mapping inside the project transaction.
  This is **not** routing permission storage. New routing permissions and drawing
  positioning require separate contracts/revisions and must preserve these mappings.
- The [copied seed](../../../scripts/pathfinder-copied-project/README-seed.md)
  intentionally created 50 minimal types. Missing purpose/diameter/weight is not
  permission to invent engineering facts. PF category uses cable MTO; existing
  drawings/free-space also require actual cable-type purpose/diameter.

## 3. R1 recommended transfer, not yet executed

1. Use a fresh bounded read-only export of the exact authorized original project,
   retaining the existing source-copy project/endpoint/read-only guards. The
   [source-copy reference](../../../scripts/pathfinder-current-inputs/README-source.md)
   binds original UUID `0c0007c9-d73f-4d13-bc87-601c544727b7`, full name
   `HPU Aalborg 2023`, number `P230039 / H.7500062`. Reobserve actual identities.
2. Capture trays and dependency closure, raw names/purposes, exact NUMERIC text,
   source row/revision identities and before/copy/after hashes. Keep business rows,
   source-to-local mappings and provenance private; publish counts/hashes only.
3. Create an immutable plan for the owned 5191 project. Reuse the retained seed's
   source-to-local map for existing types; include referenced grounding types not
   in that map. Enrich minimal types only against verified expected fields/revision,
   preserving intervening edits. Do not rewrite cables or their engineering values.
4. Reuse global material/support/curve facts only after exact equivalence, or create
   independent owned rows when valid. A conflicting globally unique type name is
   a visible conflict; do not overwrite another project's dependency or rename
   authoritative source facts silently. Missing facts remain unresolved.
5. If report templates are included, map new project-file identities and copy bytes
   into owned storage keys with SHA verification. Original keys/user ownership do
   not become local dependencies. Preserve source provenance separately.
6. Apply through a bounded SERIALIZABLE transaction/project lock with exact planned
   IDs, repeat recognition and explicit refusal of partial/foreign/changed state.
   Verify target ownership and baseline first. A lost commit response requires
   reconciliation of the same plan, never regeneration of IDs or blind replay.
7. Read back exact business/numeric/FK values; compare expected mapped differences,
   preserve pre-existing rows and storage, and confirm source preservation. Do not
   use the existing initial-seed-only verifier after model/workflow changes.

Catalog authority is today's project data. Historical model-observed purpose
must remain separate. Applying today's purpose to both model versions cannot
prove that purpose changed between those versions. Name normalization collisions,
including slash/case variants, must be reported rather than silently merged.

## 4. Current limits are not whole-plant capacity evidence

| Layer | Current implemented bound and source |
| --- | --- |
| Routing selection | 100 route codes or rules; rules total 512 selected root IDs. [Protocol](../../../viewer-runtime/protocol.mjs:30), [capture validation](../../../viewer-runtime/model-capture.mjs:61). |
| Equipment input | 4096 staged names, 256/chunk, 16 chunks, 1 MiB serialized input; unbatched 256 names. [Input limits](../../../viewer-runtime/capture-input.mjs:2). |
| Protected geometry capture | 4096 selected objects **including ancestors**, 64 MiB, 3000 events, 24 KiB/event, 300 s; SDK index up to 1,000,000 objects. [Capture limits](../../../viewer-runtime/model-capture.mjs:4). |
| Geometry totals | 100,000 fragments; 5,000,000 vertices and triangles; depth512; 1024 properties/object. Capture and assembler check aggregate totals. |
| File/HTTP input | UI snapshot file 250 MiB; authenticated admin server artifact parser 256 MiB. [UI](../../../src/pages/ProjectDetails/PathFinderTab.tsx:120), [server](../../../server/app.ts:67). These do not widen bridge limits. |
| Engine model | 256 MiB canonical snapshot, 1,000,000 objects, 100,000 fragments, 5,000,000 vertices/triangles, depth512, two cached models. [ModelLimits](../../../pathfinder-engine/src/PathFinder.Model/Contracts.cs:112). |
| Route graph | Defaults200,000 nodes/1,000,000 connections; validated ceilings1,000,000/4,000,000. [Job options](../../../server/pathfinder/jobContracts.ts:4). These are guards, not measured real graph size. |

No existing source establishes a 250-route preparation limit: 250 MiB is the UI
file bound. One SDK property scan of 438155 records and one 13-object diagnostic
snapshot do not demonstrate complete routing geometry. New multipart extraction
must not evade per-part or aggregate guards by treating parts as separate graphs.

## 5. Measurable R3 preparation/capacity acceptance

The following is a **proposed benchmark/acceptance protocol**, not current product
behavior, a throughput promise or a statement that the real catalog fits.

1. Pin checkout/engine/runtime revisions, image IDs, host CPU/RAM, SDK, both model
   fingerprints and requested catalog/policy revisions. Record distinct counts of
   trays, purposes, selected roots, physical leaves, ancestors, fragments, vertices,
   triangles, equipment names and serialized bytes. Count root/part overlap explicitly.
2. Exercise the complete requested real catalog against **both** retained old/new
   packages, plus synthetic boundary/over-limit cases. A bounded refusal is honest
   FAIL/BLOCKED for that real scope, not a synthetic PASS for whole-model capacity.
3. Use existing per-part guards as the first candidate envelope: at most100 route
   codes or rules,512 total explicit rule root IDs,4096 objects,64 MiB and300 s. Choose smaller
   batches from measured geometry counts; do not publish partial captures as latest.
4. Before execution record explicit aggregate byte/object/mesh/graph limits and a
   finite whole-session deadline. Keep current engine limits unless a separately
   reviewed implementation and benchmark justifies changing them. Measure planning,
   property reads, mesh capture, transport, aggregation, graph construction and
   validation separately; record elapsed time rather than declaring an untested SLA.
5. Initial **harness-only candidate** guards: one preparation at a time;30-minute
   whole-session watchdog;120-second aggregate-validation watchdog;2 GiB owned
   aggregate-worker process-tree RSS ceiling. These are proposed refusal boundaries,
   not existing settings or guaranteed completion times. R3 must preflight available
   isolated resources, explicitly implement/record applicable guards, or report that
   profile NOT_RUN; never consume protected services' memory budget or silently
   extend a limit. Browser capture retains its own300-second per-part bound.
6. Record worker peak RSS and measurement interval; collect browser heap/process
   observations with their actual attribution limits. A shared browser process RSS
   is not isolated tab memory. Missing instrumentation is NOT_MEASURED, not memory PASS.
7. Validate every part's SHA, model/coordinate/policy identity, inventory, sequence,
   object membership and duplicate consistency. Refuse missing, repeated-conflicting,
   altered, foreign, stale or cancelled parts. Preserve the last complete artifact;
   publish one aggregate atomically only after all required parts and graph checks pass.
8. Prove cross-part connectivity, including boundary neighbours and a shortcut on
   a previously unused tray. Compare aggregate node/edge identities and selected
   routes with a one-part fixture; permuted part arrival must yield the same canonical
   aggregate/hash and deterministic route/tie results. No per-part route concatenation.
9. Cancel during indexing, mesh capture, upload and aggregation. Record acknowledgement
   and owned-work termination times, no later publication, retained prior artifact
   and cleanup scope. Use proposed harness checks of2 s UI acknowledgement/10 s owned
   process drain; unsupported timing remains NOT_RUN/FAIL, never a fabricated result.
10. For timeout, corruption, role/login revocation, model/policy/catalog changes and
    restart, prove either the complete validated aggregate or whole-operation failure.
    No partial latest graph, guessed coordinates, automatic Review/Apply or lost prior
    evidence. Keep exact failing receipts; reruns use fresh evidence identifiers.

## 6. Authorization and outstanding evidence

[PF router](../../../server/routes/pathfinderRoutes.ts:14) requires admin;
[principal transactions](../../../server/pathfinder/auth.ts:27) recheck the current
database role, login and expiry through commit. [Large-body preflight](../../../server/app.ts:26)
checks the same boundary before buffering. Existing tray edit rights alone cannot
authorize policy/preparation changes. A normal drawing viewer may receive only the
project/tray-authorized layout snapshot, without access to PF/model operations.

R0 unknowns retained: original catalog/dependency counts and fidelity, actual
normalization collisions, whole-catalog mesh and graph sizes, old/new historical
purpose availability and cross-revision identity coverage. R1/R3 must measure these.
The fresh zero-tray/type-deficiency observation is PASS; complete catalog import,
complete geometry preparation, capacity, comparison and engineering acceptance
remain **NOT_RUN** in this document.
