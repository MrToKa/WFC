# PF-0 — Validation and future acceptance matrix

Source baseline: WFC `e1ef20202598bb4d3d78e4772cbbb9747ec23a00`, PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a`. PF-0 documentation lives only in local worktree `WFC-pathfinder-local` / branch `pf-0-contracts-baseline-20261017`.

Read the [baseline](00-baseline.md), [specification](00-specification.md), [parity catalogue](00-parity-fixtures.md) and [stage report](00-stage-report.md). This is a new matrix; old Routings viewer criteria and evidence are not overwritten.

## Status rules

- `PASS`: the specifically named check was performed successfully at the recorded scope.
- `FAIL`: the check was executed and the stated expectation failed.
- `BLOCKED`: a concrete prerequisite prevents the stated check.
- `NOT_RUN`: no execution of that functional check is claimed.

The first table accepts PF-0 **contracts and evidence**, not the future implementation. A source/contract PASS does not imply working admin UI, exact conversion geometry or end-to-end parity. Final human acceptance remains a separate user decision.

## PF-0 deliverable criteria

| ID | Observable criterion | Method / evidence | Result |
|---|---|---|---|
| PF0-BASE-01 | Both original PathFinder checkouts and WFC are distinguished by path, HEAD, branch, dirty state and live/cached remote comparison. | `evidence/00-start-state.json`; `evidence/01-github-observations.json`; baseline old-checkout analysis | PASS |
| PF0-ISO-01 | Deliveries are confined to the new local WFC worktree/branch; original main and old dirty files are preserved. | `evidence/02-final-validation.json`: original source/dirty hashes and scoped docs; known retained temporary child disclosed separately | PASS |
| PF0-REMOTE-01 | Remote heads, branch lists, unrelated open PR/reviews and exact-head CI observations are recorded with retrieval time. | `evidence/01-github-observations.json`; zero statuses/checks/Actions are not functional PASS | PASS |
| PF0-CORE-01 | Every active pure source file/function has an owner, input/output, host boundary and corresponding test/reference coverage; legacy code is distinguished. | Parity catalogue; 11 core / 9 harness hashes; final manifest audit | PASS |
| PF0-MATH-01 | PF geometry, category/gap priorities, approaches, lookup and Reverse semantics are frozen; formula ordering and precision are explicit. | Specification plus parity catalogue/source anchors and actual-core synthetic extraction | PASS |
| PF0-SET-01 | All three allowances are authoritative Project > Details values; null/zero, units, snapshot and invalidation are explicit. | Specification/contracts; actual WFC field mapping and user decision | PASS |
| PF0-CAT-01 | MV/LV/Control map directly and user-confirmed Instrumentation maps to Control; missing/unknown categories require resolution. | Specification and contract examples; explicit user reply 17 October | PASS |
| PF0-LOC-01 | One project location identity serves both directions/multiple cables, with versioned position bindings, ambiguity and manual precedence. | Specification/contracts; missing-registry source review | PASS |
| PF0-AUTH-01 | Strict admin UI/API/job/Apply checks are specified separately from broader engineer capabilities and session/project access. | Specification/contracts and WFC middleware/tab source review | PASS |
| PF0-VIEW-01 | Exact computed path/picking contracts respect the existing message limit and project/model/load/request fences; Ghost is preserved. | Specification/contracts vs current protocol | PASS |
| PF0-APPLY-01 | Automatic drafts, explicit review/apply, input/write version comparison, idempotency, audit and unchanged install length are specified. | Specification/contracts vs current cable update/history; independent review corrections | PASS |
| PF0-INPUT-01 | Model input explicitly declares geometry/units/transforms/identities/visibility; display readiness is distinct from calculation readiness. | Specification/contracts and parity input catalogue | PASS |
| PF0-REF-01 | Synthetic expected results originate from the unchanged actual core with source hashes and a reproducible generator; missing real paired cases are disclosed. | Fixture manifest, 43 expected cases, generator, repeat and final source/artifact hash audit | PASS |
| PF0-TEST-01 | Existing package-free pure Release harness is executed from an isolated source copy; exact count/log/private-fixture omission retained. | `evidence/pf-core-release.log`, 105/105 and `pf-core-summary.json` | PASS |
| PF0-DOC-01 | Local document links and JSON examples/schemas are consistent; expected hashes, source identity and owned-file scope are checked. | `evidence/02-final-validation.json` technicalStatus PASS; independent document review | PASS |
| PF0-PRESERVE-01 | No stage runtime is started; existing container identity/image/start state and original dirty file hashes remain unchanged. | `evidence/02-final-validation.json`: all 13 containers and three original source trees preserved | PASS |
| PF0-CLEAN-01 | Owned temporary core copies/build outputs are removed after evidence is retained; no original or necessary worktree files are deleted. | Automatic approval review rejected recursive deletion: `blocked by policy`; no executed deletion or retry. One retained child / 162 files / 3,586,733 bytes | BLOCKED |

## Future implementation criteria — all NOT_RUN in PF-0

| ID | Expected observable result | Target stage | Status / prerequisite |
|---|---|---|---|
| PF1-CORE-01 | Extracted core runs without Autodesk assemblies, COM or a desktop process; its synthetic outputs match the frozen reference. | PF-1 | NOT_RUN; preserve actual code and source provenance |
| PF1-API-01 | Bounded local worker/service accepts versioned inputs and returns exact path, lengths and diagnostics with cancellation. | PF-1 | NOT_RUN; contracts are proposed, not existing endpoints |
| PF2-GEO-01 | Real converted model yields equivalent world-space meshes, fragment boundaries, hierarchy and geometry-derived connections. | PF-2 | NOT_RUN; complete paired native/converted input evidence needed |
| PF2-ID-01 | Model-object/segment bindings are version-aware; units, root transforms and offsets agree for endpoints and paths. | PF-2 | NOT_RUN; cross-conversion identity must be proven |
| PF2-GRAPH-01 | Graph is prepared once per appropriate model/rule revision with bounded memory/time, progress and integrity checks. | PF-2 | NOT_RUN; real-model measurements required |
| PF3-LOC-01 | A single manual resolution automatically serves all matching From and To endpoints, persists after restart, and remains project-isolated. | PF-3 | NOT_RUN |
| PF3-LOC-02 | Missing/blank/duplicate locations remain distinguishable; no arbitrary first/fuzzy match; new model bindings are revalidated. | PF-3 | NOT_RUN |
| PF4-AUTH-01 | Admin UI, deep URL and every calculation/location/job/Apply API deny non-admin engineers; role revocation is respected. | PF-4 | NOT_RUN |
| PF4-VIEW-01 | Exact result points, endpoints and original tray colors are shown; surrounding geometry is Ghost; Clear restores prior state. | PF-4 | NOT_RUN |
| PF5-JOB-01 | Batch jobs continue independently of the tab, with progress, cancellation, retry/restart and deterministic input identity. | PF-5 | NOT_RUN |
| PF5-SET-01 | Edited Details values are read server-side; allowance-only edits recalculate design length without unnecessary geometry rebuild. | PF-5 | NOT_RUN |
| PF5-STALE-01 | Changed cable/location/model/rules/settings make old drafts outdated; stale work cannot become an applicable result. | PF-5 | NOT_RUN |
| PF6-APPLY-01 | Reviewed route/design length are applied atomically with current-input conflict checking, idempotency and attributable history. | PF-6 | NOT_RUN |
| PF6-APPLY-02 | Install length is preserved; manual/import changes invalidate the appropriate provenance; applied geometry is shown consistently. | PF-6 | NOT_RUN |
| PF7-PARITY-01 | Actual web pipeline matches representative reference paths, all numeric rules and diagnostic boundaries. | PF-7 | NOT_RUN; synthetic direct-core results are insufficient alone |
| PF7-REG-01 | Existing Details/Cables/Routings viewer/session/Ghost behavior remains usable; independent projects/models do not leak state. | PF-7 | NOT_RUN |
| PF8-OPS-01 | Separate local runtime has separate containers/DB/storage/ports; backup/restore includes new authoritative artifacts. | PF-8 | NOT_RUN; original runtime is not a deployment target |
| PF8-LOCAL-01 | Prepared model and local calculation work without Navisworks or conversion/cloud calls during routing. | PF-8 | NOT_RUN |
| PF8-USER-01 | User views the local demonstration and decides whether merging/publishing/deployment is wanted. | PF-8 | NOT_RUN; no blanket authorization inferred |

## Gates

PF-0 technical completion requires its deliverable rows to pass or to identify a concrete evidence limitation without hiding an unfulfilled deliverable. It does not require future PF-2/PF-7 parity checks to pass now. A missing real-model oracle is a PF-2/PF-7 dependency; it does not prevent extracting the existing pure core in PF-1.

PF-1 readiness means the reference source, mathematical contract, accepted decisions, fixture provenance and proposed boundaries are usable. If an unresolved question affects PF-1 inputs, state it explicitly. Do not silently infer acceptance or advance to PF-1.

## PF-1 execution — appended 17 October 2026

The preceding sections remain the frozen PF-0 observation. The user's subsequent explicit automation/start instruction authorizes PF-1 and later stages. This table records the new implementation and does not relabel PF-0 checks.

| ID | Current scope / evidence | Result |
|---|---|---|
| PF1-CORE-01 | Extracted separate DLL; eleven source files byte-identical; 105 original regression checks; 43 frozen cases replayed | PASS |
| PF1-API-01 | Strict local stdio worker/adapter, exact points/metrics/decimal values, bounded input, cancellation and hard process deadline; 215 boundary/parity checks | PASS |
| PF1-REVIEW-01 | Exact decimal rounding/underflow and `/LIMIT1` classification review findings resolved with fresh checks | PASS |
| PF1-ISO-01 | Source/environment audit preserves original three checkouts, local modifications and thirteen containers | PASS |
| PF1-CLEAN-01 | No PF-1 containers or disposable source clones; required ignored builds retained; inherited PF-0 denied child untouched | PASS for PF-1 scope; inherited PF0-CLEAN-01 remains BLOCKED |
| PF2-GEO-01 and later rows | No new native/converted, application UI, authorization, jobs or Apply behavior verified in PF-1 | NOT_RUN |

See [PF-1 report](01-stage-report.md), [core delivery](01-core-extraction.md) and their linked fresh evidence. Final human acceptance and integration authorization remain separate.

## PF-2 partial execution — 18 October 2026, Europe/Kiev

This is a blocked partial stage, not acceptance or a PF-3 handoff. Original
PF-0 and PF-1 observations above remain historical at their stated revisions.
Current source hashes and original-environment preservation are recorded by the
new PF-2 isolation receipt; the unchanged Core was not refactored.

| ID | Actual scope / evidence | Result |
|---|---|---|
| PF2-CONTRACT-01 | Strict canonical snapshot, binary64 transforms, explicit leaf/owner roles, order-independent hierarchy depth, bounded fitting/cache, cancellation/corruption controls; 82 synthetic checks | PASS at synthetic scope |
| PF2-NORM-01 | Raw hash closure, finite geometry, reviewed pair contract and comparator negative controls; 27 checks including hierarchy 512/513 in both orders | PASS at synthetic scope |
| PF2-SDK-01 | Pinned SDK indexed/nonindexed triangle enumeration and actual fragment winding/order; 6 checks; fresh actual UI captures after correction | PASS at captured scope |
| PF2-CAPTURE-01 | Actual offline rendering, 438,155-object complete hierarchy / 664,556 fragments; two selected captures 68/26 leaves, final strict normalization, zero internal matrix/sample residual | PASS at inventory/selected-mesh scope; full plant geometry NOT_RUN |
| PF2-CACHE-01 | Bounded ModelCheck CLI smoke 9 checks; two actual selected network fits and exact memory/disk restoration of paths/segments/counters/diagnostics | PASS at diagnostic scope; graph per calculation |
| PF2-GEO-01 | Independent same-source native/converted fitting, topology, full path/design parity; native CLI exits 2 with entitlement not found before capture | BLOCKED; no native comparison or engineering tolerance established |
| PF2-ID-01 | Version-local IDs/hierarchy and actual recorded SDK transforms verified internally; independent native identity/units/root/visibility/source correspondence absent | BLOCKED for independent agreement; internal checks partial scope only |
| PF2-GRAPH-01 | Reviewed endpoint-dependent graph semantics; reusable final graph/preparation API and plant capacity not implemented/proven | NOT_IMPLEMENTED / NOT_RUN |
| PF2-LENGTH-01 | Actual diagnostic totals 107.55007443085563m / 37.050260813690024m differ from historical rounded 100.972m / 35.299m; reported fallback bends/straights; no authoritative paired fixture | BLOCKED; unresolved difference, no engineering acceptance |
| PF2-OPS-01 | Temporary owned loopback server/browser stopped/closed; no stage containers; original repositories/dirty files/container identities preserved by `isolation-1792271766371.json` | PASS at preservation/owned-runtime scope; database content audit not claimed |
| PF2-CLEAN-01 | Required ignored copies/captures/cache retained for resume; two earlier automatic approval removal denials not retried | BLOCKED for denied children; no new deletion attempted |
| PF3-LOC-01 and later | No new tab/location/jobs/Apply integration; automation PAUSED pending authorized complete native reference | NOT_STARTED |

See [PF-2 report](02-stage-report.md), [computational boundary](02-model-geometry.md)
and linked compact evidence. Automatic continuation was paused at the concrete
external licence blocker; no successful-stage or user-acceptance claim follows.

## PF-3–PF-7 independent execution — 18 October 2026

The user's later resumption in `18-execution-resume.md` supersedes the earlier
routine stop. Frozen/historical observations above remain unchanged.
Implementation checkpoint `51cc8324b40bd0ce2ed7d0b03decbdc06385b54a` contains the
integrated local workflow; final images and test scopes are in
[PF-7 report](07-stage-report.md). These rows do not accept native engineering
equivalence or authorize original-installation updates.

| ID | Actual scope / evidence | Result |
|---|---|---|
| PF3-LOC-01 | One manual identity resolves SYNTHETIC-1 From and SYNTHETIC-2 To; both auto-recalculate; registry/save/pick/reload/actual restore evidence linked in reports | PASS at local fixture/shared registry scope; final restore separately PF-8 |
| PF3-LOC-02 | Pure20 +actual SQL10 +HTTP13; ambiguity/missing/stale and project/model fences, aliases and ABA revision behavior | PASS at recorded fixture scope |
| PF4-AUTH-01 | Actual engineer deep-link fallback; current-admin/revocation/late-expiry/cross-project API and Apply controls in20 live checks | PASS at tested roles/actions |
| PF4-VIEW-01 | Final computer-use real selected-network exact lookup/Reverse35.30345579516123m, original colors, filled Ghost, yellow mesh; zero-ID paths/one-point marker; Clear restores visibility/colors | PASS at captured diagnostic/synthetic scope; no camera restore claim |
| PF5-JOB-01 | Actual durable2/2, cancellation held terminal, explicit retry, lease owner fencing; backend20 live; actual child crash recovery reported separately PF-8 | PASS at checked scope; fullplant throughput NOT_RUN |
| PF5-SET-01 | UI reserve6→7→6; retained10m geometry, design18→19→18, applied18 unchanged; server design-mode receipts | PASS |
| PF5-STALE-01 | Model selection/settings/manual edits ABA, location edits, health/auth late fences; stale review/Apply refused | PASS at fixtures and actual UI actions |
| PF6-APPLY-01 |20 live checks: atomic route/design/history/receipt, rollback on failure, immutable review/idempotency; current auth/dependencies through commit | PASS for exact trusted local synthetic fixture |
| PF6-APPLY-02 | installLength99 retained, server write revision increments for each distinct Apply, idempotent replay no extra increment; manual/import change staleness | PASS at actual own SQL/HTTP fixture |
| PF7-REG-01 | Frontend71, protected runtime104, backend34, legacy40, refreshed registry13, Core105/215, ModelRunner38; compile/lint at recorded source | PASS at stated regression scope |
| PF7-PARITY-01 | Full web pipeline synthetic10m/18m and captured diagnostics checked; representative same-source native paired geometry/path/design oracle missing | BLOCKED for real engineering acceptance |
| PF2-GRAPH-01 | Fitted geometry disk cache present; unchanged endpoint-dependent graph constructed per query; see19-graph-preparation-review | NOT_IMPLEMENTED for reusable graph; capacity NOT_RUN |
| PF8-LOCAL-01 | Local Viewer/assets/CSP, analytics disabled, internal Docker API network; no runtime native/cloud dependency in exercised paths | PASS at inspected/observed scope; computer network disconnect NOT_RUN |
| PF8-USER-01 | Local demonstration and instructions prepared; user has not yet accepted this new feature or approved integration | NOT_RUN |

Final operational audit/cleanup outcomes append below after their actual checks.

## PF-8 operational execution — 18 October 2026, 02:41 UTC

| ID | Actual scope / evidence | Result |
|---|---|---|
| PF8-OPS-01 |Final cold ownDB/MinIO/staging/PF-artifacts/four exact images backup43365396; fresh extra5191restore, equal inventory/model selection,2versions/684resources/10PFfiles; final-drill-1792291231726 | PASS same-host/platform |
| PF8-SESSION-01 |Positive source200 before/after; copied targetViewer410SESSION_REVOKED, oldJWT401, fresh cookie200 | PASS |
| PF8-RECOVERY-01 |Actual .NETpair observed; extraAPIkilled at8/64; natural lease attempt2 completes64/64/0duplicates/noApply with preserved install/routing/design/revisions | PASS at restored synthetic scope |
| PF8-PRESERVE-01 |Final5-group audit evidence/pf8/isolation-1792291275364; original checkouts/dirtyfiles/13container IDs/images/starttimes and pinned/frozen sources preserved | PASS |
| PF8-CLEAN-01 |Extra target0containers/networks/volumes,8oldownimages and903979537oldarchivebytes removed after finalreplacement verified | PASS newownscope; two historicpolicydeniedchildren remain BLOCKED |
| PF8-PORTABILITY-01 |Restore onto another computer/platform | NOT_RUN; actual drill samehost |
| PF8-LOCAL-01 |Final offline/CSP/internal-network +actual local runtime computation scope | PASS at observed scope; hostnetworkdisconnect NOT_RUN |
| PF8-USER-01 |New localfeature accepted by user/authorized for originalapp merge | NOT_RUN; no merge/push/deployment |

See [PF-8 report](08-stage-report.md) for exact retained backup, images, source
hashes, limits and next unmet-gate handoff. PF-2/PF-7 engineering gate and
PF2-GRAPH-01 remain unresolved; operationalPASS does not change them.

## Revised user acceptance path — 18 October 2026, project gap/manual review

The user confirmed the exact source filename, no available Navisworks licence,
and chose to manually inspect generated routes/lengths instead of requiring a
native oracle. This supersedes the earlier prerequisite, not the historical
test results. See [current decision](20-manual-review-and-project-gap.md).

| ID | Current required outcome | Observed status at873afeb |
|---|---|---|
| PF7-PARITY-01 native oracle |No longer mandatory for the user's chosen manual local acceptance path; no native-parity PASS implied | NOT_PERFORMED / NOT_REQUIRED_BY_USER |
| PF6-MANUAL-01 |Current strict-admin exact proposal review permits real Apply with manual-review provenance; no blanket acceptance flag | IMPLEMENTED; automated source guardsPASS; actual23live/UI pending |
| PF5-GAP-01 |Project Details connectionGap defaults1m, persists, positive<=100, cannot be overridden by request/job options | IMPLEMENTED; backend51source/process and191regression PASS; actualnewimage/API pending |
| PF5-GAP-02 |Gap edits force reroute/staleness; three allowance-only edits retain geometry and recalculate design | IMPLEMENTED; sourcechecksPASS; final23live pending |
| PF4-GAP-01 |Separate gap card,3decimal precision, exact labelled formula/current Details values; read-only lookup gap | IMPLEMENTED;147frontendpre-finalguard and finalPFtab17/tsc/lintPASS; computer-use pending |
| PF8-CLEAN-02 |Only verified older same-owner/project backup payload may be retired after verified replacement, no root/escape/junction targets |17safetycontrolsPASS; actualreplacementdrill/cleanup pending |
| PF8-USER-01 |Human checks actual generated routes and lengths and supplies acceptance or corrections | PENDING_USER_REVIEW |
| PF2-GRAPH-01/fullplant |Reusable graph preparation, complete plant capture and capacity | NOT_IMPLEMENTED / NOT_RUN at previously reported scopes |

No original source/app/data update or publication is authorized. Later actual
API/UI/operations results append or link to the new revision report.

## Final project-gap/manual-review delivery — 18 October 2026,07:06 UTC

Production follow-upsfeac4eb; corrected test-driver/image checkpointcfdcd3f.
Actual API286e0d43/web50034521, source810manifestd0ad1efa. The earlier22/23
test-baseline failure is preserved, not relabelled; corrected final23/23PASS.
See [the scoped report](21-manual-review-settings-report.md) for exact identities,
counts and receipts. Historical rows above retain their original scope/status.

| ID | Final observed result | Status |
|---|---|---|
| PF5-GAP-01/02 |Actual23SQL/HTTP plus earlier51process/settings and191regressions; current stored gap governs jobs/lookup; invalid values refused; gap reroute/ABA staleness and all3allowance design reuse | PASS at fixture scope |
| PF6-MANUAL-01 |Fresh per-proposal manual Review/atomicApply/provenance/idempotency/install preservation; currentauth/dependency fences; actual over-limit design cannot be reviewed/applied | PASS in own disposable fixture; actual real demo unapplied |
| PF4-GAP-01 |Actual1default card/invalid0/0.25savedreload/formula/read-onlylookup; final browser Confirm enables Apply and reload resets it; final19affected frontend checks | PASS at recorded source/image scopes |
| PF4-REVIEW-ASYNC |Deferred Review cannot restore another cable's old panel; late Apply notice fenced; prior reproduced case had Applydisabled | PASS; no observed authorization bypass claimed |
| PF8-OPS/SESSION/RECOVERY |Final backup2ae6f51b, samehostrestore/684resources/13PFfiles, cookie/JWT fences, actual interrupted worker recovers64/64/no duplicates/noApply, extra target0resources | PASS |
| PF8-CLEAN/PRESERVE |8oldpayloads1,346,316,196bytes and6unusedownimages removed; final5-group original-source/container/pinned preservation | PASS for new own cleanup; inherited denied scratch children retained BLOCKED |
| PF8-USER-01 |Human reviews new generated route/length and decides whether to accept | PENDING_USER_REVIEW |
| PF7-PARITY-01 |Native comparison declined as mandatory acceptance by user | NOT_PERFORMED / NOT_REQUIRED_BY_USER |
| PF2-GRAPH-01/fullplant |Reusable graph, wholeplant capture/category completeness/capacity; crosscomputer restore/host networkdisconnect | NOT_IMPLEMENTED / NOT_RUN as scoped in report |

## Routes + Path revision — 18 October 2026

Source checkpoints46152f9 (feature),542e101 (browser appearance/caption fixes),
cb02f43 (immutable metadata during design reuse). Full scope and dated receipts:
[Routes + Path report](22-routes-path-tabs.md). Historical failures remain recorded.

| ID | Observed outcome | Status |
|---|---|---|
| PF4-TABS-01 |Outer Path Finder; Routes + Path, keyboard switching, one protected Viewer and retained drafts; actual ten-root rule capture52objects | PASS at source/first browser scope |
| PF2-RULES-01 |Newest category rule precedence, explicit exclusion, deepest geometry, bounded native route names; legacy capture retained | PASS: source94Model/19capture and actual selected-network capture; wholeplant NOT_RUN |
| PF5-PREVIEW-01 |Standalone named/point/reverse previews, category/trigger/vertical preferences, immutable dependency/job separation, no fake cables/Apply | PASS: finalcb02 actual29/29 and actual35.30345579516123m/design45 forward/reverse |
| PF4-APPEARANCE-01 |DefaultfilledGhost, original-material75/0/100, protected original route colors/yellow, Clearrestore, nextpathdefaultGhostreset | PASS: actual542 browser and60Node correction checks; unconsolidation persists until Reload model |
| PF3-CAPTION-01 |Shared-save confirmation replaces stale hint and retains exact existing QA point | PASS: affected sourcecase and actual542browser |
| PF5-REUSE-METADATA-01 |Canonical category and prepared diagnostics survive design-only geometry reuse from immutable input | Earlier27/29 FAIL preserved; bounded69/69 sourcefix and finalcb02 actual29/29 PASS; stale historical optional diagnostics not backfilled |
| PF5-GAP-CONCURRENT-01 |Changedgap geometry hash plus actual fresh successful full calculation; later design reuse permitted | Earlier explicit-request-mode assertion FAIL preserved; stronger finalcb02 actual proof PASS with contributor IDs |
| PF8-TABS-OPS |Verified combined replacementbackup, restore/session/64cable recovery/cleanup for finalcandidate | PASS: newd7d63dce archive, source cookie200/copied410/sourcebearer401/newcookie200; actual64/64 recovery; extra0resources; eightoldpayloads/sixownimages retired |
| PF8-PREVIEW-RECOVERY |Actual same-preview job crash/natural lease recovery plus no-workflow-write cancellation | PARTIAL: queued cancellation/no-workflow-write PASS; exact-job recovery NOT_RUN because observed preview advanced before KILL; no fake numeric-recovery PASS |
| PF8-POST-RESTART |Protected browser after coldstop; safe Refresh and recomputed defaultGhost route | PASS: accessended fails closed; Refresh modelready and35.30345579516123m/design45; no realApply |
| PF8-PRESERVE-TABS |Original checkouts/dirtyfiles,13containers,Core/PF0/native source pins | PASS: final5group isolation-1792313848085.json |
| PF8-USER-01 |Human route/length review | PENDING_USER_REVIEW |
| PF7-PARITY-01 |Native comparison | NOT_PERFORMED / NOT_REQUIRED_BY_USER |

## Independent Path lookup revision — 18 October 2026

Feature60e9ce6, browser-driven caption correction73c13aa. Exact receipts and
remaining scopes are in [report23](23-independent-path-lookup.md).

| ID | Observed outcome | Status |
|---|---|---|
| PF4-LOOKUP-TAB |Three persistent tools/one protected Viewer; retained input; independent dirty-Routes lookup; Path draft fences; Restore and actual Cancel | PASS at source44baseline+9affected and actual first-candidate browser scope |
| PF2-LOOKUP-OWNERS |Pinned C# parser/owner hierarchy/wrapper collapse/ambiguity/qualified names; exact leaves; dedicated capture cannot become planning | PASS:37scope,94legacyModel,75protectedNode,42runner,106backend/5realprivateprocess checks |
| PF5-LOOKUP-API |No planning query required; purpose/SHA reuse/file checks; current model/selection/admin/login/Detailsgap fences; large pre-body transport | PASS source and actual10/10API,13,201,771-byte nginx upload; live no-planning-history case NOT_RUN |
| PF5-LOOKUP-REAL |Actual forward/reverse/dirty lookup35.30345579516123m,4gaps/.9840583861033791m,25usedleaves; exact90point reversal; raw55/27 resolves52/26 | PASS converted-model execution; human engineering acceptance PENDING |
| PF4-LOOKUP-CAPTION |Used leaves caption distinct from prepared-network fallback counts | First browser caption FAIL; text-only73c13aa +affected1case/types/lint PASS; final browser separately recorded in report23 |
| PF6-LOOKUP-NO-WRITES |All12 settings/selection/registry/planning/location/binding/object/cable/proposal/review/Apply hashes unchanged; registry11,104objects,5proposals,3reviews,0Apply | PASS real after-UI read-only audit |
| PF8-LOOKUP-ARCHIVE |Corrected source images/schema/newlookup archived and restored on separate5191; resource/session/JWT fences | PASS final-drill-1792317333519.json;27artifactfiles/7,678,830bytes; lookup-specific readback/retirement/cleanup separately in report23 |
| PF8-LOOKUP-CRASH |New actual worker/preview crash recovery | NOT_RUN by explicit scoped operator skip; previous accepted64cable and PARTIALpreview scopes remain historical |
| PF8-LOOKUP-FINAL |Corrected browser/result25usedleaves; final12workflow hashes/cable revision0/null/Apply0; actual restored lookup purpose/SHA; targetzero;8oldpayloads1,348,954,278bytes/4unusedimages retired; original5groups preserved | PASS: final browser/audit/combineddrill/cleanup/isolation receipts in report23 |
| PF8-USER-01 |Human route/length acceptance and separate main integration decision | PENDING_USER_REVIEW; no real Apply or main publication |

## PF-2 bounded capacity continuation — 18 October 2026

Additive source on `pf-2-capacity-local-20261018`, inheriting8a726f72; exact source,
assembly, input and actual executed-tool hashes are in [report24](24-capacity-baseline.md).
This does not reclassify native comparison or whole-plant acceptance.

| ID | Observed outcome | Status |
|---|---|---|
| PF2-CAP-INPUT |Exact current copied52object/26segment planning snapshot, real Details/options/endpoints, separately saved current reference; no jobs | PASS input-provenance1792324304556 and full semantic digestaa699a15... |
| PF2-CAP-CLI |New tool/single Core ProjectReference; fresh build/selftest21phases and17targeted invalid/hash/identity/purpose/limits/path refusals | PASS exact finalDLL90c93947...; not a new105/215regression execution |
| PF2-CAP-RESULT |Five datasets/65phases/50direct queries/15actual one-shot queries; full routes/design/category equal; independent synthetic16/128/512/2048m and24/147/569/2259m | PASS summary1792325273563; scope selected real +mathematical8/64/256/1024 only |
| PF2-CAP-BOUNDS |Node28guards, finite/full output, four actual process cancellation/deadline/output/cleanup controls; unchangedlimits | PASS; sampledRSS estimate, cgrouppeak unavailable; no exact peak/plant claim |
| PF2-CAP-PRESERVE |All12workflow hashes,18container identities, source/copiedbytes/Details/selection and original sourcepins unchanged | PASS final-preservation1792325162813 +isolation1792325122300; mount-order falseFAIL separately retained/amended |
| PF2-CAP-CLEAN |Own temporary containers gone; four redundant files10,010,214bytes removed; finaldemo/evidence retained | PASS for performed cleanup; two oldbuild/testdir removals BLOCKED by automatic approval review,2,502,799bytes retained/no retry; six total denied children untouched |
| PF2-GRAPH-01 |Reusable graph prepared once per appropriate revision | NOT_IMPLEMENTED; unchanged Core graph still per query |
| PF2-CAP-PLANT |Representative complete real-plant geometry/category/capacity | NOT_RUN; selected26segments and sparse syntheticchains are insufficient |
| PF8-USER-01 |Human engineering route/length acceptance and main integration | PENDING_USER_REVIEW; no real Apply/push/PR/merge/deployment |

## PF-2 bounded private worker reuse — 18 October 2026

Source on `pf-2-worker-reuse-local-20261018`, inheriting capacity deliveryadcb55da
and handoffed0770f3. [Report25](25-private-worker-reuse.md) separates exact source,
private process qualification and restored-target controls. Scoped lifecycle and
browser checks are complete; final target post-UI data preservation remains
FAIL_NOT_RETAINED after a cleanup sequencing error. No activation is inferred.

| ID | Observed outcome | Status |
|---|---|---|
| PF2-SESSION-RUNNER |Private framed single lane/supervisor, one prepared identity, exact mixed-result semantics, no Core/Model changes | PASS308session/42one-shot at DLL0a421550; independent closing review |
| PF5-SESSION-NODE |Bounded transport/identity/deadline/reap/poison, advisory-owner factory, repeated PG errors and shutdown failure status | PASS61affected/types/lint at worker3ce7708; earlier55scope/actual lock-loss FAIL retained; independent closing review |
| PF2-SESSION-PARITY |Actual production Node executor+DLL real A/B/A and31synthetic forward/reverse full DTO equality/private memory reuse | PASS117checks; selected26leaf scope, not engineering/fullplant |
| PF5-SESSION-BOUNDS |Actual64count/31.5s idle/601.072s age/512MiB fixture/abort/crash/deadline/recovery and owned group reap | PASS210total across five modes, including parity117; no double-counted total |
| PF5-SESSION-AUTH |Actual current admin/login revocation, Settings/cable dependency staleness, active-owner rollover, cancel and unique publication | PASS10corrected API5cd3eca8;218later-ID Settings proposals stale; no per-Core-instruction or per-proposal owner instrumentation; previous10scope retained |
| PF8-SESSION-OPS |Actual own PG advisory backend loss, complete lane retirement, explicit restart, graceful stop and natural crash recovery | PASS21corrected individual controls plus separate9actual crash/7read-only closure; historical aggregate failures retained; crash replacement UUID NOT_RETAINED |
| PF8-SESSION-REAL |Rebuilt Linux targetDLL real route/design/full DTO repeat/private reuse; actual protected UI/Ghost/Clear | PASS at4b940d5c/API5cd3eca8 and browser receipt20261018T1324Z; selected scope only |
| PF8-SESSION-PRESERVE |Original sources/data/5190 unchanged; target/test cleanup and final preservation | Primary5190/all18baseline12auditchecks PASS; fresh5-group isolation PASS; own5191 retired. Final target post-UI workflow comparison FAIL_NOT_RETAINED after audit/retirement sequencing error, not repaired by primary audit |
| PF2-GRAPH-01/PF2-CAP-PLANT |Once-prepared graph and representative wholeplant scope | NOT_IMPLEMENTED / NOT_RUN; fitted geometry/session reuse does not close these requirements |
| PF8-USER-01 |Human engineering acceptance and main integration | PENDING_USER_REVIEW; no real Apply or publication |

## PF-2 retained whole-inventory coverage audit — 18 October 2026

Branchpf-2-coverage-local-20261018, base25e49401/handoff f2f5e6ab.
[Report26](26-retained-model-coverage.md) and its receipts preserve exact scope.

| ID | Observed outcome | Status |
|---|---|---|
| PF2-COVER-INTEGRITY |Actual214parts/152879123bytes,438155uniqueobjects/664556uniqueassociations,complete parents/childcounts/one root/depth14 | PASS6scoped gates in audit1792332295000; no fullmesh/engineering claim |
| PF2-COVER-SELECTED |All52selectedobjects/26LV+Controlleaves/99fragments join,10chosen root subtrees complete | PASS; other438103objects are unclassified modelscope, not automatically missing trays;0equipment/all nativevisibilityunknown |
| PF2-COVER-IDENTITY |PDB438156vsreachable438155 exact sets/external IDs | Set difference reconciled: mapping-only388764; allretained IDsagree/rootpresent. Runtime omission cause UNPROVED; CLI-alone narrowerflag retained |
| PF3-COVER-QA |All3retained QA cables/aliases/bindings with projectfences and unknownlivegates | PASS at retainedscope;2realmanual endpoints, thirdrealbindingstale;2synthetic cables not crossmatched; no businesscoverage claim |
| PF2-COVER-CONTROLS |Failure receipts/hash/path/offset/hierarchy/category/bounds/fragments/registry/workbounds | PASS43/43/TAP; source-only review closed; earlier fixturemkdirfailure preserved |
| PF2-COVER-PLANT/GRAPH |Full computational plant/equipment/category coverage, literal graphreuse and engineering acceptance | BLOCKED_INPUT/NOT_IMPLEMENTED/PENDING_USER_REVIEW as scoped; metadata audit and cooperative9.167s/604778496Bpeak are not routingcapacity |

## PF-8 fresh UI preservation and Clear caption — 18 October 2026

Branchpf-8-ui-preservation-local-20261018, base7aedfe0/handoff e275dd5.
[Report27](27-ui-data-preservation.md) keeps the older FAIL_NOT_RETAINED separate.

| ID | Observed outcome | Status |
|---|---|---|
| PF8-UI-AUDIT |Durable raw/diff-before-assert, exact image/module/phase chain, provenance and quiescence contracts | PASS34focusedcontrols; independent source review |
| PF8-UI-PHASES |Fresh A0/A1/A2/A3: automatic1job/item/proposal; standalone1preview/result; Clearzeroall18groups | PASS actual saved phases and24aggregatechecks at APIe0a6/web5abc; protected business/Review/Apply/existingrows unchanged |
| PF4-UI-CLEAR |Three owner-loss notice setters preserve drafts and late-result fences | PASS5selectedUITests/types/scopedlint/source-review; three pre-fixcaptionFAIL and separate test-accessorFAIL retained |
| PF8-UI-CAPTION |Web-only577e replacement; C0nochanges/C1onepreviewpair; same login/fixed API/modules | PASS5bindingcontrols and actualC0/C1; ordinarybrowser Clear notice/drafts PASS. NewroutecalculatedwhileViewerloading: retained-resultnotice, no new577eGhostdisplayclaim |
| PF8-UI-CLEAN |Full evidence/disposition before gated targetretirement; exact unreferenced ownedimages | PASS5containers/4volumes/2networks/3images; logical294832567B, physicalreclaimedNOT_MEASURED; all7deniedchildren untouched |
| PF8-UI-PRESERVE |Final5190/source/all18baseline audit aftercleanup | PASS12checks preservation1792335003878dfe1b66c; originalDBqueries NOT_RUN inthisstage |
| PF8-UI-HISTORY |Priorstage25 lost mismatch detail | FAIL_NOT_RETAINED unchanged; new valid addition shape does not conclusively diagnose old mismatch |
| PF3-INPUT-NEXT |Current HPU business From/To/MTO and fullmodel name/property candidatecoverage | NOT_RUN; separate narrow readonly handoff required. Template2027rows does not prove currentHPUprovenance |
| PF8-USER-01 |Engineering acceptance/fullplant/literalgraphreuse/mainintegration | PENDING_USER_REVIEW / NOT_PROVED / NOT_IMPLEMENTED / NOT_AUTHORIZED as scoped |

## PF-3 actual current inputs and full-model name coverage — 18 October 2026

Branchpf-3-input-coverage-local-20261018, handoff4ade614f, [report28](28-current-input-coverage.md).

| ID | Observed outcome | Status |
|---|---|---|
| PF3-INPUT-REAL |Guarded original read-only before/copy/after; exact pinned project, active fingerprint/five resource pins | PASS2140cables; fourprojection hashes/container metadata unchanged; private rows excluded fromGit |
| PF3-INPUT-HISTORY |First SQL rawaddress formatter and subsequent short project-name assertions | FAIL retained; separate diagnostics proved /32 formatting and sameUUID observed fullidentity; final guarded copy PASS |
| PF3-INPUT-CONTROLS |Source copy fixedparameterized RO SQL/endpoints/bounds/failure preservation | PASS final45controls+3syntax and independent closing source review |
| PF3-CANDIDATE-REAL |Production exact normalization/matching over all214parts/fivePDB resources, actual input | PASS_WITH_GAPS1527keys allmissing/0unique/0ambiguous;4280uses/3empty; no binding/geometry inference |
| PF3-CANDIDATE-SEMANTICS |Actual PDB decoder versus pinned SDK methods and retained SDK arrays | PASS115actual objects/0diff and52/52fullarrays; all438156PDBrecords scanned;0eligible exactmatches; no nativeequivalence claim |
| PF3-CANDIDATE-CONTROLS |Source-backed alias decoding and later metadata/count/projectpair deltas | PASS historical48fullcontrols +separate1/5/7affected checks; no invented finalfullsuite count |
| PF3-INPUT-PRESERVE |All18baseline containers, originals/source/5190 hashes after actual copy | PASS12checks1792337673384/300f2f34, separately original4projection consistency |
| PF3-CAPTURE-NEXT |1527raw names exceed existing256 preparation cap; knownhidden rows counted beforeLIMIT | NOT_IMPLEMENTED inthisdelivery; source-grounded next batching/eligibility stage, not engineering readiness |

## PF-3 bounded project capture and eligibility — 18 October 2026

Branchpf-3-batched-capture-local-20261018, handoff6761cb76, [report29](29-batched-capture.md).

| ID | Observed outcome | Status |
|---|---|---|
| PF3-CAPTURE-INPUT |One collecting ID, bounded input/count/order/hash/UTF8/session lifetime; shared3000ACK/output budget | PASS101finalruntime+syntax10; two actual stale-owner/deadline0/2reproductions corrected/source-reviewed |
| PF3-CAPTURE-1527 |Actual retained business names through planner/collector | PASS1527names/6chunks/7ACK/2993remainingresponses/max5567B; NOTactualbusinessSDK/geometry/matching proof |
| PF3-CAPTURE-FRONTEND |Controller/Routes/localguard and serverinputscope contracts | PASS53focused +7affectedTab +28rootAPI/hook; later2copy/layout checks separate; types/lintPASS |
| PF3-CAPTURE-CSHARP |Optional strict scope/scan metadata with legacy JSON and no proof promotion | PASS25focused reader controls on own artifacts; purecoremath unchanged |
| PF3-MATCH-HIDDEN |Eligibility beforeORDER/LIMIT; unknown/manual/project/model/currentauth | PASS12unit+1transportdelta; actualPostgreSQL12TEMP/ROLLBACK controls at pinned compiledmodules, no public businesswrites |
| PF3-CAPTURE-SERVED |Final ownAPIdce12a1f/web561d51c3, five served runtime hashes/two compiledmodules/health | PASS7; Linuxrunnerfe25497e modeoneshot, separate hostinterop5d84d779, no sessionactivation claim |
| PF3-CAPTURE-UI |Actual selected real group capture/reload/repeat in ownQAproject | PASS13objects/2QA names,438155of438155SDKrows/0omitted; saved card persists; no rawrule recovery/fullplant/real2140coverage/Ghost-or-route claim |
| PF3-CAPTURE-PRESERVE |Exact PostgreSQL JSONB text core rows through latestbuild/reload/secondcapture | PASS2projects/2types/3cables/2selections unchanged/0added; firstv1baseline precision limitation retained, not retroproof |
| PF3-CAPTURE-CLEAN |Unused exact own resources and wider original5190 preservation | PASS6ownunusedimages/3framingfiles deleted; physicalreclaimNOT_MEASURED; wider12PASS/all18baseline unchanged;7deniedchildren untouched |
| PF3-CAPTURE-NEXT |Separatecopied2140businessproject/modelstorage +actual1527SDKcapture | NOT_RUN; nextinheritinghandoff, no nativeoracle or inventedmapping/Apply |
