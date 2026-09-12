# Stage 0 verification: offline material recommendations

Audit date: 2026-09-12. This is a documentation-only audit. Source inspection, executed checks and future acceptance tests are separate evidence classes. No application/server startup, database access, migrations, training or dependency installation is authorized in this run.

## Checkpoint ledger

| Checkpoint | Status | Evidence | Finding | Next action |
|---|---|---|---|---|
| A — repository and baseline | PASS | `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse HEAD`, `git status --short`; `README.md:1`, identity; `package.json:6`, scripts; `vite.config.ts:18`, tests | WFC, branch `AI-suggestion-implementation`, revision `96bcb58827c15ea738933f3adc3fcead837aff11`; initially clean worktree. No applicable AGENTS.md found in ancestors or repository (hidden paths included; dependencies/build artifacts excluded). Existing node_modules available; manifests/lock/test setup inspected. Local checkout only: remote probe failed. | Recheck checkout/deployment before Stage 1; retain explicit remote/runtime limits. |
| B — ownership and current flows | PASS | Source inspection E01–E11 below; design §§2–3. | Seven composition owners verified; legacy identity/GET/history gaps bounded. | Stage 1 current/origin identity, pure reads and revision foundations. |
| C — domain scenarios | PASS | Design-only S01–S13 walkthrough; design §§4–5. | Roles, positions, multiplicity, units and unknown states are explicit; no real engineering limit claimed. | Implement synthetic adapter/allocation tests; obtain real domain evidence before enabling rules. |
| D — integration contracts | PASS | Design §6 operation matrix, JSON examples and independent adversarial review. | Pure preview, explicit writeTarget, idempotency, scoped permission and version boundaries defined. | Implement contract tests and document deployment access policy. |
| E — reviewed evidence and learning | PASS | Design-only lifecycle/lineage/promotion/withdrawal audit, design §§7–8. | Immediate positive similarity separate from classifier readiness; contaminated training/evaluation dependencies disqualified. | Prepare independent pilot judgments and gate settings; no model readiness claimed. |
| F — checks and final audit | PASS | 94 tests, typecheck, lint and temporary build passed; full document reviews, JSON/scenario/citation checks and final no-index/working-tree diff inspection. | Initial Vitest environment failure resolved and recorded; S01–S22 remain design checks. Only three new documentation files; no tracked application/config/data changes. | Stop after Stage 0. Execute Stage 1 foundations only in a later requested run, with database prohibition preserved. |

## Repository scope and discovery log

- Root: `C:/Users/todor.chankov/source/WFC`. Remote identity: `https://github.com/MrToKa/WFC.git`.
- `git ls-remote origin refs/heads/AI-suggestion-implementation`: exit 128, connection to GitHub port 443 failed. Remote freshness **NOT VERIFIED**; no fetch/push or tracking-ref freshness claim.
- `node --version`: exit 0, `v24.19.0`; `npm --version`: exit 0, `11.17.0`.
- `docker compose ps --format json`: exit 1, Docker configuration access denied and command/flag unavailable. Running-container topology **NOT VERIFIED**. No Docker lifecycle operation was attempted.
- Repository file search found no `.github` directory and no `server/package.json`; the root package owns scripts. These are discovery findings, not application test failures.
- Observed checked-in Compose declares PostgreSQL and MinIO only. Configuration credential values are intentionally omitted from deliverables. No rendered Compose configuration or environment file is needed.

## Executed baseline commands and safety

All commands ran from the repository root. Root/branch/revision/status/remote-name discovery succeeded; last commit subject is `docs: add Stage 0 prompt to AI suggestion implementation branch`. Discovery used `rg --files`, targeted `rg -n` and UTF-8 `Get-Content` on manifests, test setup, routes, services, models, UI callers, tests and ADR. Missing `.github` caused search exit 2; missing `server/package.json` caused a file-read error. Neither is an application test failure. No environment file, rendered Compose configuration or database data directory was needed.

| ID | Exact command | Exit / status | Outcome and limits |
|---|---|---|---|
| C01 | `git ls-remote origin refs/heads/AI-suggestion-implementation` | 128 / FAIL | GitHub connection failed; local-only scope. |
| C02 | `node --version` / `npm --version` | 0 / PASS each | Node v24.19.0, npm 11.17.0; existing dependencies used. |
| C03 | `docker compose ps --format json` | 1 / FAIL | Configuration access denied, unknown flag; no container changes. |
| C04 | `docker compose ps --all --format '{{.Service}} {{.Name}} {{.Image}} {{.State}} {{.Health}} {{.Publishers}}'` | 1 / FAIL | Parallel read-only audit also failed: config access denied and unknown flag --all. Actual topology unverified. |
| C05 | `npm run typecheck` | 0 / PASS | Both client/server `tsc --noEmit` commands completed. |
| C06 | `npm run lint` | 0 / PASS | ESLint with max-warnings=0; no --fix. |
| C07 | `npm run test -- --run server/services/standardMaterialService.test.ts server/services/projectCableTypeSnapshotService.test.ts server/services/materialCapabilities.test.ts server/validators.standardMaterial.test.ts src/pages/Materials/materialCapabilities.test.ts src/pages/Materials/MasterMaterialDetailsPage.test.tsx` | 1 / FAIL | Failed before tests: esbuild ancestor-directory access/config-loading denied in sandbox. Not a failed assertion. |
| C08 | `npm run test -- --run server/services/standardMaterialService.test.ts server/services/projectCableTypeSnapshotService.test.ts server/services/materialCapabilities.test.ts server/validators.standardMaterial.test.ts server/routes/standardMaterialRoutes.test.ts server/utils/transaction.test.ts src/pages/Materials/materialCapabilities.test.ts src/pages/Materials/MasterMaterialDetailsPage.test.tsx src/pages/Materials/components/MaterialDetailsComponents.test.tsx` | 0 / PASS | Retried outside sandbox after approved execution and import/mock safety audit; 9 files, 81 tests, Vitest 3.2.4, 47.19 s. Three additional inspected boundary suites included. |
| C09 | `npm run test -- --run server/services/changeOrderService.documentType.test.ts` | 0 / PASS | 1 file, 13 tests, 0.896 s, mocked DB. Added after discovery of historical-read gaps. |
| C10 | `$stage00BuildOutput = Join-Path $env:TEMP ('wfc-stage00-build-' + [guid]::NewGuid().ToString('N')); Write-Output ('Temporary build output: ' + $stage00BuildOutput); npm run build -- --outDir $stage00BuildOutput` | 0 / PASS | Vite 7.3.3, 2,207 modules, 14.96 s. New temporary bundle, tracked dist unchanged. Existing >500 kB chunk warning and outside-root output-not-emptied notice; no source repair. |

C10 actual directory: `C:/Users/TODOR~1.CHA/AppData/Local/Temp/wfc-stage00-build-60cb5a0be60f434d990dbc5f252f9ba1`. No existing output was deleted. `package.json:10`, build script, and `vite.config.ts:5`, React plugin configuration, contain no database/code-generation startup hook. `server:start`, `server:dev`, Docker lifecycle commands, migrations and dependency installs were not run.

Lockfile inspection: format 3 (`package-lock.json:4`), ESLint 9.37.0 (`package-lock.json:6143`), Express 4.22.2 (`package-lock.json:6528`), pg 8.16.3 (`package-lock.json:9086`), React 19.2.0 (`package-lock.json:9496`), TypeScript 5.9.3 (`package-lock.json:11031`), Vite 7.3.3 (`package-lock.json:11217`) and Vitest 3.2.4 (`package-lock.json:11830`), package entries. A PowerShell JSON extraction failed on the lockfile's empty property name and a Node inline extraction failed from Windows argument quoting; targeted `rg -n -A 1` inspection then established these values. No dependencies/lockfile were changed. These were discovery-tool failures, not application checks.

Test safety: `vite.config.ts:18` uses jsdom; `src/test/setup.ts:1` only imports jest-dom and registers cleanup. Pure service/validator/capability imports have no DB import. Snapshot tests inject `vi.fn` query objects. Standard-route/transaction/Change Order document-type tests hoist mocked `../db.js`. UI suites mock exercised detail/catalog requests or use callback props. Mock SQL assertions do not execute SQL.

| Executed suite | Tests | Established coverage |
|---|---:|---|
| `server/services/standardMaterialService.test.ts` | 6 | Nested expansion, child units/multiplication, existing cycles/aggregation; not allocation or graph race safety. |
| `server/services/projectCableTypeSnapshotService.test.ts` | 2 | Snapshot insert arguments/provenance and inherited-only replacement SQL; not live persistence. |
| `server/services/materialCapabilities.test.ts` | 7 | Backend capability registry. |
| `server/validators.standardMaterial.test.ts` | 41 | Existing quantity/unit/purchasing schemas, not engineering compatibility. |
| `server/routes/standardMaterialRoutes.test.ts` | 3 | Mock connection-failure handling; direct last-handler invocation does not test auth middleware. |
| `server/utils/transaction.test.ts` | 2 | Mock wrapper behavior, not real isolation. |
| `src/pages/Materials/materialCapabilities.test.ts` | 9 | Client capability/navigation mapping. |
| `src/pages/Materials/MasterMaterialDetailsPage.test.tsx` | 4 | Child catalog selection/owner exclusion. |
| `src/pages/Materials/components/MaterialDetailsComponents.test.tsx` | 7 | Existing controls/admin rendering, filtering and quantity validation. |
| `server/services/changeOrderService.documentType.test.ts` | 13 | Mock document-type ownership, service mutations/clone/reorder. |
| **Total** | **94** | **10 files passed; targeted baseline, not the whole repository suite.** |

`server/services/changeOrderCatalogService.test.ts:38`/`:45` define fixed/rate quantity tests and `:119` tests live ordering refresh. That file was source-inspected only: its unmocked `changeOrderService` import reaches the real pool/config module. Full-suite/DB-backed checks were intentionally not executed. No application assertion/type/lint failure was found in the executed subset; environment failures remain recorded above.

## Current-code findings and evidence index

All E references are source inspection, not runtime proof of real data.

| ID | Source + symbol | Finding / impact |
|---|---|---|
| E01 | `server/services/materialCapabilities.ts:19`, MATERIAL_CAPABILITIES; `src/routes/router.tsx:75`, catalog routes; `server/routes/materialsRoutes.ts:2092`, load-curve capability | Seven owners and existing child catalogs; load curves have no composition. Bolt/nut/washer/marker typed subtypes absent. |
| E02 | `src/pages/Materials/MasterMaterialDetailsPage.tsx:78`, loadDetails; `src/api/materials.ts:71`, fetchMaterialDetails; `src/pages/Materials/components/StandardMaterialDialog.tsx:116`, submit | Shared catalog UI and stable child UUID edits exist. Purpose filter is not a role. |
| E03 | `server/services/standardMaterialService.ts:195`, expandFromGraph; `server/services/standardMaterialService.ts:160`, aggregateExpandedStandardMaterials | Path-local cycle detection, legitimate multiplicative occurrences. Aggregation by category/id/unit/normalized remarks flattens provenance, not an allocation ledger. |
| E04 | `server/routes/standardMaterialRoutes.ts:49`, registrar; `server/validators.ts:404`, standard schema; `server/db.ts:1262`, assignment DDL | Admin writes, positive finite quantities, FK/unique/self constraints; no engineering role/compatibility/basis rules. |
| E05 | `server/services/standardMaterialService.ts:325`, graph load; `server/services/standardMaterialService.ts:388`, update; `server/utils/transaction.ts:4`, withTransaction | No graph serialization, revision or idempotency. Concurrent graph checks and read/merge writes can race. |
| E06 | `server/services/projectCableTypeSnapshotService.ts:5`, snapshot; `server/routes/cableTypesRoutes.ts:679`, source replacement; `server/routes/cableTypesRoutes.ts:1263`, default PATCH | Inherited-only replacement preserves manual defaults. Rename can diverge current selection from original provenance; stable current identity must be separate. |
| E07 | `server/routes/cablesRoutes.ts:2720`, details GET; `server/routes/cablesRoutes.ts:1413`, initializer; `server/routes/cablesRoutes.ts:1601`, sync; `server/routes/cablesRoutes.ts:2603`, type change | GET may delete/insert material rows; sync can overwrite an edited default-linked row; type change resets all. New preview/acceptance must avoid implicit initialization/reset. |
| E08 | `server/routes/cablesRoutes.ts:1903`, buildCableReportSummary; `server/routes/cablesRoutes.ts:1819`, rate conversion; `server/routes/cablesRoutes.ts:1831`, accumulator | Virtual defaults support pure projection; pcs/m × design length once. Name/unit report aggregation cannot establish stable allocation identity. |
| E09 | `server/services/changeOrderService.ts:63`, inherited quantities; `server/services/changeOrderService.ts:105`, minimum order; `server/services/changeOrderService.ts:305`, getChangeOrder; `server/services/changeOrderService.ts:157`, ordering sync | Fixed cable companions per cable line, rates by length, packs separate. Composition copied at add, but GET/export refreshes commercial values from live catalog. Full history immutability is a gap. |
| E10 | `server/app.ts:36`, mounts; `server/middleware.ts:28`, requireAdmin; `server/services/projectService.ts:5`, existence check; `server/routes/cablesRoutes.ts:831`, project cable lookup | Public catalog reads/admin writes/authenticated cable writes and object-to-project check; no established user membership/reviewer scope or approval metadata. |
| E11 | `server/index.ts:13`, startup; `server/db.ts:13`, initializer; `docker-compose.yml:4` and `docker-compose.yml:17`, services; `server/models/cableVersion.ts:6`, history | Startup writes DB/storage. Compose only PostgreSQL/MinIO, no API/ranker health topology. Cable versions lack complete component snapshots. |

## Scenario matrix S01–S22

**Each row is PASS for design consistency and NOT RUN for the proposed feature's runtime.** Existing tests provide only the partial baseline described above. Inputs are synthetic/conditional, not real catalog facts. Mutation describes future explicit authorized operations; no scenario wrote data during Stage 0.

| ID | Input facts | Expected output/state | Mutation and owner | Current evidence | Future regression boundary |
|---|---|---|---|---|---|
| S01 | Bolt, verified typed metadata, enabled washer/nut relations | Separate role groups; no automatic assembly/draft; total quantity unknown without basis | No write; applicability service/shared panel | E01–E02 | API/UI no INSERT/UPDATE/DELETE or initializer; groups retained |
| S02 | Three eligible nuts in one slot | Alternatives; selecting one does not add the others | Preview no write; explicit one-candidate acceptance | E02 | Selection/target contract, exactly one accepted identity |
| S03 | Required thread/application field unknown | insufficient-data with missing fields; no name/diameter-only compatibility | No automatic write; adapter rejects acceptance | E01/E04 | Null/missing/ambiguous metadata; 422 acceptance; ranker cannot override |
| S04 | Reviewed rule says optional/not-applicable/undetermined | Distinct from required missing; frequency never enables mandatory role | No automatic write; reviewed applicability rule | E02/E04 | Four-state tests; existing nonapplicable allocation flagged, not deleted |
| S05 | Synthetic 2 washers/parent × 4 parents; 6 eligible pcs allocated here | R=8/E=6/deficit=2/overage=0; explicit selected 6→8 or new 2; no pack multiplier | Read preview; explicit revisioned top-up | E03/E08/E09 | Arithmetic/API/report no double multiplication; template normalization back to 2 per parent |
| S06 | Same identity allocated to B, request for A | B does not satisfy A; no double use of physical quantity | No write; explicit adjustment only | E03/E07 | Allocation conservation/position tests |
| S07 | R unknown, or known R=8/E=10 | Unknown remains null; overage 2 visible; no negative add/deletion | No automatic write; quantity service | E04/E08 | Unknown vs zero, incomplete E, overage, rounding-policy cases |
| S08 | Diamond graph repeats child; separately a real cycle/self-link | Valid occurrences count with multiplicity; one allocation once; real cycles rejected | Read expansion; graph mutations serialized | E03/E05 | Diamond/path identity, duplicate allocation, self/cross-cycle, traversal limits |
| S09 | Pairwise eligibility but full stack invalid or required data absent | Whole-assembly ineligible/insufficient-data; no acceptance | Backend whole-assembly validator | E04 | Stack/context fixtures before rank and inside write transaction |
| S10 | Manual/inherited rows fully satisfy slot | No duplicate add; preserve origin/override; unresolved identity stays uncertain | Pure projection; selected explicit adjustment only | E06–E08 | Rename/default/manual/source-change/override fixtures, no implicit sync |
| S11 | Template revision changes after instantiation | New revision affects future explicit instances; old snapshots/report values unchanged | Explicit shared template write, no fan-out | E06/E09/E11; current CO refresh is a gap | Snapshot before/after, pure historical GET/export, explicit new revision refresh |
| S12 | Cable/type stable source plus verified marker fit/count/context | Shared protocol with marker adapter and end/length basis, correct child catalog | Pure projection; selected target write only | E01/E06–E08 | Source ambiguity, fixed/rate counts, consumption unit, no second engine |
| S13 | Unsupported subtype or known required role with zero candidates | unsupported vs no-eligible-candidate distinct; role still visible; manual workflow | No write; capability/retrieval/UI | E01/E04 | Empty/truncated/paged search; shortlist cannot hide role |
| S14 | Repeated key, concurrent adds, or catalog edit after preview | Exact retry replays once; changed payload/stale state conflicts; no duplicate/overwrite | Transaction receipt, head/graph/generation locks | E05/E07/E10 | Mock contract now; real concurrency/FK/rollback on later authorized isolated DB |
| S15 | Review rev1, edit rev2, withdraw review | Immutable rev1 history; rev2 unreviewed; tombstone removes active evidence/dependents | Explicit review/event writes | E06/E11; feature absent | Snapshot/event permissions, evidence lag fallback, dependency invalidation |
| S16 | 100 copies of one template lineage | One independent contribution per lineage/context/role; grouped splits | Lineage captured on explicit copy/review | E09; clone has no review lineage today | No inflated counts or train/test split across connected copies |
| S17 | Few positive reviews, no negative judgments | Similarity can work/update; classifier skips insufficient-labels; ignored stays unlabeled | Review evidence update; no forced training | Proposed design §7 | Positive-only fixtures, immediate index delta, readiness/skip statuses |
| S18 | Ranker absent/unhealthy/malformed/wrong scope | WFC starts/works with deterministic scoped eligible order or honest none | Read fallback/circuit; no preview DB write | E11; ranker absent today | Boot, timeout/size/schema/permutation/version/scope rejection |
| S19 | Aggregate gain but supported-role gate fails | No promotion; retain valid incumbent/baseline mapping | Trainer gate/activation owner | Proposed design §7.2 | Per-role coverage/regression, ties/uncertainty/missing-config refusal |
| S20 | Training fails/data insufficient/activation interrupted | Attempted/evaluated/active versions distinct; valid prior release remains; no partial activation | Worker lease/staging/atomic registry | Proposed design §§7–8 | Crash/lease/retry/catch-up, CAS activation, no stale rollback |
| S21 | Revoked scope or withdrawn erroneous training/evaluation evidence | Remove caches/index access; disqualify dependent models, including rollback/restore | WFC permission/tombstone journal + manifests | E10; policy unresolved | Cross-scope denial, generation/tombstone restore, contaminated incumbent rejection |
| S22 | Provisioned artifacts, no external egress | Local CPU serving/training, no downloads; missing ranker leaves WFC usable | Local optional services/storage | E11; proposed design §8 | Later no-egress deployment/restart/restore and measured CPU/RAM/latency |

## Adversarial design review and traceability

Independent audits covered composition, UI/inheritance/report flows and auth/test safety; a separate agent reviewed the completed design. Corrections were documentation only.

| Risk / requirement | Design resolution | Evidence / tests |
|---|---|---|
| Required role hidden or partial role suppressed | Applicability/quantity before shortlist; retain no-candidate/incomplete states | §§4/6; S01–S07/S13; registry/validator baseline passed |
| Acceptance changes arbitrary row | Explicit existing/new writeTarget with expected old amount; stale preconditions conflict | §6.2; S05/S14; future contract/race tests |
| Identity/allocation ambiguity | Selected one-of-seven FK bridge; current identity separate from origin; occurrence path and allocation conservation | §4.1; E03/E06; S06/S08/S10 |
| Physical vs purchasing quantities; instance-to-template inflation | consumptionUnit separate from order/pack; normalize template basis exactly once | §§3–5; S05/S07/S11/S12; future report fixtures |
| GET writes/history refresh | Dedicated pure cable projection/historical reads; current gaps explicitly bounded | §3/§9; E07/E09/E11; S01/S10/S11 |
| Concurrency/authorization leaks | All protected legacy writes share revision/graph locks; backend-derived scope, stricter adapter permission, idempotency receipts | §6.1; E05/E10; S14/S21; mock tests do not establish SQL races |
| Incomplete success contracts or project-to-shared disclosure | Explicit write/export/delta success schemas; source-to-destination publish grant required for broader shared templates, denied by default | §6.1; S11/S14/S15/S21; handoff scope-denial tests |
| Unreviewed feedback/duplicates inflate evidence | Reader feedback excluded until review; typed labels; connected lineages grouped | §7.1; S15–S17; future evidence tests |
| Evaluation leaks or unjudged alternatives become wrong | Clean common holdout excludes incumbent dependencies and similarity statistics; fully judged frozen candidate sets for ranking metric | §7.2; S16/S17/S19 |
| New positive review falsely stales valid model | Index evidenceGeneration separate from immutable model trainingDataVersion; per-role modes | §6.3/§7; S17–S20 |
| Ranker outage or bad rollback blocks WFC | Optional dependency, bounded deterministic fallback; disqualification covers training/evaluation, rollback and restore | §§6–8; S18–S22 |
| Stage 1 actionable and data honesty | Ordered files/dependencies/migration/acceptance/prompt; no real engineering values fabricated | `STAGE_01_HANDOFF.md`; design §§9–10 |

All rows above PASS as design checks; feature/runtime integration remains NOT RUN. Existing unit/mock successes do not certify proposed engineering rules, reviewer policy, immutable real snapshots or model quality.

## Unavailable prerequisites and follow-ups

| Check / input | Status and reason | Bounded follow-up |
|---|---|---|
| Remote freshness | NOT RUN successfully; network failure | Repeat C01 when connectivity is available and compare returned hash. |
| Running topology | NOT RUN successfully; Docker config/tooling inaccessible | On deployment host run working `docker compose ps`; inspect only service/health/ports/volumes and host-vs-container API route. |
| Real catalog/labels | NOT RUN; no DB access in scope | Obtain explicitly authorized read-only export of keys, source evidence and lineage counts; populate design §10. Never use lazy GET as a read-only shortcut. |
| Domain/scope/reviewer decisions | NOT RUN; not inferable from code | Domain owner provides manufacturer/application limits, quantity/rounding/position rules; deployment owner records project access/reviewer grants. Keep enabled rules/export blocked while absent. |
| Full suite and pool-import quantity tests | NOT RUN; targeted audited subset only | Inspect each further import/setup; Stage 1 extracts pure/mock boundaries, then executes fixed/rate/report tests without backend startup. |
| Actual migrations/FKs/races/persisted history | NOT RUN; requires separately authorized disposable DB | Prepare scripts/fixtures first; after target-specific permission prove isolation, then test constraints/concurrent graph/top-up/rollback and before/after reports. |
| S01–S22 feature runtime | NOT RUN; feature not implemented | Stage 1 runs pure/mock foundations; later API/UI/serving stages execute integration cases. |
| Offline serving/training/gate power/performance | NOT RUN; service/data/settings absent | Provision pinned CPU image, independent verified pilot and frozen gates; execute no-egress/failover/withdrawal/restore and measured performance checks later. |

Model training, production data review, feature deployment, GPU setup, Codex scheduled automation, dependency installation and application-code repairs are NOT APPLICABLE to Stage 0. Their absence is intentional.

## Final verdicts

**Stage 0: COMPLETE.** Repository-backed audit, design, A–F checkpoints, all 22 design scenarios and actionable handoff are complete. The documents were read/reviewed and the final differences inspected. No feature implementation was started.

**Implementation readiness: CONDITIONAL.** Stable identity/metadata/rule/allocation/review foundations can be implemented with synthetic fixtures and disabled production rules. Enabling real recommendations requires verified fastener/marker data and application quantity/position/rounding rules, explicit project/reviewer/publish-scope policy, and resolution of the cable/Change Order read-side-effect and legacy mutation/history gaps. Real migration/concurrency verification needs later explicit authorization for an isolated target. Remote/deployment topology must be rechecked before integration. ML auto-promotion additionally awaits independent judgments and frozen pilot gate values.

**Real-data readiness: NOT VERIFIED.** No live catalog, reviewed examples or training dataset was inspected. Schema, fixtures and mock tests do not establish production data sufficiency. The real-value cells in design §10 remain blank.

Final checks:

- [x] WFC identity/revision, initial clean state, local-only and runtime inspection limits recorded.
- [x] Existing behavior supported by source references and caller/service/report traces; unknowns identified.
- [x] Seven physical category capabilities, load-curve exclusion and both initial adapter paths documented.
- [x] Applicability, approval/compatibility, quantity reconciliation and ranking separated.
- [x] Stable/current/origin identity, inheritance, cycles, occurrences, top-ups and historical snapshots addressed.
- [x] Pure browsing separated from target-authorized writes, shared publication and explicit review.
- [x] Three JSON examples parse; fields/units/unknowns and version/scope semantics reviewed. S01–S22 appear exactly once in the scenario matrix.
- [x] Review/correction/withdrawal, template lineage, positive-only similarity and qualified supervised training defined.
- [x] Clean grouped evaluation, promotion/refusal, artifact activation/disqualification/rollback, offline fallback specified.
- [x] Real-data limits, failed discovery/environment checks and unexecuted runtime/DB tests reported.
- [x] Stage 1 has ordered files/dependencies, preservation rules, acceptance criteria and a self-contained prompt.
- [x] Final `git diff --exit-code HEAD -- . ':(exclude)docs/material-recommendations/**'` returned 0; HEAD unchanged. `git ls-files --others --exclude-standard` lists exactly the three deliverables. Initial tree was clean; no user changes overwritten.
- [x] Each new file was inspected as an addition using `git diff --no-index --stat -- NUL <file>` and `git diff --no-index --check -- NUL <file>`; no whitespace-error diagnostics. No-index exit 1 denotes additions; Git's LF-to-CRLF notice is recorded, not a test failure. Source citation paths/line bounds and relative document links were checked without missing targets.
- [x] Application code, manifests/lockfile, Docker config, existing tests, ADR and tracked dist are unchanged. No database connection/write, server initialization, migration, model training, push/PR or deployment occurred.
- [x] Planned tests/proposed functionality are not described as implemented or runtime-verified.

Next concrete step: request Stage 1 foundation implementation using the handoff, retaining the no-database-change boundary. Engineering-data preparation and policy decisions can proceed independently; do not automatically start Stage 1 from this audit.
