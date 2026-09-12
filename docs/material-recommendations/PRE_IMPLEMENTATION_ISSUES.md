# Priority fixes before suggestions implementation

Date: 2026-09-12. Source baseline: `96bcb58827c15ea738933f3adc3fcead837aff11`. This backlog follows the user's instruction to address necessary correctness problems before continuing suggestions implementation. It supersedes the earlier recommendation to develop the suggestions panel in parallel with remediation. The Stage 0 design remains the reference for eventual feature contracts.

**Current status:** The original list below records audit findings and proposed resolutions. The user subsequently supplied [STAGE_00_CLARIFICATIONS.md](STAGE_00_CLARIFICATIONS.md) and authorized the necessary application and database changes. That authorization supersedes the earlier database prohibition. Follow [STAGE_00_IMPLEMENTATION.md](STAGE_00_IMPLEMENTATION.md) for the current order, implemented scope, actual verification and unresolved decisions; the historical acceptance proposals below do not independently define completed work.

Priority describes prevention value and dependency, not evidence of a production incident. Observed findings come from source inspection; production data damage and frequency are unverified. Distinguish existing behavior needing correction or a product decision from new data foundations that suggestions will require.

## Working order

1. Protect reads and user-authored values: FIX-01 and FIX-02, then FIX-03 with the identity work in FIX-04.
2. Harden arithmetic and mutations: FIX-05 and FIX-06; define permissions in FIX-07 before enabling changed endpoints.
3. Prepare the controlled schema workflow in FIX-08 before applying any schema-dependent fix. The authorized migration foundation has now been applied through schema 4, including material retirement and project engineer assignments; execution and preservation evidence are recorded in the current implementation plan.
4. Complete required material and snapshot foundations: FIX-09 and FIX-10.
5. Review evidence for each item before resuming suggestions. No suggestion panel, ranker, similarity index, trainer or model is part of this remediation batch.

For each selected issue: agree on intended behavior, record a failing characterization/regression case, implement the bounded correction, run relevant checks, and report what changed and what remains unverified. Apply necessary migrations within the owner's authorized scope only after target verification, a restore-tested backup and isolated upgrade checks. Unresolved product and engineering decisions remain explicit gates.

## FIX-01 — Cable details reads can modify components

**Priority: highest. Type: observed read side effect. Status: proposed; first behavior decision pending.**

Evidence: `server/routes/cablesRoutes.ts:2720`, details GET, calls `ensureCableMaterialsInitialized` at line 2755. The initializer (`server/routes/cablesRoutes.ts:1413`) can call `resetCableMaterialsToCableTypeDefaults` (`server/routes/cablesRoutes.ts:1357`), deleting/inserting component rows and updating initialization/customization flags. `src/pages/CableDetails.tsx:525`, loader, uses this path.

Risk: opening or refreshing a page changes persisted material state. A new pure suggestions endpoint would not solve this if the page still invokes the existing mutating details request.

Proposed solution: extract a pure effective-material projection; distinguish persisted rows from virtual inherited defaults. Move materialization/reset to explicit authenticated operations. Never pass a virtual row identifier into an existing persisted-row PATCH/DELETE. On explicit first edit, materialize and edit atomically against the current default/assembly version, or require a separate explicit copy action according to the selected UX.

User decision: show inherited defaults without saving (recommended), or show an empty list until explicit copying. This concerns display/first-edit behavior; both options keep GET read-only.

Acceptance: repeated details reads execute no INSERT/UPDATE/DELETE/DDL and change no flags/timestamps; initialization and empty/customized states are covered; display and quantity reports agree; existing authored rows are never removed by opening a page. Existing report virtual-default logic at `server/routes/cablesRoutes.ts:1903`, `buildCableReportSummary`, is a reuse candidate, not a reason to retain writes.

Schema dependency: pure reader can be prepared against existing fields; explicit first-write concurrency may depend on FIX-06. No live endpoint or backend startup during current no-DB-change work.

## FIX-02 — Change Order reads can refresh historical commercial values

**Priority: highest. Type: observed behavior requiring explicit product policy. Status: proposed.**

Evidence: `server/services/changeOrderService.ts:305`, `getChangeOrder`, calls `synchronizeChangeOrderMaterialOrdering` at line 330; the helper updates catalog-derived commercial fields (`server/services/changeOrderService.ts:157`). The detail and export routes consume this service. This does not establish that every field, such as unit price, is refreshed.

Risk: reading/exporting an existing document can alter stored order/packaging information after catalog changes. Historical reproducibility cannot be promised.

Proposed solution: GET/export reads stored snapshot values only. If catalog refresh is desired, expose an explicit operation with a before/after preview, permissions and revision handling. Return header totals and items from a consistent document revision. Keep catalog-source identity separate from copied display/commercial values.

Decision to ask when this issue starts: should explicit refresh update an editable draft, or always create a new document revision? Do not invent a finalized/draft state the application does not currently enforce. Until decided, remove no user-requested refresh capability silently; characterize it and prepare the proposed replacement.

Acceptance: catalog edits followed by repeated GET/export do not change persisted document fields; explicit refresh affects only the confirmed document/revision; old snapshots remain readable; quantities/package totals remain internally consistent. Extend existing Change Order mock tests; real historical persistence tests await an authorized isolated DB.

Schema dependency: removing implicit refresh is separable from a full revision model; robust new revision operations depend on FIX-06/FIX-10.

## FIX-03 — Synchronization/type changes can discard local edits

**Priority: highest. Type: observed destructive behavior whose desired policy needs confirmation. Status: proposed.**

Evidence: `server/routes/cablesRoutes.ts:1601`, default alignment, overwrites mismatched linked rows; stale default rows can be deleted at line 1639. Material PATCH (`server/routes/cablesRoutes.ts:3077`) retains the default link while setting only the global customized flag. Cable-type change (`server/routes/cablesRoutes.ts:2603`) invokes a full material reset.

Proposed solution: distinguish untouched inherited rows, explicit overrides and manual rows at row level. Preserve overrides/manual rows by default. Present additions, updates, removals and conflicts before explicit synchronization/type replacement; require an explicit choice for destructive effects. Keep original source links while recording current override state. Do not infer historical override intent solely from today's difference from a changed template.

Acceptance: a customized inherited quantity survives normal sync; manual rows survive; disappearing defaults with overrides become visible conflicts; parent change does not silently delete authored work; repeated sync is stable. Decisions about deliberate reset remain available as explicit actions.

Dependencies: FIX-04 identity and FIX-06 transactional version checks; a durable per-row override state may require prepared additive migration. Ask about keep/replace policy when implementing, not as an assumed approval now.

## FIX-04 — Current material identity is mixed with name/origin

**Priority: high. Type: observed integrity gap. Status: proposed.**

Evidence: `server/routes/cableTypesRoutes.ts:1263`, default PATCH, can update a name without changing original source fields. `server/models/cableMaterial.ts:19`, public model, lacks direct current catalog identity; `server/services/projectCableTypeSnapshotService.ts:5` stores original provenance.

Proposed solution: use category+catalog UUID for current selection, separate from source/template lineage and copied text. Update UI/API selection and affected manual/import/sync paths consistently. Preserve the existing seven-category child-catalog mappings. Use enforced concrete references as designed in Stage 0; do not create an unchecked name-based relation.

Backfill: direct trustworthy links map automatically only where they establish the current identity. Ambiguous, renamed or conflicting rows go to a review report; no fuzzy merge/deletion or automatic classification. Unresolved identity must remain visible and must not count as zero when computing a future deficit.

Acceptance: renaming a catalog label does not change identity; intentionally choosing a different material updates current identity while preserving origin; same label in different catalogs does not merge; ambiguous legacy rows remain unresolved. Database mapping/execution requires later authorization.

## FIX-05 — Quantity basis, units and aggregation are insufficiently explicit

**Priority: high. Type: verified legacy semantics plus missing foundation; not a claim every current total is wrong. Status: proposed.**

Evidence: `server/routes/cablesRoutes.ts:1819` converts pcs/m using design length; `server/services/changeOrderService.ts:63` distinguishes fixed per-cable companions from parent multiplication; `server/services/changeOrderService.ts:105` computes packaging separately. `server/services/standardMaterialService.ts:160`, aggregation, flattens occurrence provenance.

Proposed solution: characterize current calculations first, then centralize explicit physical-unit/basis conversion at the appropriate shared boundary. Distinguish fixed per cable, per parent, per position and per length; procurement packaging is separate. Add occurrence/role/position allocation data required for future deficits without changing legacy report totals by assumption. Unknown quantity remains unknown; rounding requires an explicit policy.

Acceptance: fixed cable companions do not multiply by cable length; rate quantities multiply once; packaging does not inflate physical consumption; synthetic 2×4−6=2 pcs works; legitimate repeated branches count while a single physical allocation is not counted twice; unknowns and overages remain visible. No broad report rewrite before these cases are pinned down.

Dependencies: pure arithmetic fixtures can start immediately; persisted allocations depend on FIX-04/FIX-08/FIX-10.

## FIX-06 — Concurrent edits and repeated requests are not protected consistently

**Priority: high. Type: observed protection gap; race consequences inferred from source. Status: proposed.**

Evidence: `server/services/standardMaterialService.ts:388`, update, reads/merges/writes without an expected revision. Graph validation reads state without graph serialization. `server/routes/cablesRoutes.ts:2927` inserts a new UUID per add; `server/utils/transaction.ts:4` provides a transaction but not an idempotency/revision protocol.

Proposed solution: add revision preconditions, atomic request receipts for duplicate retries, resource/graph locks in consistent order and transactional revalidation. All affected add/edit/delete/sync/import/type-change routes must participate. A repeated request with the same key and payload replays; a distinct intended addition remains distinguishable. Do not prevent valid repeated material occurrences with blanket name/material uniqueness.

Acceptance: stale edit conflicts instead of overwriting; duplicate retry commits once; concurrent opposing graph edges cannot create a cycle; failed transactions leave no partial revision or receipt. Mock tests verify contracts, but actual isolation/race behavior needs a later authorized disposable DB.

## FIX-07 — Access and reviewer policies are not explicit enough

**Priority: high before exposing changed operations. Type: observed current policy and unresolved product decision, not proof public access is unintended. Status: proposed.**

Evidence: `server/app.ts:36`, router mounts; `server/middleware.ts:28`, admin check; `server/services/projectService.ts:5`, project existence check. Object-to-project matching does not establish user membership. Some catalog reads are public, catalog/default writes admin-only and cable writes authenticated.

Proposed solution: document the intended read/write matrix, then enforce it consistently at backend boundaries. Preserve stricter existing target rights. Separate shared catalog/template writes, project writes, engineering review and permission to publish project content into a broader shared scope.

Decision to ask at implementation: all authenticated users across projects, or explicit project membership; intended public catalog visibility; named reviewer/approver policy. Do not silently remove existing access or invent user grants.

Acceptance: every affected endpoint has allow/deny cases, including another project's object ID, non-admin default edits, unauthorized review and project-to-shared disclosure. No data export or learned evidence bypasses these checks later.

## FIX-08 — Backend startup also changes schema/data

**Priority: mandatory execution prerequisite for schema-dependent work. Type: observed operational coupling. Status: proposed.**

Evidence: `server/index.ts:13`, startup invokes `initializeDatabase`; `server/db.ts:13`, initializer contains DDL and backfills. Starting the server is not a safe verification shortcut under the current user constraint.

Proposed solution: prepare an explicit versioned migration/initialization workflow with preflight, ledger and recovery guidance. Normal startup checks schema compatibility and reports an actionable mismatch without silently migrating; intentional empty-install setup is separate. Coordinate deployment changes before switching startup behavior, so existing installations do not break unexpectedly.

Acceptance: startup never runs domain/schema migrations in normal mode; migration artifacts are reviewable and repeatable; failures roll back or resume predictably; compatible existing installations retain their data. Under current authorization, SQL execution and actual backup/restore tests remain NOT RUN. Docker runtime layout also needs verification before deployment changes, not before pure code work.

## FIX-09 — Engineering subtype, metadata and approval are absent

**Priority: mandatory before real compatibility suggestions. Type: new foundation, not an existing feature regression. Status: proposed.**

Evidence: `src/api/types/material.ts:46`, installation material uses free-text type/dimension; existing composition validation checks identity/quantity, not application compatibility.

Proposed solution: add typed subtype and required attributes with canonical units, missing state, evidence and approval revision. Define applicability/compatibility/quantity rules for bolt→washer/nut and cable/type→marker with the user's engineering guidance. Keep category separate from subtype and physical unit separate from purchasing unit. No default thread standard, marker count or interpretation of a name is automatically approved.

Acceptance: verified examples and insufficient-data cases are explicit; unknown required attributes cannot yield eligible compatibility; separate nut/washer roles remain alternatives; whole-assembly constraints are checked. Full catalog cleanup is unnecessary, but every enabled material/rule must meet the requirement. Prepare schema and fixtures now only when this issue is selected; load no real data under current prohibition.

## FIX-10 — Assembly/template versions and review provenance need foundations

**Priority: mandatory before reusable/reviewed suggestions workflows. Type: new foundation plus historical isolation requirement. Status: proposed.**

Evidence: `server/models/cableVersion.ts:6` stores cable header history rather than a complete component snapshot; `server/services/projectCableTypeSnapshotService.ts:5` copies values/provenance without a versioned reviewed-template model.

Proposed solution: immutable assembly/template revisions with pinned copied values, exact review scope, lineage roots and append-only correction/withdrawal events. Keep old unknown template provenance unknown; do not reconstruct old values from the current catalog. A template edit cannot propagate automatically to existing instances; save and engineering review remain separate actions.

Acceptance: template edits preserve existing project snapshots; reviewing revision 1 does not approve revision 2; withdrawal removes learning eligibility without erasing history; copies are not independent evidence. User review/publish permissions follow FIX-07. No ranker or training implementation is included in this foundation issue.

## Current decisions and completion rule

The first requested user decision concerns FIX-01's display of uninitialized cable materials. No answer is assumed. Ask later decisions when their issue is selected, avoiding a questionnaire covering every future rule at once.

Recommended first bounded change after the user's guidance: FIX-01 pure cable details projection plus regression tests and explicit first-write behavior. FIX-02 can follow as a separate change. All items remain open until implemented and checked; a mock-only result must not be recorded as verified DB concurrency or migration success. Resume suggestions work only after reviewing the applicable remediation/foundation results with the user.
