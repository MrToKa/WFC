# Suggestions action plan: dependencies and release gates

**Sequencing update:** The user subsequently requested remediation before continuing suggestions. Follow [PRE_IMPLEMENTATION_ISSUES.md](PRE_IMPLEMENTATION_ISSUES.md) first. The milestones below remain the downstream plan; the earlier proposal to build a suggestions panel alongside remediation is paused pending those fixes and user guidance.

Date: 2026-09-12. Follow-up to [Stage 0 design](STAGE_00_DESIGN.md), [verification](STAGE_00_VERIFICATION.md) and [Stage 1 handoff](STAGE_01_HANDOFF.md). Original audit baseline: `96bcb58827c15ea738933f3adc3fcead837aff11`.

**Current execution plan:** [STAGE_00_IMPLEMENTATION.md](STAGE_00_IMPLEMENTATION.md) records the remediation against `41d3851`, its checks and remaining decisions. The user has authorized application and database changes after providing [STAGE_00_CLARIFICATIONS.md](STAGE_00_CLARIFICATIONS.md); this supersedes the original audit's database prohibition. Downstream milestones below are historical proposals and must follow that updated plan. Do not develop or enable suggestions until the applicable remediation and engineering gates pass.

## Decision

The findings affect different capabilities at different times. They do not require a complete catalog cleanup or a complete ML platform before development starts. Close the dependencies for the specific capability and supported data slice before enabling it. Build shared foundations once, but release progressively: catalog preview, explicit project writes, reviewed/template workflows, similarity, then optional supervised ranking.

This plan refines the rollout order in the Stage 1 handoff. Its nine work packages remain useful implementation tasks, with dependencies evaluated for each enabled role and target scope. The owner has paused prototype and suggestions development until the applicable remediation is complete. Do not call partial foundation work completion of the full Stage 1 handoff, or confuse a synthetic prototype with production-ready recommendations.

The quoted conversation is explanatory context, not engineering evidence. Existing installation catalogs use free-text `type`/`dimensionMm`; Stage 0 did not establish a verified bolt/nut/washer/marker subtype classification (`src/api/types/material.ts:46`, MaterialCableInstallationMaterial). Matching a designation such as M10 alone is not the approved compatibility rule. Required attributes and application constraints come from reviewed rules (design §4.3), not a name parser or a model.

## What each finding blocks

| Finding | Effect | Minimum needed before enabling dependent behavior | Work that can proceed earlier |
|---|---|---|---|
| Missing typed/verified engineering metadata | Cannot claim compatible candidates or known applicability/quantity for affected subjects | Reviewed subtype, physical units, necessary subject/candidate attributes and application rules for the pilot slice; missing values explicitly block conclusions | Shared types, validators, synthetic rules/UI, candidate retrieval and deterministic ordering; other verified slices need not wait |
| Ambiguous inherited/current identity | Existing rows may be mistaken for another material; deficit or training evidence becomes unreliable | Stable current identity separate from original provenance for the assembly being evaluated; unresolved rows produce uncertainty | Catalog preview using existing `(category, UUID)` identities; mapping report and isolated adapters; no need to resolve every legacy project |
| Missing role/position/quantity semantics | Can duplicate satisfied parts, count components from another position, multiply quantities twice | Typed role/position allocations, known basis, occurrence accounting, compatible-unit calculation and explicit top-up transaction | Read-only alternatives without claimed assembly deficit; synthetic quantity tests |
| Cable GET initializes materials | Opening a supposedly read-only project preview can write | Pure projection path for the actual page/load flow, with no initialization/reset; move initialization behind explicit action when integrating that page | Catalog-only preview using pure catalog reads; tests for pure project projection |
| Change Order GET/export refreshes commercial fields | Historical procurement fields can change when read; old values are not fully immutable | Pure historical/snapshot reader and controlled refresh for feature paths that consume or promise frozen Change Order data | Catalog preview independent of Change Orders; explicitly limited project workflows whose recommendation path does not invoke Change Order refresh |
| Missing concurrency/idempotency and explicit review/scope permissions | Acceptance can duplicate/overwrite; data can be used or published in the wrong scope | Current-state revalidation, revision/graph locks, receipts and existing target permissions before writes; reviewer/export/publish grants before those operations | Authenticated catalog-only preview with documented permitted catalog scope; mock permission/transaction tests |
| Unknown real dataset and deployment topology | No claim of real-data quality, evaluation power or operational readiness | Verified pilot data before production eligibility; actual API/container networking before ranker deployment; independent labels/gates before ML promotion | Code/design and deterministic preview; no Python service needed for the first milestone |

Source anchors: `server/services/materialCapabilities.ts:19`, MATERIAL_CAPABILITIES; `server/services/projectCableTypeSnapshotService.ts:5`, snapshot; `server/routes/cableTypesRoutes.ts:1263`, renamed default PATCH; `server/routes/cablesRoutes.ts:2720`, details GET; `server/routes/cablesRoutes.ts:1903`, buildCableReportSummary; `server/services/changeOrderService.ts:305`, getChangeOrder; `server/services/standardMaterialService.ts:388`, updateStandardMaterialAssignment. Details and test limits are retained in Stage 0 rather than reinterpreted as new runtime evidence here.

## Ordered milestones

### M0 — Bound the pilot and prepare evidence

Select one first pilot according to available verified metadata. Prefer catalog cable-type to cable-marker preview if its evidence can be obtained sooner, because the catalog already has a cable-type identity and numeric diameter field; diameter alone is insufficient. If fastener documentation is more complete, start with bolt to separate washer/nut roles instead. Keep both adapters in the shared design and validate both with synthetic fixtures.

Prepare a small inspectable pilot inventory: exact category/UUID, typed subtype, manufacturer/application evidence, required attributes with units, role applicability, quantity basis and approved context. No arbitrary row-count target proves sufficiency. Include alternatives, incompatible examples, missing-data examples and a required role with no eligible candidate. Initially these are documents/fixtures; loading real metadata or changing schemas requires later database authorization.

**Gate:** Every enabled pilot rule and every candidate it can mark eligible has traceable reviewed evidence. Unverified items remain unavailable for compatibility claims. The rest of the catalog need not be cleaned first.

### M1 — Shared code foundations and read-only prototype

Implement the relevant part of Stage 1 packages 1–4 when implementation is requested: MaterialKey, metadata schemas, known/unknown physical quantities, role status, reviewed rule revisions, pure compatibility functions and a single recommendation result contract. Reuse capability child-catalog restrictions. Prepare additive identity/metadata migrations and a dry-run mapping report without executing them.

Build a disabled, fixture-driven version of the shared recommendations panel beside Standard Materials in `src/pages/Materials/MasterMaterialDetailsPage.tsx:237`. Define a pure backend preview reader; do not reuse cable hydration, Change Order refresh or backend startup as a way to obtain test data. Deterministic backend ordering is sufficient. Python/FastAPI, a similarity index and supervised training are not dependencies.

**Gate:** Pure/mock cases S01–S04, S08–S09 and S12–S13 pass. Washer/nut alternatives are grouped correctly; missing metadata is honest; preview creates no draft/assembly and issues no domain writes. Synthetic fixtures are labeled and cannot be mistaken for approved production materials.

### M2 — Read-only pilot with verified catalog data

After explicit database authorization for a named isolated target, validate the prepared additive migrations and approved metadata loading there, then verify the real preview query path. Keep production deployment a separate decision. Use authenticated recommendation reads with a documented catalog access policy, and expose only the pilot's verified records/rules. The server still decides applicability and eligibility; deterministic ranking remains available.

Do not display a project deficit without resolved project allocations. Catalog preview may show known per-parent/per-position requirements or an unknown total, and eligible alternatives, without a write button. This milestone deliberately excludes adding to projects, saving shared templates and learning from current assemblies.

**Gate:** The supported pilot works against verified data; read-only checks establish no data initialization; required roles with no eligible candidates stay visible; unknown states and unsupported categories remain distinguishable. This gate needs no classifier, full legacy cleanup or Change Order redesign if its paths are not involved.

### M3 — Explicit project additions and top-ups

Complete the relevant Stage 1 packages 5–7 for the first selected target adapter. Resolve current identity and original lineage separately for that target. Add explicit role/position allocations and immutable revision snapshots. Preserve manual and inherited overrides; reject automatic conclusions when unresolved existing rows could affect satisfaction.

Implement current-state compatibility/whole-assembly and quantity revalidation, an explicit existing/new allocation writeTarget, optimistic revision checks, transactional idempotency receipts and graph serialization. Apply the stricter existing target permission: project cable-type defaults currently require admin; cable instances have authenticated mutation paths. Every legacy mutation that can change the protected target, including sync/import/type changes, must invalidate or participate in its revision protocol before acceptance is enabled.

For cable integration, the page's entire loading flow must be pure: adding a new pure suggestions endpoint while the same page still calls the legacy mutating details GET does not meet a read-only promise. For Change Order integration, fix the historical-refresh dependency before including that path or promising frozen historical commercial results. A catalog preview need not wait for that repair. Do not use this sequencing to dismiss the existing Change Order issue.

**Gate:** S05–S11 and S14 pass for supported targets, including a later authorized isolated DB race/rollback check. The synthetic `2 × 4 − 6 = 2 pcs` top-up is explicit; no packaging multiplier, duplicate add, silent overwrite or parent reset. Frozen revision reads preserve supported report quantities. Untested/unsupported target adapters remain disabled.

### M4 — Explicit review and reusable templates

Implement Stage 1 package 8 and required foundation APIs: exact immutable reviewed snapshots, covered scope, reviewer permission, append-only corrections/withdrawals and lineage roots. Adding a component is not a review. Saving an assembly as a template does not approve it.

Template saving needs quantity-basis conversion, an explicit new revision, and preserved project instances. Publishing project components/context into a broader shared scope requires the source-to-destination publish grant in design §6.1. Otherwise retain an authorized restricted scope or deny publication. Template copies do not constitute independent training examples.

**Gate:** S11, S15–S16 and the evidence/scope parts of S21 pass. Withdrawal removes an example from live evidence without erasing history. Existing project instances retain their pinned snapshots. This milestone can be developed in parallel with M3 once identity/revision foundations exist, but is enabled only after its own gates pass.

### M5 — Immediate similarity recommendations

Deploy the optional pinned CPU ranker only after reviewing actual networking/topology. Provide scoped reviewed examples through WFC-controlled exports/deltas, one feature-normalization contract and immediate index updates. Ranking only reorders the authorized eligible candidate set. Positive reviewed examples can support similarity; negative labels are not required for this baseline.

**Gate:** New reviews influence the live similarity index without retraining; copies have bounded lineage contribution; withdrawals and revoked scope invalidate live evidence; outage/malformed replies produce deterministic WFC fallback. Verify relevant S15–S18/S21–S22 with offline provisioning and egress disabled. WFC startup must remain independent of the ranker.

### M6 — Optional supervised model and automatic promotion

Only after independent, appropriately labeled judgments exist, prepare periodic CPU training with grouped/temporal holdout. Compare candidate, valid incumbent and similarity on identical clean judged cases; exclude held-out lineages from similarity statistics too. Freeze pilot-derived coverage, quality, uncertainty, per-role regression and resource gates before evaluation. Missing settings or inadequate labels skip training/promotion.

**Gate:** S17 and S19–S22 pass; activation is atomic, and withdrawn/revoked training or evaluation dependencies cannot return through rollback/restore. This milestone may remain deferred indefinitely while deterministic/similarity suggestions provide useful behavior.

## Parallel work and deferrals

Three independent streams can advance: pure code/UI with synthetic fixtures; domain preparation for the two initial scenarios; and legacy identity/read/history characterization with migration/test artifacts. They converge at the release gates above. No production-data modification is necessary to start those streams.

Defer complete catalog enrichment, resolution of unrelated historical projects, all later category adapters, broad report modernization, GPU/LLM work and supervised training. Do not defer missing compatibility evidence for an enabled candidate, uncertain quantity needed for a top-up, read side effects on the actual preview path, or write authorization/concurrency protection for an enabled target.

## Immediate next work item

Request a bounded Stage 1 foundation slice: shared identity/metadata/role/unknown-state types, pure compatibility/quantity functions, synthetic tests for both initial adapters, pure preview contract and migration artifacts. Develop the read-only panel behind a disabled feature flag alongside these foundations. Keep real data activation and all database execution pending explicit authorization. Report that slice's completion separately from full Stage 1 and from deployment/data readiness.

No application tests need to be rerun merely to author this plan. Prior baseline remains 94 tests plus typecheck/lint/build passed, with the precise scope recorded in Stage 0 verification. This follow-up does not add runtime evidence.
