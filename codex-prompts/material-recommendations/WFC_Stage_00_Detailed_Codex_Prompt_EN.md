# WFC — Stage 0: Evidence-Based Design for Offline Material Recommendations

## Use in Codex for VS Code

Open the WFC repository in VS Code, attach this Markdown file to the Codex conversation, and ask Codex to execute Stage 0 as specified here. Alternatively, paste this file's contents into Codex. This prompt is self-contained; the earlier conversation is not required.

**Stage boundary:** inspect the current application, verify the relevant existing code and domain behavior, and write an implementation-ready design. Do not implement the feature or start Stage 1 in this run. The deliverable is a verified design and handoff, not a working recommendation model.

---

## 1. Objective and required outcome

Perform Stage 0 for WFC's **catalog-wide offline companion-material recommendations**.

Produce a design grounded in the actual repository that another Codex run can implement without guessing the data model, component ownership, quantity semantics, API boundaries, training labels, or completion criteria.

The design must support the entire material catalog through shared infrastructure and category-specific compatibility rules. Verify two initial scenarios:

1. Opening a bolt can show suitable washers and nuts as separate companion roles.
2. Opening a cable or cable-type material can show suitable cable markers.

Later categories may include ferrules, ties, glands, supports and other materials. Do not claim a category is supported until its required attributes, rules and integration points are identified.

At the end, deliver:

- Evidence of how the current application represents, edits, inherits and reports materials.
- A concrete design for the recommendation workflow and its data/service contracts.
- Intermediate checkpoint results with evidence and unresolved issues.
- A scenario-based verification matrix for the design and later implementation.
- An actionable Stage 1 handoff, with dependencies and acceptance criteria.
- Separate conclusions for **Stage 0 completion**, **implementation readiness**, and **real data readiness**.

## 2. Product decisions to preserve

### 2.1 User workflow

The user opens a material and sees **Recommended companion materials**, grouped by role. Washer and nut are different roles; three alternative nuts must not be presented as three required components.

Provide these distinct actions in the design, using the application's existing UI language:

- **Add to this assembly:** adds or adjusts a component in a specifically selected working/project assembly.
- **Save as standard assembly:** explicitly creates or versions a reusable standard composition.
- **This assembly is reviewed:** marks the current assembly revision and review scope as a verified example.
- Reject, adjust, or withdraw a previous review with an appropriate reason.

Catalog browsing may show read-only recommendations without creating a persistent draft or project assembly. Require a write target when adding or saving. Request additional application context only when it affects applicability or compatibility.

Changing a standard template must not silently change existing project instances, historical snapshots, Change Orders or reports. An add is not an automatic review, and a template save is not automatically an engineering approval.

### 2.2 Recommendation logic

Treat these as separate steps:

1. Determine applicable companion roles for the material and application context.
2. Determine whether each role is required, optional, not applicable or undetermined.
3. Calculate satisfied and missing quantities for each role/position where requirements are known.
4. Retrieve authorized, approved catalog candidates.
5. Apply category-specific compatibility and whole-assembly constraints.
6. Rank eligible alternatives using reviewed examples and, later, a small ML model.
7. Revalidate current state when the user accepts an addition or adjustment.

First-release role applicability comes from explicitly enabled, reviewed relations and application rules. Frequency alone does not make a role mandatory. A learned association must not create an unreviewed engineering rule.

Do not silently remove, replace, or increase quantities of existing components. Already satisfied roles should not produce duplicate additions; partially satisfied roles should offer an explicit top-up. Unknown required quantity is not zero.

### 2.3 Reviewed examples and learning

Users prepare and review example assemblies. Similarity/frequency recommendations should benefit from newly reviewed examples without waiting for retraining.

Later, a local periodic training process checks whether there are enough new, independent, appropriately labeled examples. It trains a candidate and compares it against the active model and the similarity/frequency baseline on separate verified cases.

Only a candidate that passes predefined improvement and regression gates may become active automatically. Tied, inconclusive, failed or underpowered results retain the current model or baseline.

Maintain review provenance and template lineage. Copies of one template are not independent training or evaluation examples. Ignored suggestions and absent catalog alternatives are not automatically negative labels. Distinguish a role not being needed from a specific candidate being unsuitable.

Positive-only reviewed sets may be sufficient for useful similarity recommendations while remaining insufficient for a supervised classifier. Do not manufacture negative labels to force an ML implementation.

### 2.4 Runtime constraints

- WFC currently runs in Docker; verify the actual topology.
- Target hardware: Dell Precision 7780, 32 GB RAM, NVIDIA RTX 2000 Ada Laptop with 8 GB VRAM.
- The initial recommendation and training design is CPU-only. No large language model or GPU is required.
- Preferred minimal addition: a small Python/FastAPI ranking service, with an optional separate scheduled trainer process/profile, reusing the same pinned image where appropriate.
- The WFC backend owns authorization, database access, catalog eligibility, compatibility, quantities and write transactions.
- The ranking service may reorder authorized candidates, not invent candidates or bypass rules.
- Runtime processing and training remain offline after images and dependencies have been provisioned.
- A missing or unhealthy ranker must not prevent WFC from starting or operating. A deterministic fallback remains available.
- This is an application feature, not a Codex scheduled automation.

## 3. Scope and execution rules

Read applicable repository instructions first. Inspect the repository open in VS Code; do not assume a particular absolute path or operating system.

Allowed changes in this stage are the documentation deliverables under `docs/material-recommendations/`. Preserve existing documents and reconcile them rather than overwriting unrelated content.

Do not modify application code, package manifests, lockfiles, Docker configuration, database schemas, real catalog data, or existing tests. Do not train a model, run migrations, push commits, create a PR or deploy. Do not discard, stash or overwrite pre-existing user changes.

You may run relevant existing, non-destructive checks when their dependencies and isolated test configuration are available. Inspect scripts and test setup before execution: a command called a test can still initialize or reset a database. Do not execute an unknown initialization or migration path against a live database. Do not install dependencies or start services solely to make a read-only audit appear complete; record unavailable prerequisites and the exact follow-up verification needed.

Avoid disclosing secrets in documentation or command output. Inspect configuration structure without printing credential values. Rendered Compose configuration can contain secrets; record only the service/topology facts needed here.

Use source citations in the form `repository/path:line` plus the relevant symbol name. Distinguish:

- **Observed:** established by code or command evidence.
- **Proposed:** part of the future feature design.
- **Unverified:** not established because data or runtime access is unavailable.

Do not claim to have verified real catalog or training data merely because its schema exists. Do not claim GitHub freshness from a stale local tracking reference; use an available read-only remote check or state that only the local checkout was reviewed.

Make routine design decisions and document their rationale. Continue independent work when a fact is missing. Ask only for information that is essential and cannot be established from the repository. Never invent engineering limits or user authorization.

## 4. Work sequence and intermediate checkpoints

Maintain `STAGE_00_VERIFICATION.md` throughout the run. Every checkpoint entry needs a status, evidence, finding and next action. Use `PASS`, `FAIL`, `NOT RUN` or `NOT APPLICABLE`; explain every status other than PASS.

A source inspection is not a runtime test. A planned acceptance test is not an executed test. Record these evidence types separately.

### Phase A — establish repository and baseline

1. Identify the repository root, current branch and revision, and record pre-existing changes.
2. Confirm whether this is WFC using the remote, README and application structure. Stop dependent work if it is demonstrably the wrong repository.
3. Inspect manifests, lockfiles, CI and repository instructions to discover actual lint, type-check, test and build commands. Do not assume their names.
4. Inspect Docker services, health checks, volumes, configuration and database ownership.
5. Identify test frameworks, test data setup and whether checks require a database or external services.
6. Record which non-destructive baseline checks can be executed and which are unavailable.

**Checkpoint A:** repository identity is established, the current state is recorded, actual verification commands are known, and no existing user changes were altered. Report local-only versus remote-verified scope explicitly.

### Phase B — trace current code and data ownership

Discover the actual entry points. These are hints from an earlier inspection, not guaranteed current paths:

- `src/pages/Materials/MasterMaterialDetailsPage.tsx`
- `src/pages/CableDetails.tsx`
- `server/services/standardMaterialService.ts`
- `server/services/projectCableTypeSnapshotService.ts`
- Material and cable models, routes, database initialization/migrations and report services.

Trace these flows from UI to backend validation, persistence and resulting display/report:

1. Open a material in each existing category-specific or shared detail page.
2. Add/edit a standard composition component.
3. Copy or inherit a standard composition into a project or cable instance.
4. Customize or synchronize inherited materials.
5. Generate quantities and relevant material reports or Change Orders.

For each flow, inspect both the caller and implementation. Establish:

- Stable identity versus name-based matching.
- Category and subtype representation, including where bolt/nut/washer items would actually belong.
- Parent/component relation ownership and supported recursion.
- Units, quantity basis, multipliers, packaging and rounding boundaries.
- Manual versus inherited records, customization flags and snapshots.
- Authorization and project/catalog scope enforcement.
- Cycle detection, concurrency controls and duplicate behavior.
- Any reads that perform initialization or write side effects.
- Relevant existing tests and their coverage gaps.

Create a capability matrix: current category/subtype, UI entry point, model/table, composition owner, identity quality, available attributes, missing attributes, rule adapter needed and source evidence.

**Checkpoint B:** the proposed feature reuses verified composition infrastructure and preserves its semantics. Identity, inheritance and quantity findings are supported by code references, not README claims alone. Unknowns have bounded follow-up actions.

### Phase C — verify domain rules using explicit scenarios

Design the smallest shared domain vocabulary that maps to current code. Cover material identity, subject/context, companion role, position/allocation, required and effective quantity, category rules, reviewed assembly and standard-template revision.

Document three distinct responsibilities:

- Role applicability and missing-component determination.
- Compatibility and quantity validation.
- Preference ranking among eligible candidates.

Work through the scenario matrix in Section 5. For each scenario, write the expected state transition, whether data may change, the rule/owner responsible and how implementation will be tested.

Use synthetic values only as arithmetic or control-flow examples, labeled clearly. A synthetic bolt fixture must not become a real approved material or a claimed engineering standard.

Verify that:

- Unknown metadata produces an explicit state, not a positive compatibility result.
- Existing quantity is reconciled by role and position, not by material name alone.
- Components allocated elsewhere do not satisfy the current position.
- Recursive expansion counts legitimate occurrences without double-counting the same allocation.
- Cycle detection does not falsely reject a component legitimately reused in separate branches.
- Pairwise-compatible parts still satisfy declared whole-assembly constraints.
- Standard-template updates preserve project history.

**Checkpoint C:** expected behavior is unambiguous for both bolt and cable scenarios, including deficits, alternatives, unknowns and inherited materials. Resolve contradictions in the design before moving on.

### Phase D — define integration, contracts and failure behavior

Specify proposed interfaces using the application's conventions. Clearly label new endpoints and types as proposed.

Document at least:

- Read-only catalog preview and assembly-context recommendation requests.
- Response fields for role applicability, satisfaction/deficit, candidate identity, reasons, unit, optional quantity, context revision and rules/model/index versions.
- Add/top-up, reject/adjust, review/withdraw and save-standard-template operations.
- Separate authorization for project assembly writes and shared catalog/template writes.
- Idempotency and optimistic concurrency behavior on user acceptance.
- Backend-to-ranker request/response and scoped reviewed-example access.
- A single versioned feature-normalization contract for scoring and training exports.
- Cache keys and invalidation events.
- Bounded request size/time, deterministic fallback and no-ranker startup behavior.
- Local artifact storage, scoped export, backup/restore and offline provisioning.

Keep the WFC outage fallback simple and deterministic. Do not create a second independent complex similarity implementation in the backend.

Provide illustrative request/response examples without real IDs, credentials or invented production facts. Check field consistency, units, optional/unknown semantics and authorization scope across all examples.

**Checkpoint D:** every proposed operation has an owner, input, output, validation boundary, authorization scope, mutation policy and failure response. Catalog preview has no unintended writes, and accepted suggestions are revalidated against current state.

### Phase E — design reviewed data and automatic learning

Specify the lifecycle of reviewed assemblies:

1. Draft/current assembly.
2. Explicit review with immutable feature/component snapshot and scope.
3. Relevant edits requiring a new review.
4. Review correction or withdrawal without erasing history.
5. Removal from live similarity evidence and handling of dependent trained models.

Define feedback semantics and lineage for manually prepared, inherited, copied and model-assisted assemblies. Do not combine repeated reviews/copies into independent evidence.

Specify a minimal CPU model option, such as logistic regression, only where valid labels exist. Distinguish this from a similarity/frequency baseline that can work with positive reviewed examples alone.

Design the periodic workflow:

1. Scoped immutable data export from WFC.
2. New-data and independent-evidence readiness checks.
3. Training without blocking request serving.
4. Grouped/temporal evaluation excluding copied template lineages and held-out examples from both model fitting and similarity statistics.
5. Comparison with incumbent and baseline on identical evaluated cases.
6. Versioned, predefined promotion gates.
7. Atomic activation only on qualified improvement.
8. Retention of the prior compatible model and rollback on failed activation.

Document insufficient-data skips, failed jobs, missed schedules, lock recovery, bounded retries, resource limits and separate attempted/evaluated/active data versions.

Promotion settings must eventually include independent sample/judgment coverage per role, a primary metric, meaningful improvement, uncertainty criteria, per-role regression limits and performance targets. In Stage 0, specify the configuration and how the pilot will establish its values; do not fabricate validated thresholds. Missing gate settings prevent automatic promotion.

Treat role coverage, candidate coverage, ranking and quantity correctness separately. Unjudged alternatives are not automatically wrong. Explain how withdrawn examples or revoked scope affect already trained models; excluding data from the next export alone does not remove its prior influence.

**Checkpoint E:** there is a coherent path from a reviewed example to immediate recommendations and then to a qualified model, plus a reverse path for corrections and withdrawal. Training-data readiness is honestly distinguished from software design readiness.

### Phase F — execute available baseline checks and audit the design

Run the smallest relevant existing checks identified in Phase A, provided their setup is available and non-destructive. Prioritize checks covering composition, identity, quantities, snapshots and affected material/cable flows. Run available static/type/lint checks appropriate to the repository. Inspect a build command for code generation or database side effects before running it.

For each command, record exact command, execution scope, exit status, concise result and relevance. Do not fabricate a success, conceal failures or repeat a failing command without a reason. Identify pre-existing failures without fixing application code in this stage. Record missing prerequisites as NOT RUN, with the precise follow-up.

Review the design adversarially:

- Could a shortlist hide the fact that a required role has no candidate?
- Could a partially filled role be suppressed incorrectly?
- Could quantities be multiplied by both the assembly and report layer?
- Could a template change rewrite a historical result?
- Could GET/preview initialize data?
- Could two simultaneous adds create duplicates or overwrite another edit?
- Could a candidate from another scope enter the result or trained model?
- Could duplicated templates inflate quality estimates?
- Could a ranker outage prevent WFC startup?
- Could a bad or withdrawn-data model be promoted or selected during rollback?

Correct design/documentation contradictions discovered during this review. Do not implement code repairs beyond Stage 0's documentation scope.

**Checkpoint F:** all relevant executable checks were run or explicitly accounted for, domain scenarios have coherent expected outcomes, and the design's claims match the repository evidence and actual test results.

## 5. Required scenario matrix

For each case, record the input facts, expected output/state, no-write or write behavior, current-code evidence if any, and the future regression-test boundary. These are design checks now; mark runtime tests as executed only if they genuinely ran against existing behavior.

| ID | Scenario | Required expected outcome |
|---|---|---|
| S01 | Open a bolt in the catalog with enough verified metadata | Read-only suggestions grouped into applicable washer/nut roles; no assembly created automatically. |
| S02 | Several compatible nuts exist | Alternatives within the nut role; selecting one does not add every alternative. |
| S03 | A required thread or application attribute is unknown | Insufficient-data state; no claimed compatibility based only on a similar name or diameter. |
| S04 | A role is optional or not applicable in this context | Clearly distinct from a required missing role; frequency does not change the engineering requirement. |
| S05 | Synthetic rule requires 2 washers per parent, parent count 4, 6 compatible washers allocated here | Required 8, effective 6, deficit 2; explicit top-up, with no packaging multiplier. |
| S06 | Same material exists but is allocated to a different position | It does not silently satisfy the current role/position. |
| S07 | Required quantity is unknown or existing quantity exceeds the requirement | Unknown remains unknown; overage is a finding, not silent subtraction/deletion. |
| S08 | Nested standard compositions contain shared material identities | Count valid occurrences correctly; preserve multiplicity and reject actual cycles/self-links. |
| S09 | Individually eligible components violate a declared whole-assembly constraint | Reject or require missing information; pairwise checks alone are insufficient. |
| S10 | Existing manual/inherited material already fully satisfies the role | No duplicate addition; preserve customization and source provenance. |
| S11 | A reusable standard template is revised | Existing project snapshots and historical reports remain unchanged. |
| S12 | Cable-to-marker scenario uses the same recommendation infrastructure | Category-specific attributes and rules, without a separate competing engine. |
| S13 | Unsupported category or a role with no eligible catalog candidate | Honest, distinguishable status; manual catalog workflow remains available. |
| S14 | Two acceptance requests or a catalog edit after suggestions were shown | Idempotency/current-revision validation; no duplicate add or silent stale overwrite. |
| S15 | Review, edit and then withdraw an example assembly | Immutable review history, invalid current review after edits, withdrawn evidence excluded from live learning inputs. |
| S16 | A hundred copies of one reviewed template exist | Lineage-aware counts/weights and grouped splits; not a hundred independent examples. |
| S17 | Few reviewed sets exist and no valid negative labels are available | Similarity/frequency recommendations work; supervised training may skip with a clear reason. |
| S18 | Ranking service missing, unhealthy, malformed or unauthorized | WFC remains usable and returns scoped deterministic fallback or an honest no-suggestion state. |
| S19 | Candidate model improves aggregate results but fails a supported role's gate | No promotion that hides the role regression; retain appropriate incumbent/baseline mappings. |
| S20 | Training fails, evidence is insufficient, or activation is interrupted | Active valid model remains usable; no partially written release becomes active. |
| S21 | Data scope is revoked or known erroneous training evidence is withdrawn | Affected indexes/models are handled explicitly; no unsafe rollback to the same disqualified dependency. |
| S22 | Offline operation after provisioning | No required external inference/download; training and serving can remain local. |

## 6. Required documentation deliverables

Create or update the following under `docs/material-recommendations/`, merging with existing relevant documents when appropriate:

### `STAGE_00_DESIGN.md`

Include:

1. Objective, scope and repository revision reviewed.
2. Observed architecture and material capability matrix with source references.
3. Current flows, verified invariants and existing-code gaps.
4. Proposed domain model, applicability/quantity/compatibility responsibilities and data contracts.
5. UI workflow, context selection and standard-template versus instance semantics.
6. Migration/backfill approach preserving existing data and reports.
7. Docker/service boundaries, fallback, offline operation and operational lifecycle.
8. Reviewed evidence, similarity baseline, scheduled training and promotion/withdrawal design.
9. Minimal real-data preparation table: attribute, category/role, unit, evidence source, missing/verified status and why it is required. Leave unavailable real values blank.
10. Decisions, rejected unnecessary complexity, assumptions and remaining factual inputs.

### `STAGE_00_VERIFICATION.md`

Include:

- Checkpoints A–F with status and evidence.
- Commands actually executed and their outcomes.
- The completed S01–S22 scenario matrix.
- Current-code findings with impact and source references.
- Design-only validation separated from runtime tests.
- Requirement-to-design-to-test traceability.
- Unavailable prerequisites and follow-up verification.
- Final completion/readiness verdicts with reasons.

### `STAGE_01_HANDOFF.md`

Include:

- The precise next-stage goal: stable identities, typed metadata, role/quantity rules and reviewed-assembly data foundations.
- Ordered, bounded work items with actual files/modules and dependencies.
- Preserve/reuse requirements for current composition, snapshots and reports.
- Expected migration/backfill behavior and failure handling.
- Tests to implement or extend, tied to the scenario IDs.
- Missing real metadata or domain decisions and which work depends on them.
- Stage 1 acceptance criteria and out-of-scope work.
- A concise self-contained prompt for the next implementation run, consistent with the verified Stage 0 design. Do not execute it now.

Write these deliverables in English. Give the final conversational report in Bulgarian.

## 7. Final completion gate

Before finishing, read the completed documents and inspect the final working-tree diff against the baseline from Phase A.

Verify all of the following:

- [ ] The repository identity/revision and inspection limits are recorded.
- [ ] Existing application behavior is backed by verified code references.
- [ ] Catalog-wide coverage and both initial scenarios have concrete integration paths.
- [ ] Role applicability, eligibility, quantities and ranking are distinct and consistently defined.
- [ ] Identity, inheritance, cycles, multiplicities, top-ups and historical snapshots are addressed.
- [ ] Read-only browsing is separated from authorized writes and template saving.
- [ ] API/data examples use consistent fields, units, unknown states and scope semantics.
- [ ] Reviewed data, correction/withdrawal and template lineage have defined lifecycle behavior.
- [ ] Immediate similarity recommendations do not depend on having enough data to train a classifier.
- [ ] Scheduled training, independent evaluation, promotion gates, fallback and rollback are specified.
- [ ] Insufficient real data and unexecuted checks are explicitly reported.
- [ ] Checkpoints A–F and scenarios S01–S22 are accounted for with evidence or bounded follow-ups.
- [ ] Stage 1 has an actionable handoff with acceptance criteria.
- [ ] Only intended documentation changed; application code, configuration and real data were preserved.
- [ ] No planned test or proposed functionality is described as already implemented or verified at runtime.

Use these final statuses:

- **Stage 0: COMPLETE / INCOMPLETE.** COMPLETE means the required audit and coherent design/handoff were actually produced. A list of vague ideas is not complete.
- **Implementation readiness: READY / CONDITIONAL / BLOCKED.** Identify the specific unresolved inputs and dependent work. Do not label unknown engineering data as a routine default.
- **Real-data readiness: VERIFIED FOR STATED SCOPE / INSUFFICIENT / NOT VERIFIED.** Code/schema inspection alone is NOT VERIFIED.

A pre-existing code-test failure or unavailable live database does not require inventing a fix or data. It must be accounted for in the readiness verdict and next-stage dependencies. Conversely, do not declare all checks passed simply because the design documents exist.

Final Bulgarian response: lead with these verdicts, link the three deliverables, summarize the most important findings and verification, and state the next concrete step. Stop after Stage 0; do not automatically start implementation.

---

## Authoring references

- [Official Codex prompting guidance](https://learn.chatgpt.com/docs/prompting): clear target behavior, relevant context, constraints and verification.
- [scikit-learn common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html): consistent preprocessing and avoiding train/test leakage.
- [Docker Compose startup and readiness](https://docs.docker.com/compose/how-tos/startup-order/): startup ordering and service readiness.

These references support the workflow; the current WFC repository remains the authority for existing implementation details.
