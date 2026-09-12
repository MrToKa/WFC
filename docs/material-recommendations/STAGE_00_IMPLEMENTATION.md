# Material foundations: implementation and remaining gates

Date: 2026-09-12. Implementation baseline: `41d3851` on `AI-suggestion-implementation`.

This is the current execution plan for [STAGE_00_CLARIFICATIONS.md](STAGE_00_CLARIFICATIONS.md). It supersedes the earlier planning-only/database prohibition in the audit documents. The user explicitly requested the necessary application and database changes, before subsequent suggestions implementation. Historical Stage 0 source citations and test results remain historical evidence, not verification of this change.

## Decisions accepted during implementation

| Subject | Decision |
|---|---|
| Deleting an in-use project cable type | Block until its cables are reassigned. Enforce in the API and PostgreSQL foreign key. |
| Engineer access | Administrators assign projects. Engineers edit/import/export project cables, cable types/materials, trays/supports, Change Orders and Internal NCR in assigned projects. Main project settings and shared catalog imports/edits remain administrator-only. |
| Exports | Ordinary users export from projects only; engineers export from projects and catalogs. Catalog Excel templates follow catalog export permission. Existing read visibility is preserved. |
| Adding material to an existing project | Capture current catalog values at the time of the explicit addition. Already captured values remain unchanged. |
| Explicit local project/cable additions | Preserve on type replacement. Preservation alone is not a compatibility approval. |
| Edited inherited rows | Preserve as local overrides through replacement and synchronization. Keep saved fields and lineage, without changing the catalog or other project/cable rows. Do not duplicate the same source occurrence. |
| Catalog material deletion | Mark obsolete in all seven catalogs. Preserve rows, composition edges and existing references. Database triggers reject physical deletion. Exclude from new selection and retain archive/detail access. |
| Verification authority | Only administrators may verify facts/rules and review an engineering revision. The review workflow is future work. |
| Existing quantities | Keep package arithmetic: 102 units / 100 per package = 2 packages, 98 spare units. Keep automatic cable length as ceil(route metres × 1.1 + 5). Imported/manual lengths are not automatically uplifted. |
| Optional catalog refresh | No refresh action approved. Remove implicit refresh; do not introduce a substitute refresh workflow. |

## Delivery order and scope

| Priority | Workstream | Concrete change | Verification or remaining gate |
|---|---|---|---|
| 1 | FIX-08 controlled migrations | Implemented: explicit baseline/adoption, ordered checksum ledger, locking and transactional failure; normal startup checks compatibility. Independent application images and selective recreation verified against existing storage. | A separate new-machine infrastructure installation remains unexecuted. |
| 1 | FIX-07 read-only users | Database-backed administrator/shared-scope and assigned-project engineer checks, role-aware exports and matching UI controls. Account/profile operations keep their existing policy. | Assignment UI/API implemented; no real users assigned automatically. Existing read visibility is unchanged. |
| 1 | FIX-01 pure cable reads | Implemented: effective captured defaults and persisted cable additions, stable virtual row IDs, read-only consistent transactions. Materialize only inside explicit protected writes. | Isolated routed GET fingerprints, materialization and replacement checks passed. |
| 1 | FIX-02 Change Order isolation | Implemented: copied item values, local packaging/price during recalculation/export, no automatic catalog refresh. Applies to Change Orders and Internal NCR. | Independent orders, catalog update/deletion, pure reads and reopened workbook checks passed. |
| 2 | FIX-04 identity and copied values | Implemented for cable/type/material captures, Change Orders and tray/support assignments. Current reference and copied provenance stay separate. Trays capture load-curve points and image object keys; referenced images survive template retirement. | Legacy missing identities/snapshots remain unknown; historical data is never reconstructed from today's catalog. |
| 2 | FIX-06 concurrency and retries | Implemented for standard edges and catalog-owner retirement, cable/default/import/type operations, administrative cable-data clearing and Change Orders. Atomic revisions, receipts, scoped history and locks. Editors pin their read revision. | Actual PostgreSQL races/replay/rollback checks passed. Tray/support scalar editing and general catalog field editing are outside this protected mutation contract. |
| 2 | FIX-03 scoped replacement | Replace catalog-inherited defaults and retain explicit local additions; block in-use type deletion; preserve edited inherited rows locally. | Repeated replacement and synchronization verified across projects. Retention is not a compatibility approval. |
| 3 | FIX-05 quantities | Preserve characterized legacy per-parent/per-cable/per-length arithmetic; keep local procurement packaging independent from installation quantities. | Existing arithmetic approved and unchanged. Define new termination/position/deficit semantics when the corresponding suggestion role is enabled. |
| 3 | FIX-09 engineering eligibility | Keep missing facts and unverified compatibility explicit. Do not enable engineering claims based on names or nominal dimensions. | Approve pilot roles, manufacturer evidence, typed required fields and applicability/fit rules. Verification authority is administrator-only. The clarification examples are not a complete approved specification. |
| 3 | FIX-10 history and reviews | Foundation snapshots are stored transactionally for the protected composition scopes. New revision does not imply an engineering review. | Agree which historical objects need UI/export, initial full versioning scope. Review authority is administrator-only. |
| 4 | Suggestions integration | Future shared button and type filter at catalog, project cable-type and cable scopes; additions remain explicit. | Applicable identity, quantities, permissions and verified engineering gates above must pass first. No ranker/trainer/suggestions panel is delivered in this remediation batch. |

## Mutation contract

The client sends `If-Match: "<revision>"` from the state it actually read, and an `Idempotency-Key` for the logical operation. Missing revisions return 428. Stale writes return 409 and require reload/review; the application must not fetch a fresh revision silently on save and use it to bless an old edit.

The backend locks the resource inside the domain transaction. A committed matching receipt replays the stored result, even if its original revision is now old. The same key with different content returns 409. New requests check the current revision before performing their write. The domain data, next revision, complete scoped snapshot and receipt commit together. Failed operations roll back together.

The JSON transport retries an uncertain protected request once with the same key and retains that key for a subsequent user retry until a definitive response. A successful save ends the operation; a later intentional addition gets a new key. Legacy endpoints without this receipt contract are not automatically retried.

Scope is deliberate: this is not a claim that every table in WFC now has editable revision history. The protected standard graph includes copied owner records and assignment edges. Project cable-material history includes the project's cable types, defaults, cable rows and material rows. Change Order history captures the complete owning document and its items. Review authorization and historical export presentation remain separate gates.

At the first protected mutation, standard-edge, project cable and existing Change Order adapters capture the existing revision-zero state in the same transaction before changing it. Catalog-owner retirement records the graph before and after the status change, preserving all edges. A failed first edit rolls back its baseline capture too. These snapshots preserve the stored legacy values that are actually available; they do not invent earlier history or missing catalog attributes. Tray/support snapshot isolation uses transactions and row locks but does not yet add revision/receipt/history semantics to those editors. Extend that explicit mutation inventory before integrating suggestions into such write targets.

## Database execution evidence

Observed topology: PostgreSQL 18 runs in the existing standalone `wfc_app` container, exposed on host port 5434, with a persistent anonymous volume at `/var/lib/postgresql`. The repository's Compose PostgreSQL service is not this running database. MinIO runs separately as `wfc-minio` with its existing persistent bind mount. Neither storage container was recreated for these migrations.

Before migration, a custom PostgreSQL backup was made and successfully restored into an isolated verification database. The live backup, comparison manifests and execution result are under ignored `.data/backups/2026-09-12-material-foundations/`; do not commit them or credentials.

The existing schema was verified and adopted as baseline 001 without running the old initializer SQL. Migration 002 was tested against both an empty installation and a restored copy before being applied to the configured working database. It adds snapshot/current-identity/origin fields, changes in-use project type deletion to RESTRICT, and adds mutation revisions, receipts and history. Normal startup now checks compatibility without schema creation or data backfills.

Migration 003 adds nullable tray/support snapshots without a historical backfill. It passed isolated checks and was applied after another verified backup; original row values for 412 trays and 21 support-distance records compare identically. This describes the prior schema-3 release; schema-4 execution is recorded below. Applied migration files are immutable; future schema changes require another migration.

All 33 pre-existing table payloads compare identically before/after live migration when excluding the newly added fields. Existing counts include 4 projects, 2,600 cables, 87 project cable types, 4 Change Orders and 185 Change Order items. These checks establish preservation of existing stored values; they do not establish engineering correctness or reconstruct missing historical information. In the verified copy, 576 legacy cable-material rows retain unknown current identity/snapshot rather than being filled from today's catalog.

Isolated PostgreSQL checks passed for baseline creation, existing-schema adoption, upgrade, repeat no-op, forced migration rollback/recovery, in-use type deletion, stale concurrent edits, repeated receipts, changed-payload conflict, complete transaction rollback and reciprocal graph edges. The reproducible verification script is `server/migrations/verify-isolated.ts` and rejects databases outside its isolated naming convention.

Additional guarded verifiers cover cable API reads/writes and initial history, independent Change Orders, tray/support snapshots, template image retention and catalog-owner deletion races. Commands and exact deployment evidence are recorded in [DEPLOYMENT.md](../DEPLOYMENT.md). Application containers were verified at `http://127.0.0.1:5180`; frontend-only and backend-only recreation preserved the other application service and both storage containers. This loopback verification address does not replace the host development ports.

## Verification record

Prior schema-3 integrated verification, retained as historical evidence:

- `npx vitest run --maxWorkers=2`: **66 files, 788 tests passed; zero failed or skipped**. The machine-readable result is in ignored `.data/verification/final-vitest-confirmed.json`.
- `npm run typecheck`: frontend and backend TypeScript passed.
- `npm run lint`: passed with zero warnings; `git diff --check` passed.
- Final application images built successfully. The new backend image's read-only migration check passed before application replacement; both replacement application containers became healthy. Root, SPA and representative API routes returned 200, including catalog lists carrying their displayed mutation revision.
- PostgreSQL and MinIO retained their exact container IDs and mounts. A final read-only database check confirmed schema 3 and all applied checksums; existing row counts remained unchanged. Final container evidence is in ignored `.data/deployment/final-build-verification.json`.

The user's reported errors were investigated before resuming. Two missing return values in the catalog tray/support deletion client functions were real compile errors and were corrected. Older route tests needed the new transaction, revision/header and response contract; their behavioral coverage was retained. Earlier unconstrained parallel runs also produced test timeouts, so the complete final suite used two workers. The final successful run above supersedes those intermediate failures. No failed check was treated as a completed migration or successful verification.

The verified application is available locally at `http://127.0.0.1:5180`. Existing host development remains available through its usual workflow. These functional checks do not certify legacy engineering facts or resolve the decisions below.

## Follow-up implementation: obsolete materials and engineer access

Migration 004 adds nullable obsolete timestamp/actor fields and physical-delete protection to the seven master material tables, plus project engineer assignments. It does not backfill engineering facts or alter material quantities. Applied migrations are immutable.

An engineer is currently a non-administrator with at least one explicit project assignment. Removing the last assignment removes catalog export permission and project editing permission. Backend authorization reads current database grants on each request, independently of old token claims. Manage assignments in **Admin panel > Users > Project access**. No existing user is assigned automatically. Project visibility and project exports retain the existing authenticated read policy; assignments constrain engineering writes. Viewing template images/files retains its existing read policy.

**Materials > Obsolete** lists retired materials and links to their read-only details. Existing project/Change Order captures remain available. New direct selections reject obsolete materials. Expanding a composition containing an obsolete child reports a conflict instead of silently omitting the component. No restore or implicit refresh action is introduced.

Local override flags and original lineage remain intact. Replacement preserves edited inherited rows and manual additions without reinserting the same source occurrence. Retained items need an engineering check when used in a new context.

### Follow-up verification

Fresh schema-4 installation and restored schema-3 to 4 upgrade passed in isolated databases. Real API/PostgreSQL checks passed for all seven retirements, graph history/edge retention, Change Order snapshots, physical DELETE rejection, stale retirement conflicts and exact retry replay. Assigned-project access, CO/Internal NCR editing, main-settings protection, immediate revocation and ordinary-project versus engineer-catalog exports passed, including case-insensitive Express paths. Cable, Change Order, tray/support isolation, template image retention and concurrency verifiers passed against schema 4.

Final follow-up verification and rollout completed on 2026-09-12:

- `npx vitest run --pool=threads --maxWorkers=2 --testTimeout=60000`: **67 files, 810 passed, zero failed/skipped, no unhandled errors, process exit 0**. Reports: ignored `.data/verification/decisions-tests-threads.json`, `.log` and `decisions-tests-threads-exit.json`.
- Frontend/backend TypeScript, lint and `git diff --check` passed. Both final images built successfully; the rebuilt backend includes case-normalized authorization checks.
- The original test process pool passed all assertions but hit Vitest's `onTaskUpdate` RPC timeout and exited 1. This was not accepted as a clean run. The worker-thread run above resolved that runner failure without ignoring errors or excluding tests. Heavy catalog UI tests have a 60-second budget; the Change Order date test waits for the selected header to finish loading before editing it.
- Backup `wfc_app-2026-09-12T19-09-01-941Z.dump` was restored successfully to `wfc_verify_release_20260912`, where migration 004 passed. SHA-256: `7e5805ee362bca9174d1e572390d2f025c39d0cc18fca29bc8bece313e774c71`.
- Migration 004 then applied to the verified working `wfc_app` database on port 5434. **Current schema is 4**, with matching applied checksums. Original row payloads in **36 pre-existing tables** compare identically after excluding only the new nullable obsolete fields. No actual users were assigned engineer access and no existing material was marked obsolete automatically.
- The new backend image passed its read-only schema check. Only frontend/backend containers were replaced; both are healthy at `http://127.0.0.1:5180`. Root, materials SPA, project and catalog API reads returned 200; anonymous archive/export requests returned 401. Nginx's uppercase `/API/...` path serves only the HTML SPA; actual Express API permission checks were independently verified.
- A post-start comparison again confirmed all 36 original table payloads and unchanged PostgreSQL/MinIO container IDs and mounts. Evidence: ignored `.data/verification/v4-live-after.json`, `v4-images.json` and `v4-deployment.json`.

## Decisions needed before the next suggestions stage

1. **First verified pilot:** choose concrete articles and a companion role, with authoritative manufacturer/application evidence and approved positive/negative/missing-data cases. See [the Bulgarian explanation](PILOT_SCOPE_BG.md). Glands/clamps need their own rules; bolt–washer/nut and cable–marker remain required overall coverage.
2. **New quantity semantics:** existing calculations are approved and unchanged. Define per-termination/per-position counting and new deficit/top-up behavior when the selected role requires them. Procurement spares do not count as installed components.
3. **History and review presentation:** administrator-only authority is settled. Define and implement historical revision UI/export and review/correction/withdrawal workflows before using reviewed examples in suggestions.

Edited-inherited-row policy, export roles and engineer resource scope are settled. Do not reopen them as unanswered gates.

No unresolved policy is converted into an automatic engineering approval or additional permission. Independent confirmed remediation proceeds while these decisions remain open.
