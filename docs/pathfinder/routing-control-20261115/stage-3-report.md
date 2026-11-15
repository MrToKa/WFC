# Stage 3 report — full manual-route calculation and causal results

Implemented and verified locally on 2026-11-15, preserving the existing dirty working tree and concurrent Excel/UI work. Native algorithm details are in `stage-3-engine-report.md`; the executable handoff is `stage-3-integration-prompt.md`. This report covers the server integration. Browser/local application deployment acceptance is owned by the parent and is not inferred from these tests.

## Implemented behavior

`manualRoutingContracts.ts` defines a separate immutable `pathfinder.manual-route.dependencies.v1` envelope containing the entire ordinary protected v8 calculation snapshot, the exact retained manual text/revision and current capacity observation. It cannot pass ordinary Auto result or effective-route write admission. Ordered physical occurrences, including `/A/B/A`, remain significant. Only terminal SECONDARY approach notation is removed for comparison. Input is bounded to 16384 characters and 100 physical codes; native output may add legitimate terminal approach labels without exceeding those input semantics.

`manualRoutingWorker.ts` claims durable revisions with a causal generation, unique owner token and finite lease. A short real administrator/login/project transaction admits the calculation; no database transaction spans native execution. Completion rechecks exact raw text/manual revision, owner/generation, every collected dependency, implementation identity, administrator revision, installation epoch and current login. An old A→B→A completion cannot revive an earlier input. Queue retirement or re-enqueue also fences an old completion.

The worker sends the actual protected `calculate` request with `manualRouteConstraint`; it never invokes lookup or design-only geometry. `manualRoutingValidation.ts` verifies request identity, exact native physical route order, cable purpose permissions, original barrier scope/qualification/final proof, endpoint coordinates and the complete ordinary native v1 length ledger. The stored manual length is the full native Design value, including actual equipment approaches, secondary reserves, end allowance, bending and ceiling. Raw tray length is never substituted.

The explicit manual validator accepts `directSecondary:null` because mandatory trays suppress that shortcut. Ordinary automatic validation still requires its existing direct decision. Two native scheduling lanes share the same advisory-owned engine worker: preparation keeps its original prepare-only contract, while the new manual lane accepts only protected manual calculations. No competing native process pool is introduced. Startup/shutdown and the bounded calculation implementation closure include the new modules.

## Persistence, invalidation and authority

`manualRoutingSchema.ts` adds immutable manual result records and causal queue fields. Result records retain bounded full inputs/response and hashes. A compact immutable source projection binds the full record hash, input hash, exact manual-text hash, cable/project, manual revision, causal generation and full length. Ordinary list reads fetch at most the bounded compact projection rather than multi-megabyte native path geometry. A mismatched source is explicitly stale/unverified, never calculated.

Manual text edits/imports enqueue in their commit transaction. Positive execution facts still protect the effective route independently from permission to calculate a comparison length. Following the user's later clarification, a current successful **used protected manual route** now automatically publishes its full length into Design for an unexecuted cable. Unprotected retained comparisons and execution-protected cables remain derived-only. No manual result changes effective Routing, Install length, dates, automatic sources or automatic receipts.

Geometry/model/network, tray, barrier, settings and mathematical preference changes invalidate affected derived results immediately. Specific endpoint binding changes select referencing cable aliases; legacy non-ASCII names use a conservative recheck to avoid missed normalization matches. Unknown/global endpoint registry changes conservatively invalidate the project. Cable input changes target that cable, and a Cable type Purpose change targets cables linked to the changed type. Tray changes currently conservatively recheck the project's manual routes. Recalculation uses actual geometry, so extending BC182 does not blindly add 2 m to every cable.

Queue authority comes only from a real authenticated Save/import or the verified active automatic owner and its original enable command. Login bindings are established/checked during enqueue; current administrator revision and installation epoch are retained. Migrated rows without authority show `MANUAL_CALCULATION_AUTHORITY_REQUIRED` and cannot run as a service identity. An explicit unchanged Save can activate such a pending/refused check under the current administrator/login without changing the route, control revision or cable history; a current calculated check is not re-enqueued by an unchanged Save.

A protection-only release emits the existing `ROUTING_CONTROL_CHANGED` dirty event even when the business Routing pair is unchanged. This preserves a replacement automatic policy generation after the control revision fences an in-flight writer. Continuous calculation OFF remains OFF; the event does not create an unauthorized background job.

All manual authority/project locking uses bounded acquisition and SQL timeouts before attempting locks. Temporary database/engine contention uses a delayed retry without consuming the finite crash/compute attempt allowance, so a long import does not permanently invalidate a waiting cable. Other jobs continue. Repeated expired process owners reach an explicit bounded recovery diagnostic. Cancellation/deadline joins remain owned by the existing native worker.

## Current automatic fallback

`currentAutomaticRouting.ts` verifies a fallback separately from the display-only last successful Auto projection. It checks the exact immutable full result/source, sealed/native route equality and code concatenation, compatibility limits, current purpose/capacity permissions, complete current protected mathematical dependencies and barrier/implementation scope. Only incidental business cable write revision is excluded from the mathematical comparison. Changed endpoints/type/MTO in the same edit cannot reuse the old source. A stale/missing source leaves the route awaiting calculation rather than copying a historical result into current Routing.

Unchanged full-form manual intent preserves the effective route, including the first execution report; a blank manual field during an unrelated Delivery edit cannot clear a current automatic route. Legacy invalid raw manual text remains readable and unchanged during unrelated saves, with diagnostics and an explicit correction path. Newly edited text still uses strict validation. When continuous calculation is disabled, a clear/release prepares the cable and awaits an explicitly submitted/enabled automatic calculation, as agreed by the parent.

## Verification and evidence

Pre-clarification baseline `D:/WFC-Test/validation/routing-stage3-final-all.log`: **611/611 PASS, 17 files**, no skipped cases (start 12:04:24 as logged; duration 49.98 s). The command enabled both `WFC_ROUTING_CONTROL_POSTGRES=1` and `WFC_MANUAL_ROUTING_NATIVE=1` and ran the focused manual/control/proof/identity tests plus automatic ownership/mandate/writer/receipt, initial-fill, immutable revision admission, ordinary cable Auto API and barrier write regressions. The latest clarification gate is recorded below.

Actual PostgreSQL fixtures verify repeatable migration, transactional queue visibility, manual edit/uncheck/clear, first execution report, full-form no-op, legacy raw text, all five sticky execution causes, release and stale revisions. Worker tests verify immutable result/read publication, raw text retention, A→B→A, changed dependencies, login/admin/admin-revision/installation revocation, owner recovery, invalid cable followed by valid cable, pending migration authority and unchanged-Save activation. The 101-row warning test verifies progress beyond the first bounded batch. Three real held-project lock timeouts preserve the same pending job; after release it succeeds. Application databases were never bootstrapped by these tests: each suite verified the loopback test-container boundary, created its own unique database and dropped it afterward.

Four cases execute a fresh compiled native child with a new request ID and copied owned inputs through the real SQL worker and immutable read projection:

| Case | Observed result |
| --- | --- |
| Actual equipment approaches and reserves | Raw 12 m, approaches 3 m and 4 m, two 7 m replacements, allowance/bending/ceiling: full manual Design **27 m**, persisted/read correctly |
| Original sill opening | Full Design **10 m**, actual opening maneuver/final barrier proof retained |
| Closed blocking wall | No derived successful length; text retained with a concrete blocked diagnostic |
| Missing tray | `MANUAL_ROUTE_REQUIRED_TRAY_UNAVAILABLE`; `/DOES_NOT_EXIST` retained unchanged |

`manualRoutingNativeFixture.ts` never replays a stored route/length. Recorded corpus responses supply only frozen admission qualification evidence; each execute calls the real native runner. Temporary roots and databases are ownership checked and cleaned. An intermittent test-cleanup connection termination was corrected by handling the expected owned-database teardown event; the final gate has no unhandled errors.

Server TypeScript: PASS (`routing-stage3-types.log`). Scoped ESLint: PASS (`routing-stage3-lint.log`). Current Auto fallback tests additionally cover malformed bounded history, stale model/endpoint/settings/geometry/implementation/barrier sources, capacity, self-consistent crossed route/purpose semantics and real transport errors.

## Remaining boundaries

The SQL worker fixtures inject the dependency collection boundary explicitly; the four native cases use actual original geometry/barrier inputs and actual native execution. They do not certify the live converted project or replace the parent's final embedded-browser acceptance. Migration jobs require legitimate authority and never inherit a fabricated login. Conservative project-wide tray/global registry invalidation may recompute more manual routes than strictly necessary; it preserves correctness without rewriting manual text. Raw nominal tray-length edits require the prepared geometry/network to represent the physical extension for the native geometric length to change.

Excel/UI acceptance, exact application backup/deployment/restart, real WG-4022/WG-3050-1 checks and final parent stage prompts are coordinated separately. Existing automatic/native proof requirements and calculation-result authority are retained.

## User clarification: automatic Design publication

The later explicit user decision supersedes the earlier derived-only Design behavior. `manualRoutingDesignWriter.ts` publishes the current native full manual length only when `manualProtected=true`, current business Routing exactly matches retained manual text/revision, and all five execution facts plus the sticky latch are absent. A private unprotected comparison cannot own Design, even if its route text happens to equal the effective Routing. Failed/stale results retain the old Design with the existing invalid/stale calculation status.

Publication shares the current principal/project/cable/control/job/native-result transaction. It changes Design, its normal timestamp/write revision, and the existing pathfinder cable version with the real actor. Numeric equality creates no duplicate history/revision. Exact before/after snapshots reject unrelated field changes. The transaction-local pathfinder-apply flag prevents a generation loop and is restored afterward. Required history failure rolls back Design and the result together. The immutable manual result records the Design writer decision and history reference.

Manual mathematical currentness excludes only the incidental business write revision; all actual geometry/options/endpoints/settings/purpose/capacity/implementation dependencies remain compared. The writer independently fences the current locked row revision. Therefore a first execution report during native computation can still store its valid comparison result while the new date/latch suppresses Design publication.

Focused clarification gate: `routing-manual-design-delta.log`, **81 PASS** (35 actual PostgreSQL worker cases plus 46 identity cases), including fresh native **27 m** and **10 m** persisted in Design and pathfinder history; each execution cause before/during computation; sticky latch; unprotected/mismatched route; equal numeric no-op; stale owner; required-history rollback. Production write-revision and recalculation triggers plus the real history helper run in the owned SQL fixture. Server TypeScript also passes. Broader latest clarification results and the parent's live embedded-browser acceptance are reported separately.

Latest full clarification gate: `D:/WFC-Test/validation/routing-manual-design-final-all.log`, **626/626 PASS across 17 files**, including all four fresh native child executions and 35 actual worker PostgreSQL cases (start 12:25:44 as logged; 49.67 s). Server TypeScript (`routing-manual-design-types.log`) and scoped ESLint (`routing-manual-design-lint.log`) PASS. No application database or deployment was changed by this backend subtask. Next integrated acceptance is specified in `manual-design-runtime-acceptance-prompt.md`; the parent owns its current local API rebuild and embedded-browser execution.
