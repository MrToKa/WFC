# Simplified Preparer implementation progress

## Current — SP-0–SP-7 technically delivered, 24 October 2026

SP7 COMPLETE within accepted no-new-real-conversion scope. All5 live services
running; API/web/Preparer healthy, primarygateway unauth401, PreparerSessionfalse,
jobs401/wrongHost403. Exact primaryPreparer restart PASS: same image/stores,
no admittedjobs,0APSenvkeys/0operator cloud/import. PG only restartpolicy no→
unless-stopped changed afterward with samePID/start/config/mounts; no DB writes
or process restart. Current private runtimecompanion retained. Fullhost/Docker
restartNOT_RUN. Actual IAB primarysigninpagesPASS; user's own login remainshuman.

Reports12daily-use/13operations/14acceptance finalized. Requiredbackup/rollback/
candidateimages retained; all testfixtures removed,6,426,951,237 duplicatebytes
freed. Main source remainsclean96e63f13; PF/remote unchanged. Product543ae7a,
latestoperations+docs on inherited SP7branch. Dedicatedheartbeat is tobePAUSED
at technicalend. No further autonomous real conversion or deployment work.

Live product543ae7a delivered on5180/5193 in0f257b41. Primary/API/Preparer healthy;
HTTPhealth200, unauthsessionfalse/jobs401/wrongHost403. Root independent qualified
rollforward PASS after exact equivalent User=''→root normalization; automatic
attempt FAIL retained. Originals stopped/renamed/disconnected as rollback; PG/
MinIO unchanged at qualification, PF untouched. Report11 has native failures and
honest scope. Updated future operator45controlsPASS. Current rootplan pointer
.preparer-work/sp6-current-plan.private.json, no live execution cell remains.

Fresh upgrade730f1a8f PASS exact olddata/schema/global/cluster, declared empty
archive additions, oldimage rollback, all8resources removed+lockreleased. Exact
candidate offlineimage exports3dd1681e PASS. All SP5/restore fixtures removed.
Next SP7 dailyinstructions, startup-readiness policy check, final health/store/
browser scope, local commit and disable dedicated heartbeat. No real conversion.

SP5 COMPLETE/PASS: three-store snapshot/restore0cca87ba, old-cookie fenced/fresh
admin/history/ZIP proof PASS,0APS.14 store controls PASS. Restoredclone+3volumes
and originalfixturec40+7volumes/2networks fully removed, archives/evidence kept.
Qualification publicevidence/sp5-integration-qualification-20261024.json; private
gate underc40. SP6 handoff prepared. Failed553411f6 upgrade cleaned/reconciled,
expectedTEMP aliasfix15controls+retainedrawreplayPASS; freshfullclone pending.
Deployment39controlsPASS, no actualmaincandidateupdate. See report10 forlimits.

Clone-only old-data compatibility/rollback prerequisite ACTIVE under root exec17927,
new operation path in .preparer-work/sp6-current-upgrade.private.json.14 upgrade
controls PASS; frozen operator4cfbc75/source13e5029c. No source runtime connection
or production deployment. Do not duplicate the active clone operation/tests.

SP5 fixturec40c725a ACTIVE/healthy, root sole executor. Actual IAB browser PASS:
WFC login→separate Preparer tab→empty keys→synthetic check→existing tiny converted
fixture packaging→WFC model listed→ZIP download. HTTP proof PASS: browser/Preparer/
WFC ZIPs identical2524bytes; same keys/two admins foreign ZIP+resume404, crossed
lease401. Closure and actual same-container restart PASS: empty APS fields,
completed ZIP/history retained, old lease401, zero startup APS requests. Second
admin browser has empty keys and zero private history; all test tabs closed.
No actual Autodesk request/new conversion; fake transport only, no network fallback.
Fresh PG fixture attempts0660/c98 failed initialization socket setup, fully owned
cleanup PASS; exact entrypoint read proved it clears PGHOST, so bounded writable
default socket tmpfs fixed source. Current fixture controls18/18 PASS. Immediate
postrestart probe without readiness failed; corrected ready-bound probe PASS,
initial failure retained. Snapshot+fresh restored Preparer store proof is pending
agent source; SP6 upgrade-preflight and deployment source remain independent.

SP2–SP4 source verification closed sequentially on inherited branches2670147 /
d3a7332 and SP4 report commit. Exact116 source/TAP bookends PASS; no unrelated
full reruns. Reports07/08/09 and handoffs SP2–SP5 retain current scope and limits.
SP5 actual fixture start waits for source-only create/inspect ledger fix plus
root tests. SP6 source-only upgrade-preflight proceeds independently against the
retained cold archive. Main5180 remains healthy; no candidate update yet.

SP-1 scope PASS at source29664ee plus this report: cold seed ea23121d and
audited recovery acac2c9c PASS; all-public rows/catalog/global metadata and
read-only model integrity verified in owned clones, cleanup PASS. Target DB
logical restore retained original cluster role context; this is not a fresh
initdb full-cluster logical recovery. Legacy model_package_archives is absent;
no historical ZIP evidence is invented. Cold/recovery releasableBackup=false and
applicationStartup=NOT_RUN remain unchanged; admission was scoped to health repair.

Primary5180 health repair950fa345 PASS at2026-10-24T05:20:19Z: started unchanged
original PG, then restarted unchanged frontend to clear a stale external API DNS
resolution. API/web healthy; /health and / HTTP200. Config/images/mounts/network
membership names unchanged; all non-target resource identities/states unchanged.
The stopped PG's obsolete daemon bridge ID was rebound by Docker to the verified
current default bridge. Initial wrong /api/health probe and strict-ID FAIL are
retained with separate explicit reconciliation, not rewritten. PF5191 untouched.

Current source product candidate543ae7a has Linux Preparer329/329 PASS, package
174/174 PASS, WFC focused54/54 PASS and typecheck PASS. Candidate APIec6fc3cf,
weba9226e28 and Preparer3e815754 images are built, NOT deployed. Isolated image
smoke PASS: USERnode, healthy, correct Host/session rules, jobs401, wrongHost403,
zero APS environment keys; all smoke resources removed. Duplicate failed restore
archives retired only after equality/ownership/cleanup proof:4,432,123,658 bytes.

Main source clean96e63f13; remote main same SHA freshly read2026-10-24T05:19Z.
PF merge still pending. SP5 fixture14/14 pure controls PASS; actual fixture/browser
and candidate old-data migration/image rollback gates NOT_RUN. Root owns runtime/
tests; agentB owns NEW upgrade-preflight sources, agentC reviews SP5 sources only.
No real new model conversion or APS upload/translation. Next execute SP-2–SP-4
verification handoffs, then isolated synthetic browser and SP6 upgrade proof.

## Historical SP-1 progress (superseded current state above)

Cold seed ea23121d is PASS with confirmed source-lock release; full PG/MinIO/
staging archives and five exact images verified, source API/web/MinIO resumed
to prior states, original PG remains stopped. This alone is not restore PASS.
Owned audited recovery d1994f0a-8ae1-47a9-bcc8-153c1ff31ed3 is ACTIVE under
root exec50938. Earlier289c462e refused before resource creation because the
guard wrongly rejected verified PGDATA GID0; explicit reconciliation confirmed
no resources/source change, exact archived lock retained, focused23controlsPASS.
Do not duplicate runtime recovery or alter the frozen cold-source closure.

Final candidate Preparer Linux329/329PASS,190225ms, no skips/cancellations;
all116 source/runtime-package file hashes unchanged across the run. Evidence
transient-full-linux-20261024.json. This includes logout-during-outage repair.
WFC gateway/API/auth/UI54/54PASS; typechecksPASS; packageLinux174/174PASS.
Pure audited-recovery+model-audit41PASS before the GID fix; model audit20PASS,
recovery23PASS after it; delivery materializer18PASS. Real browser and new-model
Generate are NOT_RUN (new conversion explicitly prohibited).
Build preparation excludes all .preparer-work private data from Docker contexts
and corrects Preparer healthchecks to use native HTTP with its exact public Host.
No main repair/update yet. Next: finish clone proof, then repair5180 and execute
the succeeding security/integration/delivery handoffs without routine approval.

Latest checkpoint fb2653d; cold capture ea23121d-28b1-4ba8-812b-7b3c6fbbf871
is active under root exec session53054. Do not duplicate backup/Docker/test work.
Exact helper a0eca379 uses Node24.22/GNUtouch and dedicated PG18 root format.
Earlier attempts3b030d74/8588a09f/cd5269fb failed before source stop/export;
explicit private reconciliation proved source/outside identities+active states
unchanged and archived exact locks. No automatic replay. Main PG still stopped.
RootLinuxPreparer328/328PASS and current-package174/174PASS (no skip/cancel);
WFC typecheckPASS. Focused Windows87/86PASS1Host-fixtureFAIL, corrected native
Host test1PASS; WFC54/53PASS1ResizeObserverfixtureFAIL corrected page5PASS.
See05-transient-credentials-progress.md for exact scope and retained failures.
Current source-only pending: logout during WFC outage repair; clone model/ZIP
read-only auditor and recovery integration; final candidate verification. No real
conversion or main repair/deployment. No new Docker helper while source capture
bookends are active. All prior synthetic test helpers exited/removed normally.

Source branch sp-1-main-backup-local-20261024 inherits a3461c69ca85b8e8f0a9ed9d1cb142d4b17b2a75.
SP-0 scoped decision accepts the retained QUALIFIED_PLATFORM_COVERAGE for
continuation; strict full summary remains FAIL, never relabelled. Current
candidate full Linux checks remain NOT_RUN. Main5180 repair/backup/update NOT_RUN.
Main PG is stopped, API restarting on refused5434 and web unhealthy. Original
PG must remain stopped until its cold physical seed is captured and recovered
in new owned clones. PF5191 and original main source remain unchanged.

Latest human requirements supersede old persistent APS settings: current admins
only; two empty per-page key fields, memory-only lease, no product .env fallback;
.env permitted for tests; NO NEW MODEL CONVERSION, including startup/recovery.
Automatic sequential execution is active through the dedicated Preparer heartbeat.
Main PF merge is still pending; recheck actual main before final delivery build.

Root owns docs/backup/runtime/all actual tests. Source-only parallel ownership:
security agent workspace-security/page-credentials and tests; service agent
workspace-service/aps-provider and tests; UI agent workspace files and VM tests.
All agents preserve concurrent edits; none executes runtime/cloud/tests.
Independent source preparation does not waive SP-1's recoverable-backup gate.
Next: cold seed using fresh exact identities, clone recovery/logical restore,
then main health repair and staged security/integration verification. No new
conversion or APS submit is authorized. Historical progress below is retained.

## SP-0 retained baseline evidence

Qualified platform coverage recorded at clean source00832078098f21d5e6e2b780c4c0d03bc3506086.
Fresh Windows full run d61022c2-9471-40b8-a2ba-ed25a95aa4c4 finished
2026-10-22T01:51:45.003Z: guard18/package174 PASS; Preparer286/281 PASS/0 FAIL/
5 Linux SKIP/0 cancelled/0 todo. All parents, workers and children joined, ports
closed, no killed worker, source/copy bookends unchanged. Strict full summary
and Preparer suite remain FAIL because terminalPass still requires zero skips
and tests===pass. No gate or timeout changed.
Separate Linux operation eab7c528-2c6b-43ee-93de-042050041e07 attempt2 passed
exactly the five store-linux lease checks under Node24.22.0, no skips, joined,
owned helper removed, source/copy pins PASS and matching Windows source hashes.
Its first default-reporter attempt remains FAIL for missing terminal TAP proof;
attempt2 explicitly selected TAP. This is Windows281 plus exact Linux5 qualified
coverage, not a full Linux package/Preparer run or a rewritten full-run PASS.
Report04 and new evidence/sp0-platform-matrix.json preserve the distinction.
SP-0 remains INCOMPLETE under the strict full gate pending an explicit scoped
stage decision; actual main5180 offline backup/restore/update and APS remain NOT_RUN.
The paragraphs below are retained historical progress, including earlier failures.

TargetedOSpinrepairafterfb9failure verifiedroot: guarda40f2200 PASS18/48expected
denials; ops47b1dd39 SUBSET_PASS14/guard18PASS/0skip. Allworker+childjoins,ports,
source+copypinsPASS; no killedworker. ExactSystem32PSpinnedpositiveoriginalnlink/
dev/inode/size/hash; genericprivateinputnlink1 andfixed4ACLargs/stdin unchanged.
IndependentreviewCLEAR. Report04/publicos-pinreceipt recordpartialscope; full
correctedWindows/LinuxmatrixNOT_RUN, SP0stillINCOMPLETE/main5180 untouched.

FreshFULLsidecarbaselinefb9ede8f-8517-4406-a5f1-c9a4535ae52d finishedFAIL at
2026-10-22T00:57:18.977Z, noactualprocessremains. Guard17/package174PASS; Preparer
286tests/280PASS/1FAIL/5LinuxplatformSKIP/0cancelled,359920ms. WindowsACLtest185
refusedBASELINE_CONTROL_PATH beforelaunch; parentjoined/portsclosed/source+copy
unchangedtrue, butworkersJoinedfalse. Fullbaseline remainsINCOMPLETE, notSP0PASS.
Sidecardiagnosticsavailable fornextfocuseddiagnosis; no unchangedblindretry or
testtimeoutincrease. Earlierworkspace998abcb5 SUBSET_PASS5/5/66.4s retained,
normalworker+childjoins/ports/pinsPASS; observationonly doesnotproveproductfix.
Offline-seedfinalizationunits19PASS are fakeDockercontrolsonly, noactualbackup.
PF-B13aserverplanning410f2da complete; PF-B13bstagingfoundation nowactivepriority.
No originalmain5180/PG/APS mutation or backup yet.

PFuserpriorityresumed for actualbarrierextractionfailure; PF-B12diagnosticweb
delivery22114f4/web814475f9 complete, PF-B13a puremultipartplanning underway.
Preparer independent rootcontrols:19offline-seedunitPASS(injectedfakeDockeronly),
freshguard67f21571 PASS15/expected48denials/worker+childjoins/portsclosed/hashesexact.
Freshworkspace858859f1-d0f9-4d60-a8a0-26a851354567 diagnosticFAIL at339984ms,
5tests/3pass/2cancelled120s; test4PASS90s. Parentjoined,portsclosed/source+copy
unchangedreported; workerexitreportmissing/childrenJoinedfalse. Reported0denials
is incompleteworkerobservability, not proofofzero workerdenials. No actualprocess
stillrunning inrootexec. EarlierfullbaselineFAIL remains. Publicdiagnosticreceipt
sp0-workspace-diagnostic-858859f1.json. Aowns5harnessfiles forboundedobservation-only
sidecars; terminalworker/joins/ports/PASS requirements remainstrict. Rootsoleactual
executor; no source/main5180/PF5191/APS runtime mutation. No unchangedblindretry.

Resumed from PF-B11 delivery77bbcf8/web75187b0a (recorda85b051). Source checkpoint
31d8ce702d4d1d4d07a218f253e161d2abeb2716 explicitly preserves INCOMPLETE baseline/
backup source. Executing PFhandoff SP-0-baseline-diagnostics.md. C owns five
baselineharness files for exact-file subset and bounded safe stage/denial evidence;
B independent review. A owns offline-seed finalization repair after independent
finding of source-lock release before terminal marker; root docs/actualchecks.
Main5180 and PG untouched; no actualbackup/import/cloud call. Root actual later
OS check:0ownedNodeprocesses and0listeners on retainedmarker56078; old marker
kept. This does not change the failed baseline. Report03/publicreceipt retain scope.

Root fresh baseline296f8fde-146c-41f9-8472-45f341973c7a: guard9PASS/package174PASS;
Preparer FAIL/incomplete at480s supervisor deadline, killed/joined/killerJoined=true,
no terminal TAP totals,49/50 timed out120s, earlier36READ_LIMIT. Port marker from
intentionally killed fixture remains evidence, not proof of live listener; no
historical marker silently deleted. Exact denied call sites/stage timings absent;
no claim of permanent deadlock. Source+copy pins and detailed failure retained.
Strict supervisor totals controls4PASS, independent review clear; new totals require
zero skip/todo and positive equal tests/pass. Original invalid provenance path and
numeric-loopback guard failures retained. No unchanged rerun until focused diagnostic.
PF-B10 and PF-B11 action/persistence repairs are technically delivered. Main5180
remains unmodified; independent Preparer diagnosis resumed after PF delivery.
Do not infer SP-0 complete from packagePASS.

Target mainWFC5180 explicitly selected by user; PF5191 separate/preserved.
Branch sp-0-preparer-baseline-local-20261022, baseline96e63f13; local checkpoint
21694d6 preserves17trackedchanges + supplied package, plan and119private source
copies before edits. Package ZIP hash rechecked8b9f5c9d matches. No main runtime
modification or DB/model backup yet.
Historical package173/174FAIL from lost execFile promisify contract; partial
Preparer17CANCELLED by pause. Both retained; fresh checks pending.
Root only actual executor. AgentB owns seven test import corrections and new
scripts/preparer-baseline supervisor/preload; C independent review. AgentA owns
new scripts/preparer-main/offline-seed.mjs/tests (source only); root provided four
verbatim generic foundations with provenance. Contracts01/02 are source design,
not executed gates. No actual test/build/SQL/HTTP mutation by agents.
Read-only main discovery22:40Z: exact5180 API restarting/frontend unhealthy because
configured host:5434/wfc_app PG is stopped. Minio running. Full private identities
in .preparer-work/sp1-discovery-450ef72a-ee83-4cf7-99c7-648811c3a8b6. First capture
offline physical PG seed; recover only NEW owned clone, do not start original PG
for backup. Next guarded serial package+Preparer baseline, SP-0 report/commit and
SP-1 handoff/execution. Source preparation for later stages does not waive backup
gate. See00-plan.md for SP-0–SP-7 scope. No shared/global APS credential use.
