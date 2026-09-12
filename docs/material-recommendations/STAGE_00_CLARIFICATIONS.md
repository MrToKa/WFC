# Stage 0 clarifications and implementation workstreams

Date: 2026-09-12

Target branch: `AI-suggestion-implementation`

Related prompt: [Stage 0 detailed prompt](../../codex-prompts/material-recommendations/WFC_Stage_00_Detailed_Codex_Prompt_EN.md)

## Purpose, authority and status

This document translates and organizes the product owner's Bulgarian responses to the ten Stage 0 issues. It records confirmed requirements, explains the proposals that need more detail, and provides an ordered implementation plan. The numbering corresponds to FIX-01 through FIX-10 in the locally prepared Stage 0 issue backlog.

**Confirmed requirement** means explicitly requested by the owner. **Proposed implementation** means a technical approach or explanation, not a completed feature or an approved engineering rule. **Open decision** identifies information that is still missing; uncertainty must not be converted into a silent default.

The owner explicitly authorizes subsequent implementation across the frontend, backend and database, with checks and tests for each change. That authorization supersedes earlier planning statements prohibiting code or database changes. The present request is to create and upload this clarification document; it does not execute the implementation, migrations or deployment. No runtime behavior or live deployment topology has been verified by authoring this file.

## 1. Read-only cable opening and three levels of materials

### Confirmed requirements

Materials have three distinct scopes:

1. **Catalog cable type:** reusable standard installation materials, such as pins/ferrules and heat-shrink tubing.
2. **Project cable type:** project-specific materials in addition to the captured catalog defaults, such as cable glands in plastic, stainless steel or galvanized variants.
3. **Individual cable:** additional materials for that cable, such as a cable clamp on a mounting rail inside a panel.

Opening a cable must display its effective materials without saving, copying, initializing or replacing persisted rows. Copying, initialization and editing require an explicit action. Recommendations must be available at all three levels.

Provide a **Suggested materials** button. Initially show all applicable suggested material types, with a filter that allows the user to select a type such as cable glands. Alternatives within a role must remain alternatives; displaying them must not add them automatically.

Recommendations must respect physical compatibility. For a cable with an outside diameter of 12 mm, a gland or clamp must have a verified usable range that includes that diameter. Do not recommend undersized items or implausibly oversized items. Material variants must also respect the selected application requirements.

### Proposed implementation and acceptance

Keep the three scopes and their origins visible in the data model and UI. Build a pure effective-material reader using captured project values and explicit local additions/overrides. A historical project must not read today's live catalog defaults as a substitute for its snapshot.

Use a shared suggestions panel and backend contract with an explicit target scope. Adding a suggestion is a separate authorized transaction. A filter narrows presentation without changing compatibility rules or hiding a required role that has no eligible candidate.

**Acceptance:** repeated open/refresh/preview operations perform no writes; all three scopes display correctly; additions affect only the selected target; incompatible items are excluded and missing compatibility data is visible.

**Open decision:** define an evidence-based preference for avoiding unnecessarily large compatible clamps/glands. A nominal size or invented maximum size ratio is not an approved rule. Glands and clamps require their own verified rules before being enabled; the original bolt-to-washer/nut and cable-to-marker scenarios remain part of Stage 0.

## 2. Independent Change Order material snapshots

### Confirmed requirements

When a material is added to a Change Order, copy its current catalog values into a snapshot belonging to that Change Order item. Price is especially important, but the isolation applies to all editable copied material fields.

- Editing the Change Order item must not edit the catalog.
- Catalog edits must not overwrite existing Change Order values.
- The same material in two Change Orders may have different prices and other local values.
- Opening, exporting or recalculating a Change Order must not refresh its copied fields from the catalog or another Change Order.

### Proposed implementation and acceptance

Keep source identity separate from copied commercial/display fields. Read and export the stored item snapshot consistently. Local edits update only the owning Change Order and follow the revision/concurrency policy.

**Acceptance:** create two orders from the same material, give them different local prices, then change the catalog. Each order retains its own values through reads and exports, and neither order modifies the other or the catalog.

**Open decision:** an optional explicit catalog-refresh operation has not been requested or approved by these responses. If retained or introduced, define the before/after preview and whether it updates an editable revision or creates a new revision. This does not block removing implicit refreshes.

## 3. Deletion, cable replacement and preservation of local materials

### Confirmed requirements

| Operation | Required behavior |
|---|---|
| Delete a cable type from the shared catalog | Existing projects retain their captured cable type and inherited materials. |
| Delete a cable type from a project | Remove that project's cable-type entry and its associated materials from that project only. The shared catalog and other projects remain unaffected. |
| Replace a project cable type | Replace the old catalog-inherited defaults with the replacement type's standard materials; preserve project-specific additions. |
| Replace the type of an individual cable | Replace its inherited standard materials; preserve project-specific and cable-specific additions. |

For example, replacing a four-core cable with a five-core cable must preserve a project-added 20 mm gland. Preservation does not certify that the gland remains compatible with the new cable.

### Proposed implementation and acceptance

Track row-level origin and override state: catalog-inherited, project-added, cable-added, and locally edited inherited rows. Track current material identity separately from those origins. Preview replacements and conflicts before a destructive change, then commit the selected transition atomically.

Revalidate retained materials against the replacement cable. Keep incompatible or unverified local materials visible with a finding; do not silently delete or replace them.

**Acceptance:** catalog deletion leaves project snapshots intact; type replacement replaces only the intended inherited rows; project and individual additions survive; operations affect no other project; repeating a committed request does not duplicate rows.

**Open decisions:** define what happens to cable instances already using a project cable type when that project type is deleted. Also specify whether a locally edited inherited row is retained as an override, replaced after confirmation, or handled individually in the conflict preview. The request clearly protects explicit local additions but does not settle every inherited-override case.

## 4. Catalog identity and historical material snapshots

### Confirmed requirements

The shared Materials catalog represents current manufacturer offerings. When a manufacturer changes a characteristic and the catalog is updated, new projects use the updated material data. Existing projects keep their captured data, following the same isolation principle as Change Orders.

### Proposed implementation and acceptance

Separate three concepts:

- **Current selected identity:** material category plus stable catalog ID.
- **Origin:** source catalog/template identity and revision from which the row was copied.
- **Snapshot:** values captured for the project or Change Order at a defined point in time.

Renaming a material does not change its identity. Selecting a different material changes the current selection while preserving traceable origin. Catalog deletion must not cascade into historical snapshots. Legacy rows with ambiguous identity must be listed for review, without guessing from similar names or reconstructing old values from today's catalog.

**Acceptance:** a manufacturer attribute update appears in newly captured project material data while existing snapshots remain unchanged; identical names in different categories do not merge.

**Open decision:** define the snapshot boundary when a new material is added to an already existing project: use current catalog data at addition time, or a project-wide catalog revision pinned at project creation. Existing captured rows remain unchanged in either case.

## 5. Explanation: quantities, units, multipliers and packaging

**Owner response:** clearer separation is required, but the proposed calculation model needs explanation before the detailed policy can be decided.

A physical unit answers **what is measured**: pieces, metres, kilograms. A quantity basis answers **what the amount applies to**: one cable, one parent item, one termination/position, or one metre of cable. A multiplier is the number of those bases. Packaging describes purchasing, separately from installation consumption.

The following are synthetic arithmetic examples, not engineering requirements:

| Stored requirement | Basis/multiplier | Installed requirement |
|---|---|---|
| 2 glands per cable | 1 cable, regardless of its length | 2 pcs |
| 3 ties per metre | 10 m of cable | 30 pcs |
| 2 washers per parent | 4 parent items | 8 pcs |
| 1 marker per termination | 2 explicitly identified terminations | 2 pcs |

If 6 suitable washers are already allocated to the same role and position against a requirement of 8, the proposed top-up is 2 pcs. Washers allocated elsewhere do not automatically satisfy that requirement. An excess must be reported rather than silently removed. If the cable length or required rate is unknown, the resulting quantity is unknown, not zero.

If 30 ties are required and the purchasing package contains 100 ties, installation consumption remains 30 pcs. Procurement may show 1 package and 70 surplus pieces if whole-package purchasing is the selected policy. Package size must not multiply physical consumption or be applied twice by reports and Change Orders.

### Proposed implementation steps

1. Characterize existing calculations and preserve valid report totals with regression fixtures.
2. Represent physical unit, quantity basis, rate/count, position and packaging separately.
3. Centralize the applicable conversion and multiplication rules, ensuring each multiplier is applied once.
4. Preserve valid repeated component occurrences while preventing the same physical allocation from being counted twice.
5. Display the calculation basis in editing and reporting workflows.

**Open decisions:** confirm rounding boundaries, treatment of wastage/spares, whole-package purchasing policy, and which quantities apply per cable versus termination. Do not infer these from names or convert unknowns to zero.

## 6. Concurrent edits and repeated requests

**Confirmed requirement:** implement protection against lost updates and duplicate results. The owner accepts the general proposed approach and requests execution steps.

### Proposed implementation steps

1. Inventory every mutation of the protected composition, including add/edit/delete, imports, synchronization and type replacement.
2. Introduce a revision value. Clients submit the revision they edited; the backend checks and updates it atomically. Stale edits return a conflict with enough information to reload or reconcile.
3. Assign an idempotency key to a logical operation. Store its scoped request fingerprint and result transactionally with the mutation. The same key and payload replays the existing result; the same key with a different payload is rejected.
4. Use transactions for the complete mutation, including row changes, revision, history and request receipt. A failure leaves no partial result.
5. Serialize graph/composition changes using consistent lock ordering and revalidate cycles and current state inside the transaction.
6. Update the frontend to reuse the same key on a retry, handle stale-edit conflicts, and distinguish a retry from a new intentional addition.
7. Verify actual races and rollback behavior against an isolated database, alongside unit and API tests.

**Acceptance:** simultaneous stale edits cannot overwrite each other; duplicate retries commit once; valid repeated material occurrences remain possible; concurrent graph edits cannot introduce a cycle; failed operations leave neither partial data nor a successful receipt.

## 7. Roles and permissions

### Confirmed requirements and remaining uncertainty

| Role | Clarified policy |
|---|---|
| Administrator | May change shared catalog and project data. |
| Ordinary user | Read-only; may export selected tables. |
| Engineer | The owner tentatively recalls permission to edit certain data in a specific project; the precise scope still needs definition. |

The engineer exception qualifies the general administrator-only editing rule. It must not be interpreted as unrestricted project or catalog write access.

### Proposed implementation and acceptance

Create an explicit role/action/resource matrix and enforce it in the backend for every affected route. UI visibility is supplementary. Include catalog/template edits, project material edits, Change Orders, exports, engineering reviews and publication of project content into shared scope.

**Acceptance:** ordinary users cannot mutate data through direct API requests; project-scoped engineering access cannot modify another project or a shared catalog; approved exports enforce the same visibility rules.

**Open decisions:** exact engineer-editable resources and project assignment policy; which tables ordinary users may export; public versus authenticated reads; project visibility; who may review assemblies and publish shared templates. Unspecified permissions must not be granted automatically. Other independent fixes can proceed while these rules are clarified.

## 8. Controlled migrations and separate containers

**Confirmed direction:** prepare a plan to separate frontend, backend, database, MinIO and migrations. A frontend-only change should update only its container. The owner recalls running the application through VS Code, with only the database and file storage in Docker. This recollection and the original prompt's Docker statement must be checked against the actual deployment.

### Proposed implementation sequence

1. Inventory the actual local/deployed topology, startup scripts, service connections, volumes and backup/restore procedure. Record observed facts without exposing secrets.
2. Extract schema creation and data backfills from normal backend startup into ordered versioned migrations. Add a migration ledger, single-run locking and explicit failure/recovery behavior.
3. Provide a one-shot migration command/service with preflight checks. Keep initial empty-database setup explicit. Normal backend startup only checks compatibility and reports a useful error for an unsupported schema.
4. Build independent frontend and backend images. Use a production frontend serving configuration and explicit API routing; retain a documented development workflow.
5. Define database and MinIO as separate persistent services with health checks, private service networking, configuration/secrets injection and durable volumes.
6. Define the migration service as a controlled release step, followed by backend readiness verification. Do not have every backend replica run migrations on startup.
7. Document and verify selective build/recreation of the changed application service. A frontend-only release must not recreate the database or MinIO. Coordinated API/schema changes still require a compatible release sequence.
8. Validate fresh installation, upgrade of an existing database copy, migration failure recovery, persistence across restarts, and backup restoration in an isolated environment before rollout.

**Acceptance:** independent frontend/backend releases work where contracts remain compatible; database and file contents survive application replacement; normal backend startup performs no schema changes or data backfills; migration results are traceable and recoverable.

Container separation alone does not remove startup migrations. Treat migration extraction and independent deployment as connected but distinct work items. The optional offline ranker/trainer remains a later feature step.

## 9. Explanation: typed engineering attributes and verified rules

**Owner response:** the intent of structured attributes, units, source and verification status is understood, but concrete details are needed.

A text field such as `dimension` can describe a material to a person without supplying enough reliable facts for automatic compatibility checks. A similar name or equal nominal size does not establish that two parts fit or are suitable for the application.

### Proposed data and behavior

| Subject/candidate | Examples of structured facts needed by an applicable rule |
|---|---|
| Cable | Outside diameter and relevant application context; conductor details where the selected role requires them. |
| Cable gland | Verified cable sealing/clamping range, entry-thread details, material and required application ratings. |
| Cable clamp | Verified supported diameter range and mounting/interface constraints. |
| Cable marker | Attachment method, supported cable/conductor range and relevant marking/application constraints. |
| Bolt and nut | Nominal thread diameter, pitch and thread standard, plus any required grade, finish or application restrictions. |
| Washer | Bore and relevant geometry/standard and application requirements; a washer does not have a mating thread pitch. |

For each required value, store its typed value, canonical unit where applicable, evidence source such as a manufacturer document, and verification status tied to the relevant revision. Missing values stay missing. Store reviewed compatibility and applicability rules separately from the material facts.

A synthetic 12 mm cable passes a diameter-range check for a candidate with a verified 10–14 mm usable range. That check alone does not prove overall compatibility: mounting, environment and any other required constraints must also pass. Missing required facts return **insufficient data**. Ranking only orders candidates that pass the enabled rules.

### Proposed implementation steps

1. Define the subtype and minimum attributes for each enabled companion role.
2. Define unit normalization, validation, missing states and evidence/verification records.
3. Add fields to catalog editing and APIs and preserve them in project snapshots.
4. Implement reviewed applicability, compatibility and quantity rules as separate responsibilities.
5. Prepare a small verified pilot dataset and incompatible/missing-data cases. Do not claim the whole catalog is ready because the schema exists.

**Open decisions:** authoritative engineering sources, required application constraints and the role allowed to verify data/rules. The field examples above are a design proposal, not a complete approved engineering specification.

## 10. Explanation: change tracking, complete revisions and reviews

**Owner response:** the cable list may already have an exportable change tracker recording dates and changes. Explain whether the proposal extends that idea to materials, cable lists and related data.

Yes, the proposal includes that type of traceability, but it also needs the exact state that existed at a revision. A change log answers **who changed what and when**. A complete immutable composition revision answers **which parent, components, quantities, units, allocations and copied values existed together at that time**. A review record answers **who verified that exact revision, for which scope, and whether the review is still valid**.

### Proposed behavior

- Reuse the existing change tracker where it supports the requirement; first verify its actual coverage.
- Preserve complete relevant composition snapshots and separate revisions of reusable standard templates.
- Pin project instances to their captured values/template lineage so later catalog/template edits cannot rewrite history.
- Associate engineering review with a specific immutable revision and scope. Editing a reviewed assembly creates a new revision that is not automatically reviewed.
- Record corrections and withdrawals as history events without erasing the old review. Withdrawn examples stop contributing to future suggestions under the defined evidence lifecycle.
- Preserve lineage so many copies of one template are not treated as independent engineering examples.

Example: revision 1 contains one cable, two glands and two markers and is reviewed. A user adds a clamp, creating revision 2. Revision 1 and its review remain inspectable; revision 2 needs its own review. Revising the shared template later does not modify either project revision.

**Acceptance:** an old composition can be reconstructed without looking up today's catalog values; review of revision 1 never approves revision 2; exports of a selected saved revision remain reproducible; withdrawal preserves history and removes the relevant learning eligibility.

**Open decisions:** the initial set of objects requiring full snapshots, required history/export presentation and review authority. Define scope explicitly before extending full versioning across the entire application.

## Ordered delivery plan and verification gates

Each FIX is a separate bounded workstream. The order below expresses dependencies, not a claim that implementation has started.

| Order | Workstream | Deliverable and gate |
|---|---|---|
| 1 | Baseline and decision mapping | Inspect actual code, tests, deployment and existing data; map the requirements above to affected frontend/backend/database paths. Resolve only the open decisions needed by the next slice. |
| 2 | FIX-08 migration foundation; FIX-07 permission definition | Prepare controlled schema execution before schema-dependent changes; settle and test grants before enabling affected writes. Container packaging can finish later. |
| 3 | FIX-01 and FIX-02 pure reads | Remove implicit cable material writes and Change Order refreshes; verify display/export isolation and explicit write operations. |
| 4 | FIX-04 identity, FIX-06 mutation safety and FIX-10 snapshot foundation | Add stable identity/provenance and captured revisions, concurrency checks and receipts using reviewed migrations; report ambiguous legacy mappings. |
| 5 | FIX-03 scoped inheritance and replacement | Implement deletion/replacement rules with preserved local additions, conflict handling and transactional changes across all affected paths. |
| 6 | FIX-05 quantity semantics | Characterize and centralize arithmetic; align forms, API validation, persistence, reports and Change Orders without accidental total changes. |
| 7 | FIX-09 engineering metadata and remaining FIX-10 review lifecycle | Add typed facts, evidence, reviewed rules, exact review scope, correction/withdrawal and lineage. Enable only verified role/category slices. |
| 8 | FIX-08 independent deployment completion | Verify separate application images, selective updates, readiness, persistent services and migration/recovery procedures. |
| 9 | Three-scope suggestions integration | Add the requested button/filter and explicit additions only after applicable read, identity, quantity, permission and compatibility gates pass. Preserve the original Stage 0 scenario coverage. |

For each workstream:

1. Record the expected behavior and affected UI, API, service, database and export paths.
2. Add meaningful regression cases and prepare any migration/backfill with explicit ambiguity handling.
3. Implement the complete bounded behavior across the affected layers.
4. Run relevant static checks and unit/API tests; use an isolated database for persistence, concurrency, migration and recovery verification.
5. Inspect the resulting diff and report completed behavior, actual test results, remaining limitations and the next dependency.

Do not mark a workstream complete merely because a plan or mock test exists. Preserve pre-existing project data and user changes. Record unavailable checks honestly and keep real engineering-data readiness separate from software readiness.

## Handoff status

The product direction is clarified for the three material scopes, snapshot isolation, preservation of explicit local additions, mutation safety and container separation. Detailed quantity policy, engineer permissions, deletion of in-use project types, overridden inherited rows, engineering rules and review scope still have bounded open decisions above.

This document records requirements and proposed work. It does not assert Stage 0 audit completion, implementation completion, successful migrations, passing application tests or verified production data.
