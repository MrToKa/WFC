# PF-R9 — immutable cable revision results, exact length components and human Review → Apply

Status: **READY — execute under the user's existing sequential local authority.**

Prepared with prepare-stage-handoff from accepted plan 32, R0 contracts, inspected
implementation and R8 technical delivery 21334df6cc57b2c0f141568a5733453e2cdaa1e9.
The user explicitly authorized immediate sequential local implementation. R8 is
technically verified at its bounded diagnostic scope; human engineering acceptance
remains separate. Execute this prompt after its metadata commit, without merging
or changing the original installation.

## 1. Goal and mandatory entry gate

Implement plan 32 PF-R9: an administrator can compare the exact prior/current
cable baseline with a new immutable calculation, inspect its unrounded length
components and reasons, review that exact proposal, then explicitly Apply routing
and designLength together. Preserve installLength, accepted history, current
authorization, dependency fencing and idempotency.

Entry evidence was reconciled on 19 October 2026 at 12:25 UTC:

| Entry evidence | Actual state |
| --- | --- |
| Final R8 technical commit, source inventory, local branch/HEAD/status | **PASS** 21334df6cc57b2c0f141568a5733453e2cdaa1e9 on pf-r8-background-automation-local-20261019, 139 delivered files. Runtime candidate10 source e248514ecead6477ec27274bfe95c87c92f00ee448dd08c4fc4adb8335779e76. Only retained .pf0-work/.pf2-work and this new prompt remain untracked. |
| Producer qualification and B controls | **PASS, diagnostic scope** root-issued qualification 586833d42dc845430242586c1076cf3e76f8ee42a84f92b2d6ab3201b4f5066f, three B proposals/two controlled shared points, no extra capture after binding confirmation. Current HTTP grant3 enabled/producer ready. No native or wholeplant/human acceptance. |
| Grant-specific backup / fresh restore / retirement | **PASS** backup288adb69-3e92-4e83-9437-85c28a10fd23, 122 tables/8 members/4 images; fresh5192 all122 before-fence equality, 2 auth groups/3 fencing groups, rotated JWT/epoch, seven blank producer variables. Normal oldJWT/hostkey401; scoped actualPG/router revocation14 controls PASS. Exact5192 fixture retired, 0 containers/volumes/networks and closed port; source5191 retained. Archive9 restore and later web10-only overlay are distinct scopes. |
| Report / preservation / security / checks | **PASS with explicit limits**, report44 and evidence/background-automation/technical-receipt.json. Final1→2 all122 table sets and201 PF_ROOT files exact; six business/Review/Apply tables exact. Final lint PASS. Original WFC externally advanced; acknowledged outside container lifecycle changes stay EXTERNAL_CHANGE, not unchanged PASS. UI draft reset unconfirmed, no submitted UI command. |
| Metadata / inherited R9 revision | This prompt is the next metadata delivery after technical21334df. Inspect its actual metadata commit/HEAD, then create the inherited R9 branch; do not guess a self-referential hash. |

The human explicitly acknowledged the five outside lifecycle changes in
call_589e4bd20e7247029cff396a23ba5604. Current private profile5 retains all18 exact
static identities/configurations and17 exact lifecycles; only the documented
original backend's autonomous restart loop is narrowly observed. Do not retry
historical refusals or waive future drift. Root owns admission/runtime operations.
Current source profile14 is r8-approved-runtime14.private.json in the retained
R8 private work directory; fresh hostbinding8 PID7884 was positively reconciled
after an UNKNOWN launch transport without relaunch. Preserve its exact ownership.

When these gates are satisfied, inspect live agents/status, then create a new
inherited local branch, recommended pf-r9-revision-review-local-20261019. Preserve
concurrent/uncommitted work; do not reset or restart completed PF-0–R8 stages.

## 2. Traceable baseline and relevant sources

Final local/remote read-only reconciliation: **19 October 2026, 12:25 UTC**.

- Worktree: C:/Users/todor.chankov/source/WFC-pathfinder-local.
- Branch: pf-r8-background-automation-local-20261019.
- Technical HEAD: 21334df6cc57b2c0f141568a5733453e2cdaa1e9.
- Working tree after that commit: only historical .pf0-work/, .pf2-work/ and this
  new handoff untracked; no outstanding implementation changes. Preserve scratch.
- Cached origin/main: 6a12d395aead8f644bd9649262168ca74f7a35fa;
  technical21334df is61ahead/1behind this reference, no upstream on isolated
  branch. Root's GitHub connector confirms live main6a12;
  main has0 check-runs. One unrelated open WFC PR1 headfc81f5e250625afec76ed38f877ad7b790447dbb,
  base07369ef5955bd993925f11c57c74b761fd5148e4; no PF-R PR, review or remote CI for
  this unpublished local delivery. No fetch/push/merge was performed.
- Original WFC: clean main6a12d395aead8f644bd9649262168ca74f7a35fa, cached0ahead/0behind;
  externally advanced from original R7 locale1ef, no root write or merge. Original
  source-copy guards remain pinned to e1ef and must continue refusing6a12.
- Old PathFinder: master35f4fb46f7762503576bdacd9668f34a1be2b0ed, cached0/0,
  original AddinRibbon.csproj/ClAddin.cs modifications and .vscode preserved.
- Canonical PathFinder: clean master45c24bf5f433f13e102600b36f20327c77961d0a,
  cached0/0; GitHub live master also45c24 and no open PRs. Local old master and
  canonical/live master remain distinct reference revisions, not conflicting facts.

No additional repository/handoff-ancestor AGENTS.md was found in this bounded
inspection. Follow the latest supplied global instructions and sources/ read-only
rule; recheck applicable instructions if the environment changes.

Read these targeted sources before implementation:

- docs/pathfinder/32-purpose-and-revision-plan.md, PF-R9/PF-R10 and preserved decisions.
- docs/pathfinder/r0/geometry-revision-contracts.md, proposal contract and section 9.
- docs/pathfinder/automation-progress.md; finalized 44-r8-background-automation.md
  and its exact evidence; handoffs/PF-R8-background-automation.md for inherited limits.
- server/pathfinder/dependencyBatch.ts, dependencies.ts, jobContracts.ts, jobs.ts,
  jobsSchema.ts, worker.ts, apply.ts, auth.ts, grantJobAuthority.ts,
  calculationAuthority.ts and relevant routing/binding/comparison repositories.
- pathfinder-engine/src/PathFinder.Core/Routing/CableDesignLength.cs;
  Core/Support/SavedRouteDesign.cs; Adapter/Contracts.cs and PathfinderAdapter.cs;
  tools/PathFinder.ModelRunner/Program.cs and SessionProtocol.cs.
- src/api/pathfinder.ts, ProjectDetails/PathFinderResults.tsx and its hook/bridge
  ownership checks. Use current source, not older prompts, for actual DTO shapes.

Current source already has v5 engineering dependencies, immutable proposals,
per-proposal human Review, current role/login checks and atomic Apply. It lacks
the admission baseline, exact component ledger and full paged revision-results
view required here. Existing successful historical checks do not validate R9.
Keep Planned, Implemented, Verified and Accepted separate in the report.

## 3. Isolation and preserved product behavior

Root is the sole actual runtime/Docker/SQL/HTTP/browser/engine/test executor.
Delegate independent source/UI/test-authoring work with nonoverlapping ownership;
one designated writer integrates shared existing files. All writers preserve
others' work and coordinate interface changes before crossing file boundaries.

- No writes/builds/restarts in original WFC, old/canonical PathFinder, synced
  sources/ or 5190; no push, PR, merge, deployment or real-data Apply.
- Use only the root-verified owned 5191 installation and exact new owned fixtures.
  Verify current owner/path/project/container IDs/images/ports/volumes before
  mutation. Historical owner 8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46 and Docker project
  wfc-pathfinder-local-0cba87606e9b identify the demonstration, not a substitute
  for the finalized R8 runtime profile. Preserve 5191 and its archives.
- All historical denied scratch children AND parents remain untouched; no retry,
  bypass, parent deletion or general Docker prune. Clean only proved new own
  unnecessary resources; retain evidence and the demonstration.
- English UI; Path Finder administrator-only with Routes/Path/Path lookup.
  Active model comes from Details; Instrumentation follows Control. Missing
  categories, bindings or project settings are not invented.
- S/E/P and connection gap come from Project Details; the approved gap default is
  1 m. Keep existing formula, guards, ties, geometry/lookup semantics and actual
  C# double-to-decimal behavior. Drawing-only Left/Right permissions/layout remain
  separate and must not affect engineering staleness or 3D cable offsets.
- Preserve protected bridge, yellow path, original route colors, filled Ghost,
  Clear/restore and exact points. No product NOP_VIEWER bypass.
- The 2140-cable copied project is not fully mapped. The 13-object diagnostic
  capture and three queries are not a complete plant network. Use actual retained
  controlled fixture bindings; R8 records TWO unique points, not three invented
  points. No native licence/oracle retry or synthetic-as-real acceptance.

## 4. Freeze the old/current baseline at calculation admission

Extend the bounded admission collection while its project/authority and sorted
cable locks are held. Current dependencyBatch SELECT omits tag/routing/design/
install values; collect them in bounded chunks rather than querying per proposal.

Freeze an immutable project/job/cable baseline containing:

1. Current cable tag, From/To, routing, designLength, installLength and
   cableWriteRevision at admission, with exact stored numeric representation.
2. Nullable last accepted PF Apply receipt, its proposal/result/dependency hashes,
   recorded old model identity and available raw geometry/design result.
3. Whether that receipt still corresponds to the current cable: exact after-write
   revision AND routing/design values. Later manual/import edits must be visible.

Keep bounded scalar/route-summary data plus immutable old-result references;
read large prior path/evidence only for selected detail. Do not materialize every
old path point during admission or the paged list query.

The latest successful or reviewed proposal is not the accepted baseline. Existing
legacy cable values without a linked accepted receipt have unknown old model/
geometry/components; retain current values and show unavailable history, not zero
or a geometry estimate derived from designLength. Preserve historical accepted
receipts independently from the current edited cable snapshot.

Persist the baseline before dispatch using additive enforced-immutable records
or equivalently protected job-item data. Every retry reuses the original baseline;
do not reselect a later receipt or append orphan metadata on proposal conflicts.
Blocked/failed items retain their baseline and diagnostic row without fake output.

Preserve the existing automatic scheduler rule: an all-blocked generation has no
job. Add a durable admission/generation record with nullable jobId and immutable
per-cable baselines/blocked diagnostics, so all-blocked scopes remain pageable.
Manual jobs also get an admission. Resolve the automatic generation inside the
already guarded admission transaction, and keep retry uniqueness/atomicity.
Do not make mutable job-item state immutable or relax only one A/B admission
validator. Accepted-current requires exact stored after-write revision AND
routing/design equality; retain accepted-historical separately. Select NUMERIC
baseline values with SQL ::text, never through JSON-to-JavaScript Number.

Keep presentation/audit baseline data out of geometryHash and engineering input
tokens; bind it through the immutable result envelope instead. Drawing-only state
remains excluded transitively from engineering dependencies.

## 5. Opt-in exact C# length-component ledger

Keep all eleven pure Routing/*.cs files byte-exact. The actual function is
CableDesignLength.Calculate; SavedRouteDesign is the existing retained-metrics
support seam. Do not implement the formula in JavaScript or rewrite expected data.

Add server-owned optional Runner boolean includeLengthLedger. Absent/false
preserves historical behavior and response fields; true applies only to calculate
and design. Add optional TOP-LEVEL lengthLedger to the strict model response;
keep the existing design object and session framing. Do not change global JSON
null/default serialization or emit lengthLedger:null on historical requests.

Use a new Adapter-side wrapper/observer so existing pure Core files remain intact.
It calls the existing full-route or SavedRouteDesign calculation exactly once
with the same captured settings, then records the components. The core result is
authoritative; the observer is not another design calculator. Verify its small
decomposition against the returned before-percentage value. Take percentage and
ceiling totals from the core; derive their increments from those returned totals.

The ledger's strict, bounded fixed-object contract contains:

- Schema/formula version and Details settings revision; actual raw binary64 L/F/T.
- Actual C# decimal conversion of L; SECONDARY flags, removed approach amounts,
  count 0/1/2 and replacement amount; original nullable S and exact E/P.
- Signed pre-clamp amount, clamp adjustment and post-clamp amount.
- Exact before-percentage, percentage increment, unrounded, ceiling increment and
  final design totals as canonical invariant decimal STRINGS.
- gapAccounting = already-in-raw-geometry. Show actual gap count/length from the
  existing sealed route. The design-only RetainedRoute DTO has no gap metrics:
  retain it unchanged and preserve the original route through worker merge.

Required operation order, all decimal operations after the consumed double casts:

    a = (decimal)L
    if FromSecondary: a -= (decimal)F
    if ToSecondary:   a -= (decimal)T
    reject if a < -0.000001m
    c = Math.Max(0m, a)
    b = c + secondaryEnds * S + E
    u = b * (1m + P / 100m)
    d = decimal.Ceiling(u)

The equality boundary at -0.000001m is permitted and clamped. SECONDARY replaces
the actual approach; E is added once; gaps are not added again. Only flagged
approaches are cast by the core: preserve unused approaches as raw measurements
and removed amount zero, avoiding new display-only decimal overflow failures.
Missing S with no SECONDARY stays null/count zero/replacement zero; do not invent
a Details value. Missing S when required retains settings_required/no ledger.
Here S is Secondary tray length/secondaryTrayLength, E is For end connection/
endConnectionLength, and P is Additional % for bending/additionalBendingPercent.
Ledger limits must be finite (an 8 KiB fixed-object ceiling is sufficient).

Freeze the observer/UI JSON agreement as schemaVersion
`wfc.pf.length-components.v1`, formulaVersion `pathfinder-45c24bf5`,
settingsRevision, raw:{lengthMeters,fromDistanceMeters,toDistanceMeters},
rawLengthDecimalMeters, from/to:{requiresSecondary,removedApproachMeters},
settings:{secondaryTrayLengthMeters:null|string,endConnectionLengthMeters,
additionalBendingPercent}, secondaryEnds, replacementMeters, beforeClampMeters,
clampAdjustmentMeters, afterClampMeters, beforePercentageMeters,
bendingIncrementMeters, unroundedMeters, ceilingIncrementMeters,
designLengthMeters and gapAccounting. Only raw fields are finite numbers,
secondaryEnds is an integer0..2 and flags are booleans; all component amounts are
canonical fixed decimal strings, with beforeClampMeters signed. No self-hash.

Keep duplicate/unknown/type validation, cancellation and existing failure status
vocabulary. A successful opted-in result with absent/inconsistent ledger refuses
publication/Apply; no silent fallback. No-path/settings/category/deadline/resource
failures legitimately have no ledger. Canonically normalize exact fixed decimal
settings for comparison (7.00 equals 7); never compare through JS Number.

Both engine response validators and the explicit API/UI projection must retain
the ledger. Historical responses without it remain readable as unavailable.
Design-only reuse creates a NEW ledger from the new S/E/P, retaining original
geometry/provenance, never copying old allowances.

The wrapper/Runner and compiled server projection change actual engine hashes.
Measure the new identity, keep observer generation fencing and session binary
checks, and allow old v5 results to stale normally. Do not waive engine identity
to force design-only reuse; no pinned native/source identity claim changes.

## 6. Seal revision results; extend human Review and atomic Apply

Define a shared strict immutable revision-result contract and hash scheme. Bind
the baseline hash, exact dependency hash, engine result/ledger hashes, old/new
model/result refs, actual full-route or verified design-only mode, diagnostics,
comparison decision-set refs and retained reason/event refs. Insert it atomically
with the proposal and bind its frozen bytes to the proposal/review hash chain.
Specify excluded self-hash/read-projection fields to avoid circular hashing.
No mutable currentness or read-time latest receipt belongs in the frozen payload.

Reasons must be supported by exact retained input/event/comparison differences.
Project-wide recalculation reasons do not prove a particular cable physically
moved. Preserve observed-versus-physical, ambiguity/split/merge/frame limitations.
Calculate geometric/design deltas from recorded unrounded inputs with an explicit
numeric contract; never infer old geometry from rounded design length or silently
reconstruct a historical component ledger in JS.

Review binds the exact proposal, dependency and revision-result hashes and records
the current human admin/login/time/manual-validation method. A previous review
cannot authorize new hashes, model revision or result. Grants/producers never
create human reviews or Apply; add explicit guards at any generalized principal
seam. Do not create fake logins or persist a bearer in provenance. Execution lease
expiry alone does not revoke completed proposal provenance: retain R8's separate
current grant/issuer/installation checks and current HUMAN Review authority.

Extend the current principalTransaction/collectDependencies flow, reconciling one
documented lock order across admission/Review/Apply AND dependency writers. Hold
current project/admin/login/cable/model selection/model/artifact/catalog/policy/
registry/preparation/comparison/binding/settings and applicable persistent grant
fences through commit; prove concurrent controls rather than assuming new rows
are already protected. Preserve server-owned cableWriteRevision, including
edit-then-restore/manual/import fences.

Apply retains its idempotency key, exact proposal/review IDs and expected cable
revision. Write routing+designLength, cable history and pathfinder.apply.v2 receipt
in one transaction; installLength is never written. Provenance includes baseline/
result/ledger/dependency hashes, engine/aggregate/index/comparison/endpoint refs,
actual Details, reasons, before/after, human review identity/time, actor and payload
hash. Native parity remains not-performed; review covers this proposal only.
An exact replay returns its original receipt after current access checks, without
a second write; changed payload under the same key conflicts. Preserve existing
8000-character/100-segment routing limits and canonical whole design lengths from
0 to 1,000,000 metres; refuse, never truncate.
Reject/recalculate appends history and never deletes accepted results.

## 7. Paged administrator comparison UI

Add Cable revision results, with explicit job/generation and stable keyset cursor,
server maximum 100 rows/page. Support all 2140 cables without the current 30-row
display slice or 1000-proposal state cap. Avoid per-row collectDependencies/N+1
reads; bound response bytes and retain currentness separately. New jobs must not
shift an existing page scope or duplicate/omit rows. Include blocked/failed items
with their actual reason and no invented new route/design result.

Show tag, From/To, old/new model, old/new route, old/new geometric/design length,
delta, reasons and currentness. A detail panel shows unrounded ledger values,
SECONDARY replacements, S/E/P, gap accounting, ceiling and provenance. Use explicit
unavailable/legacy/missing/ambiguous/stale states. Preserve protected exact path
display and reset local Review/Apply state when ownership or frozen/current
tokens change. Grouped Review is optional: if implemented it selects a bounded
explicit list of immutable hashes, never all current/future results; each Apply
keeps its own transaction and checks. Per-proposal Review/Apply is sufficient.

## 8. Verification, deliverables and completion boundary

Root runs only relevant coordinated isolated checks, with exact source/runtime
revisions and PASS/FAIL/BLOCKED/NOT_RUN receipts. Do not rerun PF-0 writers or
regenerate frozen expected fixtures merely for this handoff.

Required meaningful checks:

1. Historical no-flag Runner responses/fixtures unchanged; both transports accept
   opted-in calculate/design ledgers; wrong flag/types/operation/missing ledger
   refuse. Cover 0/1/2 SECONDARY ends, missing/zero S/E/P, decimal precision,
   double-to-decimal boundaries, clamp threshold, ceiling boundaries, already
   included gaps and unchanged original eleven files. Compare exact core totals,
   not a mirrored JS formula. Verify real identity changes/session fencing.
2. Admission baseline with no prior receipt, previous accepted Apply, intervening
   manual/import edit, edit-then-restore and retry/conflict. Old accepted records
   and historical proposals remain exact; no newer baseline is substituted.
3. Current role/login, grant revision/issuer/install, model selection/content,
   catalog/policy, comparison decisions, bindings, settings and cable changes
   between Review and Apply refuse writes. Exercise real concurrent transactions
   and lock ordering/deadlock behavior, with no blanket allowlists.
4. Exact idempotent replay/lost acknowledgement/double click and conflicting key;
   one atomic routing+design write/history/receipt, installLength unchanged;
   oversized routing/design refused intact. Actual Apply controls use only
   explicitly owned synthetic fixtures, never the copied business project.
5. Computer-use: current admin-only UI/deep links, paged >1000-item synthetic
   scope plus copied-project blocked visibility, actual unrounded explanations,
   disabled/stale/refused actions, exact path/Ghost/Clear and reload ownership.
   Verify separate drawing defaults/Left-Right/divider behavior stays unaffected
   for identical frozen engineering inputs. Real route changes may legitimately
   change tray membership; do not claim layout equality after changed inputs.
6. Exact before/after table/file/storage preservation with schema defaults and
   fixture mutations receipt-pinned; retain external lifecycle limitations.

Deliver source/tests, additive migration/contracts, UI, docs/pathfinder/
45-r9-revision-review.md and sanitized evidence under evidence/revision-review/;
keep secrets/business rows/private archives outside Git. Report exact changed
files, branch/commit, runtime/image/input revisions, actual checks, limitations
and required human mappings/engineering review. Root updates automation-progress.

R9 is technically complete only after the above contracts and actual checks pass
at the delivered local revision, known blockers are reported honestly and final
preservation is established in its stated scope. It does not complete R10 or
grant human engineering acceptance. Make only a local delivery commit, apply
prepare-stage-handoff to PF-R10 using final local/remote evidence, and continue
automatically only under the existing user authority and any unresolved runtime
gate. Never merge/publish/update the original application to finish this stage.
