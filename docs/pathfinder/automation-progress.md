# PathFinder local implementation progress

## Authority and environment

The user explicitly authorized automatic implementation of the remaining stages on 17 October 2026, invoking `prepare-stage-handoff` after each completed stage and using recommended choices for routine questions. The subsequent instruction starts that work now. Historical per-stage stop instructions do not require a fresh confirmation. Final integration into the existing application remains a separate user decision.

- Working copy: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
- Current branch: `pf-2-capacity-local-20261018` (inspect live branch/HEAD before each continuation).
- Historical integrated implementation commit: `51cc8324b40bd0ce2ed7d0b03decbdc06385b54a`; integration evidence/handoff commit: `03db8f7b557c1afcf05c18b81e704119db459503`. Later delivery commits are recorded below. Read live HEAD/status rather than inferring a self-referential hash or pending-change state from this historical line.
- Verified local operational delivery commit: `bf9dfdf8b075259880b58cc7a31202844a902f87`; the following metadata-only commit records the actual automation pause. Current live HEAD is authoritative.
- Starting commit: `23741d1f485248ddb519f9e04e0b7856cc0e3def` (PF-0).
- Canonical reference: PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a`.
- Original WFC, both PathFinder checkouts, running containers, databases and storage are reference-only.
- No push, PR, merge, deployment or updating the existing installation is authorized.

## Latest delivery — PF-2 capacity baseline, 18 October 2026

SCOPED_TECHNICAL_PASS on `pf-2-capacity-local-20261018`, inheriting
`8a726f72ab94da22681320f28ccebe1224cf8eb3`. Current user requested the next
remaining stage. The original PF-2 item5 still requires capacity measurement;
previous manual-review handoffs do not waive that technical remainder. This is
an additive bounded benchmark, not a speculative stage or engineering acceptance.

- New assignment: [PF-2 capacity baseline](handoffs/PF-2-capacity-baseline.md),
  prepared with prepare-stage-handoff and separately authorized for execution.
- Ownership: C# agent only new CapacityBench tool; orchestrator agent only new
  scripts/pathfinder-capacity/; read-only input owner fresh scratch/provenance;
  parent docs/report/integration. Preserve shared changes.
- Verified additive build0warnings/errors and self-test3synthetic datasets/
  21phases PASS at final DLL90c939476155552bf3be27bbee29e09e220e159c16996fa30dcde4f997691b2a.
  Root17/17 malformed/hash/identity/purpose/limit/path controls PASS against
  those exact bytes; all preflight refusals preserve absent/existing workroots.
  Read-only copied-input provenance PASS with source SHA b4736540... and all
  12workflowhashes/18containeridentities unchanged at extraction scope.
- Actual five datasets/65direct phases/50direct queries/15one-shot queries and
  four process controls PASS. Full unrounded route/design/category match, including
  saved real preview35.30345579516123m/design45m. Node28guards/syntax PASS.
  Source API imageee402 unchanged; own networkless temporary containers retired.
  Initial omitted-false guard refusal and outer mount-order falseFAIL retained;
  new metadata-only normalized preservation amendment PASS, no math rerun.
  Real one-shot disk-warm mean1.200s(2) vs identical-query same-model median
  0.749ms(8) have different cost scopes; no deployed speedup is claimed.
- Final preservation PASS:12workflow hashes,18container identities, source/copy/
  manifest/reference bytes, all original checkouts/dirtyfiles/Core/PF0/native pins.
  See [report24](24-capacity-baseline.md) and its linked exact receipts.
- Work uses copies of own5190 selected real planning network and explicit new
  synthetic inputs. No live settings/jobs/Apply, no API restart/code change,
  no Core/limit changes. Whole-plant completeness/capacity remains NOT_RUN and
  reusable graph NOT_IMPLEMENTED. Native comparison remains not required by
  user; engineering manual acceptance PENDING. Heartbeat remains PAUSED while
  this direct authorized continuation is active.
- Cleanup:10,010,214bytes redundant own control copies removed. Removal of two
  superseded own scratch directories was rejected by automatic approval review
  `blocked by policy`;2,502,799bytes remain,0deleted. Never retry/bypass/remove
  parents of capacity-bench-build-6134b7566e7a43c9a3bd05843a30018f or
  capacity-bench-selftest-0e06d25a9f8c459594fe6a376c0660ee under engine/.scratch.
  These join the four previously denied children; all six are retained.
- Next: local commit of completed additive delivery, then prepare/execute a bounded
  private-worker reuse handoff if read-only feasibility preserves all current
  per-request/cancellation/cache/resource/auth guarantees. Measurement supports
  investigating repeated process/JIT/cache-restore overhead, not a Core fork or
  an assumption of mixed-query equivalence. User's routine continuation is authorized.

## Previous delivery — independent Path lookup, 18 October 2026

IMPLEMENTED/VERIFIED in the scoped local delivery on branch pf-path-lookup-local-20261018 inheriting
9e6561e33ccf9ab535fb2184c858ecd20240071d. User requested the third addon tab
and its functionality. Canonical source shows that this lookup independently
discovers requested visible logical routes, rather than using Routes assignments.

- Root owns API/hook/tests/docs/computer-use. Backend owner server/** and scoped
  nginx transport. Viewer owner Model/ModelRunner/capture/protocol/Controller and
  related tests. Former runtime owner currently owns only the three frontend
  tab/lookup/test files. Preserve concurrent edits; no partial-image builds.
- Flow: POST /lookups/plan uses pinned C# parser; protected bounded lookup capture
  discovers broad SDK name candidates; C# owner resolver filters exact logical
  owners, nested wrappers and ambiguity; new lookup-purpose artifact/job remains
  separate from planning. No registry bump, binding changes, planning promotion,
  cable proposal/Apply writes. Project Details owns gap. No design allowances.
- UI has Routes/Path/Path lookup with one protected Viewer, independent dirty-rule
  lookup, shared transparency, exact points, Reverse extension, Restore/Cancel,
  retained drafts and stale-response/review fences. Actual UI verification PASS.
- Current frozen source checks: root API/hook23/23 PASS (initial22/23 cancellation-message
  failure corrected with explicit AbortError); Model lookup37/37 plus legacy94/94,
  protected Node75/75, Controller20/20, Runner42/42 PASS. Initial Node interop used a historical DLL;
  fresh isolated DLL rebuilt and full affected suite passed, no source fix inferred.
  Backend106/106 focused controls PASS including actual Express transport and
  five fresh private C# worker calls. Types and scoped lint PASS. Frontend44-case
  baseline regression plus9final affected and1caption case PASS at their exact
  recorded scopes; this is not one full47run. Human acceptance remains PENDING.
- Source60e9ce6 built/started own5190 API1630510e/webf4b5a13. Actual scoped10/10
  API integration PASS, including13,201,771-byte nginx upload, purpose/auth/gap
  fences and cleanup. Real-project workflow baseline unchanged (registry11,
 104modelobjects,5proposals,3reviews,0Apply). Browser first forward/reverse lookup
  produced35.30345579516123m,4gaps/.9840583861033791m,25usedleaves with Ghost and
  protectedyellowline. Actual dirty-rule independence/Pathfences/Restore/Cancel
  PASS. Both reverse90point arrays exactly reverse forward. All12 workflow hashes
  unchanged; latest final job06c0b624-2d84-432e-9f1d-1c6f23cc4f6c, cable revision0,
  routing/design/installnull and0Apply. Final read-only audit is dated10:03UTC.
- Browser found one inaccurate caption: used leaves were labeled as all prepared
  geometry. Text-only correction73c13aa58519f26cbb96d93bbbb70bcdd5bb2cdd passes
  affected1test/types/lint; source828 manifest SHAc3a58fd623df881da39fa8f043a6260eb93ca3f989d938089a15015de958f2d7.
  Built/started APIee402f8d/web1895a3fa and final corrected browser PASS. API16
  filesystemlayers/fullConfig match actual-tested1630510e exactly. New verified
  backup3db9fa33-c10e-4646-82bc-fe99f3d8af35 is at
  pathfinder-engine/.scratch/path-lookup-archive-462d5a9465e8 with separate private
  companion. Archive/restore/session/newlookupreadback/targetretirement PASS;
  oldd7payloads1,348,954,278bytes and4unusedownimages retired. Extra target zero
  containers/volumes/networks. Both new crash tests deliberately NOT_RUN.
- Supplemental combined health/startup-receipt command was rejected by automatic
  approval review `blocked by policy`; it is not retried/bypassed. No startup JSON
  was produced. Actual successful runtime CLI start, build binding and separate
  10/10 API integration are the stated evidence.
- Final five-group preservation audit PASS: evidence/pf8/isolation-1792317744025.json.
  Report23 links all scopes, actual images and exact changed paths (59checkpoint
  files,45code/test/config paths; later docs/evidence only). No original update,
  publication, real Apply or user engineering acceptance performed.
- Next: actual human review in handoffs/PF-path-lookup-manual-review.md, prepared
  via prepare-stage-handoff. Existing heartbeat updated through app tool and
  remains PAUSED with schedule/target preserved. No routine unchanged reruns or
  invented stage. User feedback/main integration are separate decisions.
- Three prior denied cleanup children and parents remain untouched. A fourth,
  newly owned compatibility scratch removal was rejected by automatic approval
  review with `blocked by policy` on18October2026: `pathfinder-engine/.scratch/lookup-model-compat-459be54639f5400ebe91f856c64d7f5a`.
  It is retained; do not retry, delete its parent or bypass the rejection.
  The shell overwrite of the old handoff was also rejected; it was preserved and
  a new additive handoff was created with the file-editing tool. No rejected
  command retry, preview crash retry, native licence attempt or frozen PF0
  generator rerun occurred. Broad discovery4096objects/64MiB and other bounded
  limits remain; live no-planning-history case NOT_RUN, native comparison
  NOT_PERFORMED/NOT_REQUIRED_BY_USER, wholeplant/reusablegraph/crosscomputer and
  offline-disconnect limitations unchanged. Human engineering review PENDING.

## Previous delivery — Routes + Path, 18 October 2026

State: scoped local delivery IMPLEMENTED/VERIFIED; source/API/browser/combined
backup/restore/session/64-cable recovery/cleanup PASS. Extended preview exact-job
crash recovery NOT_RUN (PARTIAL extension). Human route/length acceptance PENDING.

- Worktree: C:/Users/todor.chankov/source/WFC-pathfinder-local, branch
  pf-two-tabs-local-20261018, inheriting fcd8f1dc39569c430125b897c95756fac9c28a89.
- Source: feature46152f9; appearance/caption542e101; final immutable-metadata fix
  cb02f43000a51b4f511346d2aa666d09929570e0. Source writers frozen.
- Live own5190: API7d216f20 / web36d9e4d6; exact binding in
  runtime/two-tabs-final-candidate-health-1792312921278.json. Source manifest817,
  SHA330b195d97b089e2c2cd063af96155dd513166a9711392a25dfa753df3777275,
  evidence/pf7/sources-1792312859326.json.
- User explicitly chose Routes + Path; outer label Path Finder. Routes supports
  newest category rules, explicit exclusion, deepest descendants and native
  bounded names. Path supports named/point/selection standalone preview/reverse,
  trigger/vertical preferences, shared locations, existing cable calculations and
  explicit Review/Apply; ordered lookup remains advanced. Previews create no fake
  cables or Apply. Details owns gap1m and all three design allowances. Core11 pinned.
- Changed modules: PathFinder*.tsx/tests, API/hook/outer tab/Details labels,
  server/pathfinder and router, protected Viewer protocol/Controller/capture/path,
  small Model DTO/reader/cache boundary, runtime recovery helper and docs/evidence.
- Actual source checks: backend69/69 after metadata fix; frontend36/36 full run
  plus focused callback/caption checks; root24 initial and18 final API/hook;
  Viewer60 final correction + original capture19/Controller19/legacy guards;
  Model94 and runner zero warnings/errors. Types/lint PASS at recorded scopes.
- First actual candidate29/29 PASS. Appearance75/0 and stale save caption failed
  in its browser run, then were corrected. Corrected542 backend27/29 exposed
  optional metadata loss during design reuse plus an over-specific concurrent
  gap assertion. Failed receipts remain intact. Final cb02 actual29/29 PASS;
  strengthened gap proof records fresh full-calculation contributor. Cleanup PASS.
- Actual computer-use: two tabs/keyboard/one Viewer/retained drafts; ten-root
  capture52objects/26segments; category edits/dirty/discard; exact selectedpoint;
  stale binding refusal/reconfirmation; standalone forward/reverse35.30345579516123m,
  design45m; Review enables Apply and tab change resets it. No real Apply.
  Corrected original-material75/0/100, defaultfilledGhost/yellowline/Clear PASS.
  New path resets defaultGhost. Saved caption confirmed. Finalcb02 fresh reload
  and protected path/Zoom PASS. See evidence/routes-path/computer-use-*.json.
- Real demo cable revision0, routing/design/install null, Apply0. Current artifact
  proposals retain Control/26segment diagnostics. Historical stale-artifact optional
  metadata is not backfilled; required frozen provenance remains available.
- Final operational receipts: runtime/final-drill-1792313480874.json,
  cleanup-1792313736971.json, two-tabs-final-health-1792313808306.json. Verified
  archive d7d63dce-4549-4e78-9bc5-7ff6a9eddc7b at
  pathfinder-engine/.scratch/pf-two-tabs-backup-20261018-0847 retains
  1,348,954,278payloadbytes/private companion. Restore/session/actual64cableworker
  recovery PASS; preview queuedcancel/no-workflowwrites PASS, same-job recovery
  NOT_RUN because observed job advanced before KILL. Extra target0resources.
  Removed8old2ae payloads1,346,348,226bytes and6unusedownimages; small oldprivate
  companion/compact provenance retained. Denied3 children untouched.
- Postrestart browser safely failed closed during coldstop; Refresh Path Finder
  restored ready model. One new standalone Control path35.30345579516123m/design45
  is displayed. Finalread-only audit post-operations-read-only-audit-20261018T085957Z.json
  confirms realcable revision0/routing-design-install null/Apply0 and preview
  noitems/proposals/reviews/Apply. Final5group preservation PASS in
  evidence/pf8/isolation-1792313848085.json. Current production bytes unchanged.
- SDK explicit transparency disables consolidation until Reload model; Clear
  restores appearance. No wholeplant throughput guarantee. Reusable graph and
  complete plant capture/capacity remain NOT_IMPLEMENTED/NOT_RUN. Native comparison
  NOT_PERFORMED/NOT_REQUIRED_BY_USER. Human manual engineering acceptance PENDING.
- Three denied cleanup children retained without retry/bypass: .pf0-work/core-1f723e37-
  f152-4a60-9b1e-46adc6c3179c, .pf2-work/model-tests-2733f823d57d477ba5e338a7d9a08cc9,
  pathfinder-engine/.scratch/model-tests-c13957af670e4ee2869cf876aa60d581. Automatic
  approval review said blocked by policy. Initial SDK certificate setup observation
  remains in report22; no certificate deletion attempted.
- Next: actual human route/length review via handoffs/PF-user-manual-review.md;
  react to concrete feedback with a new inherited local branch. Final report22,
  matrix and evidence are committed locally in the delivery commit containing
  this update (inspect live HEAD). Heartbeat updated through application tool to
  PAUSED; evidence/routes-path/automation-paused.json. No unchanged review loop.

Original checkouts/dirty files, synced sources/, original13containers and working
data remain untouched. No push, PR, merge, deployment or original update. Full
history, source receipts and honest failures: 22-routes-path-tabs.md.

## Previous delivery — project gap and manual real-result review

The latest user decision supersedes the earlier native-oracle prerequisite:
manual inspection of generated routes/lengths is the chosen acceptance path.
Native parity is NOT_PERFORMED / NOT_REQUIRED_BY_USER, never PASS. The exact
source filename is confirmed by the user. Human acceptance remains PENDING.

- Isolated branch: pf-manual-validation-settings-20261018. Settings/manual review
  checkpoint873afeb; production follow-upsfeac4eb; corrected live test driver
  and actual candidate checkpointcfdcd3f5974636737ff34acec0fc3de391d35ab1.
  Later commits deliver reports/evidence only. Inspect live HEAD/status first.
- Current5190 API286e0d43/web50034521 are healthy, rebuilt/restarted only in the
  owned stack. Details connectionGap default1m is persisted and authoritative;
  the three design allowances stay in Details; the formula card distinguishes
  legacy tray estimate and exact PathFinder math. Real Review+Apply is explicit,
  per proposal, with manual provenance and all current-state/write guards.
- Source checks: backend51process/settings plus191regressions at873afeb;
  final17boundary+16actualNode/.NET, frontend19affected plus tsc/lint PASS;
  earlier147frontend before follow-ups; runtime safety17PASS. These are separate
  scoped runs, not a new aggregate. Core/frozen source bytes unchanged.
- Final actual23SQL/HTTP and cleanup PASS on cfd/286e. Earlier22/23 test-baseline
  failure is retained separately; only test baseline ordering was corrected.
- Computer-use PASS: gap1/invalid0/0.25save+reload, formula/current values,
  read-only lookup; final real proposal35.30345579516123m/design45m, filledGhost,
  original tray colors/yellow; Confirm enables Apply, reload/reselect resets it.
  Real PF-MANUAL-DEMO has no Apply; routing/designNULL and0Applyreceipts.
- Final combined cold backup/restore/session/crash drill PASS: backup2ae6f51b,
  pf-manual-backup-20261018-0703 plus private companion retained;684resources,
  13PFfiles, actual worker interruption/natural retry64/64/no duplicates/noApply.
  Extra target retired to0containers/volumes/networks. Old433's8payloads
  1,346,316,196bytes and6unusedownimages removed; no physical layer savings
  inferred. Finalhealth200 and5-group preservation audit PASS. Original3trees,
  dirty reference files,13originalcontainer IDs/images/starttimes preserved.
- Source manifest810files d0ad1efa; final preservation receipt
  evidence/pf8/isolation-1792307166050.json. Exact source/image/test/backup/cleanup
  receipts and screenshots are linked in21-manual-review-settings-report.md.
- Two historic policy-denied scratch children remain visible/untracked and were
  not retried. No push/PR/merge/deployment/original app or data write occurred.
- Next handoff: handoffs/PF-user-manual-review.md, prepared using
  prepare-stage-handoff and actual local/remote evidence. Human review cannot
  be impersonated by another technical run. Whole-plant capacity/category
  completeness and reusable graph remain explicitly unperformed/unimplemented.

Technical delivery is ready for the user's manual review. Delivery/evidence
commit961d24ff0f8e6cbbe9a77807d631aa0b3d7f00ef follows the candidate checkpoint.
The heartbeat was setPAUSED through the app; stored status/name/schedule/target
were read back. See evidence/manual-settings/automation-paused.json. The full
saved configuration was resubmitted, changing only status. Do not repeat the old licence refusal
or unchanged completed tests. Resume from concrete feedback/remaining measured
scope while preserving the original installation and accepted algorithm.

## Latest wakeup audit — 18 October 2026, 05:38 UTC

Fresh HEADce8eab0/pf-8-delivery-local-20261018, clean trackedfiles and only two
denied untracked children. No native export appeared in inspected retained
evidence/output paths after02:46. No code/native-host/test/runtime/cleanup
operation was repeated. Existing technical passes remain historical evidence,
not new results. Refreshed remote/default revisions are unchanged; localfeature
is11ahead/0behind WFCmain, unpublished. The configured GitHub connector found
only unrelatedWFC#1 COMMENTEDreviews and no featureCI proof.

Automation was observedACTIVE again (reasonUNKNOWN), despite the prior actual
PAUSED receipt. It was setPAUSED again through the application tool; stored
status and unchanged prompt/name/schedule/target were checked. New receipt:
`evidence/pf8/automation-wakeup-20261018T0538Z.json`. The native-resume handoff
now includes this fresh baseline. Remain blocked on the same external reference;
no engineering acceptance, merge or deployment is inferred from a heartbeat.

## Historical delivery — before the revised manual-review criterion

The isolated5190 demonstration is healthy. Final combined cold backup/restore,
cookie/JWT fencing, actual .NET-child death/natural recovery64/64/0duplicates,
extra-target retirement and exact obsolete-resource cleanup all PASS.
Final preserved backup43365396 is retained. Final original-environment audit
PASS preserves13originalcontainer IDs/images/starttimes, threeoriginalsource
trees/dirtyfiles and frozen/pinned bytes. Only the two denied cleanup children
remain intended untracked. See `08-stage-report.md` and linked final receipts.

Final805sourcefile manifest3ea5002a differs from earlier63081706 only in the
strengthened operations crash driver; application images remain562e8073/81bb13b4.
Technical checks: Core105/215, ModelRunner38, registryHTTP13, backend34/20live,
legacy40, frontend71, runtime104, runtimeownership9. Exactscopes/receipts inPF-7.
Actual browser final yellow/Ghost/Review/onepoint/Clear passes are recorded.

Next executable task: `handoffs/PF-2-resume-native-validation.md`. It requires
a complete same-source full-precision native export from an authorized host or
working local entitlement plus permission for another capture. No repeat of
unchanged entitlement refusal is useful. Real engineering parity/acceptance is
BLOCKED; fullplantcapture/capacity NOT_RUN, reusablegraph NOT_IMPLEMENTED.
These unmet PF-2/PF-7 gates and user acceptance are not waived. The heartbeat
is now **PAUSED**, updated through the application tool after commitbf9dfdf;
its actual stored status and unchanged prompt/name/schedule/target were checked.
See `evidence/pf8/automation-paused-20261018.json`. Do not restart repeated
attempts without an actual change to the recorded external prerequisite.
No merge/push/PR/deployment/original-app or data write occurred.

## Earlier final technical checkpoint — 02:38 UTC

Final API562e8073 / web81bb13b4 is healthy on own5190. Backend20/20 actual,
34 process/registry,40 legacy, ModelRunner38, frontend71, runtime104 and
fresh Core105/215 checks PASS at their receipts. Actual final computer-use
now passes bright yellow real lookup/Reverse, filled Ghost including zero-ID
synthetic paths, readable review, one-point0m/design7m acknowledgment and
Clear restoration. Test TOX is restored10; automatic2/2 geometry10/design18.
No extra one-point Apply occurred. See PF-7/final computer-use receipt.

The runtime owner is now executing cold combined backup/restore/cookie fencing
and actual .NET-child crash recovery only on a fresh extra target. Source5190
is retained. Final report/audit/local commit and cleanup follow. Native/full
plant/graph reuse gates remain open. Original resources remain unchanged.

The prior checkpoint text below is historical; it is not the current list of
pending rendering fixes or final test counts.

## Earlier work checkpoint

**18 October user resumption supersedes the earlier routine stop:** automation is
ACTIVE again. See `18-execution-resume.md`. Independent PF-3 registry, PF-4
protected Viewer/UI, PF-5/PF-6 jobs/Apply and separate runtime work are progressing
in parallel; this does not waive PF-2/PF-7 engineering evidence. Current registry
source milestone: 20 pure +10 real SQL checks PASS, new ModelRunner 37 PASS,
fresh Core 105/215 PASS. Refreshed HTTP13/13 resolves the initial old-image alias
404; actual first jobs/Apply16/16 and browser workflow checks are recorded. See
`03-stage-report.md` and `07-stage-report.md`; no overall stage
acceptance or engineering Apply claimed. Runtime is new own localhost5190 with
fresh credentials/database/storage and copied model. Original resources stay
reference-only. Generate/finalize each subsequent handoff from real interfaces
and continue; do not treat old PAUSED entries below as current authorization.

PF-1 is **technically complete and verified** at local commit `db1b76ec32286d290210ba11adc0738c96665372`: 105/105 original regression checks and 215/215 parity/boundary checks, including 43 frozen cases, 33 production DTO replays and 14 CLI scenarios. Independent review fixes were verified, followed by the combined verification entry point. PF-2 has a **BLOCKED partial delivery** under `handoffs/PF-2.md`, inherited handoff commit `859949c` and earlier WIP checkpoint `f4d46ab5281ded40d0a0357c2f1cb1e23f5a5dc4`. This continuation records actual converted checks and the now-proven native licence blocker. Final human acceptance remains separate.

PF-1 has no user interface. Automated code/math checks use the normal build/test tools. The `computer-use` skill has been loaded and initialized for visual checks when an interface is available. No terminal is controlled through computer-use.

## Stages

| Stage | State | Next evidence |
|---|---|---|
| PF-0 | Technical PASS; inherited cleanup BLOCKED | Frozen receipts and local commit above |
| PF-1 | TECHNICAL_PASS | Extracted DLL; 105 original regression and 215 parity/boundary checks; source/environment preservation PASS |
| PF-2 | BLOCKED; partial implementation verified | Native host reports entitlement not found; full-precision reference and remaining graph/capacity work required |
| PF-3 | IMPLEMENTED; scoped technical verification PASS | 20 pure +10 actual SQL, refreshed HTTP13/13; actual protected capture/pick/save/reload; native gate unchanged |
| PF-4 | TECHNICAL_PASS at tested local scope | Admin/engineer deep links, protected capture/picking/shared resolution, final yellow/Ghost/onepoint/Clear verified |
| PF-5 | TECHNICAL_PASS at tested local scope | Automatic/durable jobs, staleness/designreuse, cancellation and actual extra-target crash recovery; fullplant throughput NOT_RUN |
| PF-6 | TECHNICAL_PASS for trusted synthetic fixture | Review/atomicApply/idempotency/history/install preservation tested; real engineering Apply blocked |
| PF-7 | Independent integration PASS; native parity BLOCKED | Final20live,34backend,71frontend,104runtime and stated regression receipts; exactsource/images bound |
| PF-8 | Local operational PASS; user acceptance NOT_RUN | Own5190, combinedbackup/restore/sessionfencing/realcrash/cleanup/finalpreservation PASS; crosscomputerrestore NOT_RUN |

## Inherited limitations

### Latest durable checkpoint — 18 October 2026, 02:28 UTC scope

- Integrated source/evidence is staged locally (119-file checkpoint plus later
  unstaged report/tool updates); no commit after `c95ad56` yet. Preserve all
  coordinated edits. Live branch remains `pf-4-viewer-local-20261018`.
- Current API image `sha256:6b226c434b4d23a456ed8add0c87edb105d0ace3a5ea4d982556d16e3dea64e3`;
  web `sha256:c2535ca007ec1ba2045e125bf35174e0d5a8a05032af35b10837ce409be38d4d`.
  Backend final actual **20/20** SQL/HTTP PASS, cleanup PASS; engine/registry
  **34/34**, legacy **40/40**. See `evidence/pf5/verification-final-20261018T022415Z.json`.
- Independent review found a project-FK lock inversion with mixed cable imports.
  PF project mutexes now use FOR NO KEY UPDATE; actual two-connection mixed
  import/user-assignment ordering controls passed in that20-case run.
- Scoped large-artifact proxy/prebody current-login authorization is implemented.
  Actual transport4controls PASS: admin204, unauth header-only11MiB401,
  oversize256MiB+1 header-only413, actual11MiB schema-invalid body reaches API400.
  `runtime/artifact-transport-1792290198792.json`. Nginx EOF-only formatting changed
  after that image copy; no semantic configuration difference.
- C# worker latest **38/38 PASS** at `evidence/pf3/model-runner-2026-10-18T02-26-42-960Z.json`.
  One-point zero-length native result is confirmed; last source build0warnings.
  Eleven pinned core sources remain unchanged.
- Frontend preceding overlay patch: TypeScript/ESLint PASS, runtime101/101,
  targeted frontend69/69. Actual new queued lookup/Reverse35.30345579516123m,
  four gaps/0.9840583861033791m and filled Ghost/Clear PASS at diagnostic scope.
  Yellow line is visually too weak/absent in the actual screenshot; Viewer owner
  is replacing thin WebGL line with bounded merged MeshBasic tubes along exact
  points, adding a one-point marker and related protocol/UI controls. Await its
  final tests/freeze, incremental candidate rebuild, and actual screenshot retry.
- Runtime owner is holding backup maintenance until the final visual window ends.
  Final combined backup/restore, positive copied Viewer cookie fencing and an
  actual dotnet-child crash/recovery test on an EXTRA restored target are prepared
  but NOT_RUN. Source5190 must remain retained; retire only verified extra target.
- Next: finish yellow/one-point patch → final visual checks (real lookup/Reverse,
  zero-ID synthetic Ghost/readability/review gate, one-point case) → local commit
  and PF-7/PF-8 branches/evidence → final own backup/drill/cleanup → final audit.
  Native parity, full-plant completeness/capacity and reusable graph remain open.
  No original update or publication. Do not end work merely at this checkpoint.

Frozen synthetic data does not prove real converted-model parity. Paired full-precision native/converted evidence is a substantive PF-2/PF-7 prerequisite. Investigate available authorized sources before treating that prerequisite as unavailable; do not fabricate evidence or loosen thresholds.

The PF-0 temporary child `.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c` was denied recursive removal with `blocked by policy`. It remains untouched. Do not retry or bypass that denial. New build outputs stay under the new engine directory and are not committed.

## PF-2 checkpoint — 18 October 2026, Europe/Kiev

- Actual UI checks now **PASS at capture scope** in an explicitly addressed in-app browser tab. The earlier Brave URL-confidence refusal remains a historical failed attempt; it was not retried. Copied model rendered 664,556 fragments; complete inventory has 438,155 unique objects. Both selected meshes normalized and passed the strict C# reader: 68/26 leaves, 257/99 fragments, 91,934/34,674 vertices. Full plant mesh is not captured.
- Strict normalization caught duplicate-root enumeration, nonfinite SDK translation and Float32 matrix loss. Corrected capture uses binary64 matrices and rejects nonfinite values. Failed captures are retained. Actual matrix/sample consistency is zero residual; independent native equivalence is still unproven.
- Fresh Model tests: **82/82 PASS**. Normalizer/comparator controls after independent depth review: **27/27 PASS**; both actual captures revalidated to byte-identical snapshots. ModelCheck CLI smoke: **9/9 PASS**. Two actual converted ordered lookups and memory/disk cache consistency **PASS at diagnostic scope**, with reported fallback geometry and `needs_review`. See `02-stage-report.md` and linked timestamped receipts for exact checked inputs.
- Final independent SDK enumeration review fixed support for nonindexed triangle meshes: **6/6 PASS** against the pinned SDK implementation and an actual indexed fragment. A fresh browser reload and capture exercised the final helper route; both final captures normalized successfully, with exactly unchanged geometry/identity/coordinates and new provenance hashes. The final screenshot and compact browser receipt are retained. Temporary browser/server are now closed/stopped; no port-5185 listener or native host remains.
- Actual lengths are 107.55007443085563m / 37.050260813690024m with explicit 1.0m diagnostic connection tolerance. They differ from the historical rounded 100.972m / 35.299m reports; this is unresolved, not an engineering or native parity PASS. Equipment From/To, project design allowances and SECONDARY design replacement were not evaluated by ordered lookup.
- Native Automation startup failed `0x80080005`. A separate documented direct CLI launch actually started Manage2027, then exited 2 before capture; its log reports **NOT Authorized / entitlement not found**. No licence/account/registry/installed-plugin changes or repeated identical attempts occurred. No owned native host remains. Only installed Manage2027 and Freedom2025 were found in the inspected standard application directories; no complete existing native export is available.
- `PathFinder.Model` caches fitted geometry; the endpoint-dependent graph is still built per calculation. Full graph preparation, complete geometry/category/visibility/source proof, real engineering tolerance, native parity and plant capacity are **not complete**. Do not advance to PF-3 or generate a success handoff.
- Changed files are confined to the new Model library/tests, diagnostic capture/normalizer/comparator/CLI/native-runner tools and `docs/pathfinder/`. The pinned Core and original regression sources remain unchanged. The local checkpoint commit following this update contains the complete file list and current evidence; `verify-isolation.mjs` records its checked source-set hashes separately from the pre-commit HEAD.
- Automation `pathfinder` was set to **PAUSED** through the application tool after the concrete external blocker. Resume only when an authorized full native reference is available or the user resolves the local entitlement and authorizes another capture. Retain existing code/copies/evidence and continue the first unmet PF-2 gate, not a duplicate PF-1/PF-2 implementation.
- The two denied cleanup children remain visible and untracked. No new removal attempt was made. New necessary build/cache/capture data is retained in ignored `pathfinder-engine/.scratch/`; no PF test containers were created.
- Final preservation audit **PASS**: `evidence/pf2/isolation-1792271766371.json` binds the actual engine source set to SHA256 `3b274e1e9ab562c9fd45009699ed23eff749849915732555066ebd6f53aff5a1`, preserves Core/native pins, frozen PF-0 material, all original checkout/dirty files and thirteen original container identities/images/start times. Final two recapture ModelCheck results exactly reproduce the prior valid outputs; see `model-actual-final-summary-20261017T2115Z.md`.

Next dependent step: obtain a complete full-precision native oracle for the same source, review identity pairs, investigate fitting/length differences, then complete the remaining PF-2 graph and capacity requirements. The runtime is intended to operate without Navisworks; this native dependency is for validation only.

## Resume protocol

Inspect current Git status and the stage reports before resuming. Finish the current stage, retain actual check results, review and commit locally, prepare the next durable handoff, then execute it. Never relabel historical checks as a new pass. On a real external blocker, continue independent authorized work and record the exact unresolved gate. Stop repeated unchanged attempts. Disable the automation after verified local delivery or when user input is indispensable.
