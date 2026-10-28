# Continue the current full-network recovery proof

**BLOCKED on Windows memory. This is the unfinished recovery stage, not a new PF
feature or a completed delivery.** User-authorized non-MV calculation is already
verified; preserve it. Resume dependent runtime work only after fresh headroom
passes. Do not repeatedly poll unchanged conditions or lower the guard.

## Baseline and boundaries

Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
`pf-aalborg-current-full-recovery-local-20261020`. Operator source checkpoint
`7c0c673fd1a6aa442c4989c816d760f2626797b6`; later documentation commits may descend
from it. Read live status/HEAD, agents, automation-progress and report55 first.
Preserve `.pf0-work/`, `.pf2-work/`, all denied children/parents and other changes.

Read-only Git inspection20Oct2026: original WFC cleanmain96e63f13fdc2b1d30b8f8ff658dd662f25fac104;
canonical PathFinder cleanmaster45c24bf5f433f13e102600b36f20327c77961d0a;
old PathFinder master35f4fb46f7762503576bdacd9668f34a1be2b0ed with preserved
AddinRibbon.csproj/ClAddin.cs/.vscode changes. Each reference checkout cached0/0.
GitHub connector independently resolved WFCmain96e63f13 and PFmaster45c24bf5;
no remote branch or PR matched this local recovery branch. At7c0c673 the isolated
branch had no upstream and was88ahead/3behind cachedorigin/main. No remote CI
acceptance or engineering acceptance is asserted. No pull/fetch/merge/push needed.

Only allowed source is5191 owner8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46,
compose projectwfc-pathfinder-local-0cba87606e9b, runtime
`pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`, DBepoch
69f3bee1-298b-48d1-8af9-3ecbea23d975. APIimage
sha256:9387454711b7761c7434ee25f45ad4123435c7ce4fe87cb44c97f89ba1370fcd,
websha256:0e1e8823ffa72fae8e5b00d2407254ea25e2e134237e522af1cf89b9f152c80d.
Source5191 is itself a restore: deny its owner/path/project/port in retirement.
Originals,5190,sources/,original containers/storage/data remain untouched. No
publication, PR, merge, deployment or real Apply. Root is sole runtime/SQL/HTTP/UI
executor; agents author/review disjoint files and perform no actual operations.

Private directory (all raw business/auth evidence stays ignored):
`pathfinder-engine/.scratch/tray-catalog-b3c21429-ed9c-4491-bbea-3daf3df38c42`.
Current qualified binding is `full-recovery1-source-resumed2.private.json`, tied
to `full-recovery1-source-reconciled2.private.json`. Verify actual resource start
times against it; never overwrite old bindings or assume an external restart.

## What is verified and what failed

- Non-MV joba29cd4c2-2d86-4ee0-9cbb-5bc598552781 COMPLETE1808: LV257,
  Control345, Instrumentation1206;230calculated/1578locations_required;332MV
  excluded. No product-wide category/permission change. Mixed job cancelled;
  all-category policy remainsPAUSEDcontrol7, grantdisabled, priorauthorityexpired.
  Never resumeall2140 or silently renew authority. All230 saved v6 ledgers were
  previously verified against DetailsS7/E5/P10/gap1; no recalculation in this stage.
- Final normal source state/job/policy/grant reads PASS and cable-fence8 at
 11:29:13UTC:2140all-columnSHA
 0cc900778484ca50a770c30a3566564c5975c5649885793aed8b8e8e426f9155,
 0Apply. Evidence `evidence/aalborg-full-recovery/source-final1.json`.
- Actual330trays/2965objects/1165segments,5parts114,186,790B, artifact04782773,
  aggregate6e21b230 and trace3976df4c remain. No recapture/retrace/import/seed/APS
  upload/native entitlement retry. User chose converted comparison/manual review.
- Root readonly SQL discovery:126tables/44,395rows/124,663,397textbytes,
  pinned body371e2826c52c4135750b9bb14ed56da9acbe0e6c5d0f36ae6181b8e65639a92c.
- Generic bounded Docker source6e37 passed182controls. Source7c0c673 adds exact
  opt-in RO artifact inventory DAC_OVERRIDE, fail-fast audit and readonly1MiB
  tmpfs shadows for declared PostgreSQL image VOLUMEs. Root pinned8files before
  source3:232/232PASS/0fail/cancel/skip, scopedlint and independentreviewPASS.
- Actual source controls3 PASS:372PFfiles736,625,033B SHA
  c054b1995af3ea2e7b6fd3bef1bb98110db971436428391de61fa9d72a3fcac1;
  mounted-file TOC84,447B, all helpers removed/no new anonymous volume/source exact.
- Backup1FAIL model audit before cold dump. Actual resource capacity control
  proved233,991,168B fails128MiBtmp withSTORAGE_EXHAUSTED and passes512MiBtmp;
  complete512MiBaudit passed5versions/1541resources/1,930,801,055B. Source resumed.
- Backup2FAIL finalPF_BACKUP_INVALID:8payloads were written but PF artifact audit
  wasFAIL/EACCES. Never call this a verified archive or repair its manifest in
  place. Its wrapper recoveryUNCONFIRMED/ERR_ASSERTION is retained. Subsequent
  readonly reconciliation positively proved source health/admin200, all5 full
  static pins and unchanged PG lifecycle. Eight inspections demonstrated the
  identical two full API Mounts records may reverse order (7original/1reversed).
- Private observer nowSHA84bda1313a7991b9bac0f0b0f7418d97cda4b4e5742832e7d4905c41045db3a4;
  future complete Config/HostConfig/Mounts canonical pins and exact SHA-qualified
  resumed2 guard independently reviewed. Historical failures remain unchanged.
- First actual probe failures (omittedfalse/Windows path normalization) retained;
  finalprobe3 passed6helpers/two fresh volumes/content+POSIXns and removed all.
- Historical whole-outside guard afterbackup2 FAIL on one new anonymous volume
 5a66c738b3617193af425e6532dd6fee7e46c80d6a0c74d00855ce7ffa3b210e.
  Docker reports1B/refcount0; event history was unavailable. Ownership remains
  UNCONFIRMED: retain it, no delete/prune. Later fresh bookends preserve18outside
  containers/28volumes/14networks exactly. Do not erase the earlier failure.

## Exact blocker and next runtime work

Fresh profile4 and5 both BLOCKED only on Windows physical memory. Profile5 at
11:25UTC observed2,686,881,792B free versus required3GiB (virtual4,353,859,584B;
LinuxVM12,703,526,912B available is a separate overlapping view, never summed).
Ordinary unload and replacement of the agent test page did not resolve this;
later readonly host check11:27:32UTC observed2,463,027,200B. No processes outside
our test page or original containers were stopped. No backup3 or5192restore ran.
Preserve the original application while the user frees host memory.

1. After a meaningful memory/environment change, fresh-qualify at least3GiB
   Windows physical/2GiB virtual,4GiB Linux VM available, host AND Docker-volume
   disk headroom, free5192, sourcehealth, zerojobs/imports/leases/validation,
   no managed host/helper and safe journals. Preserve all numeric controls.
2. Use root-owned `full-recovery1-make-profile.mjs` with a fresh number6+;
   labels4/5 are immutable blocked attempts. It currently pins resumed2 and all
   actual schema/resource/provenance facts. Syntax-check and pin current scripts.
   If external lifecycle differs, positively reconcile a new binding first;
   never bypass start/config checks or pretend old preflight is fresh.
3. Fresh outside bookends need a NEW label (outside-backup3-before already exists
   from the blocked preparation). Run explicit backup driver with fresh profile
   SHA and new `full-recovery1-backup3` label, within60s of preflight. Keep2GiB
   memory/1CPU/128pids/helper120s/request30s/512MiBtmp and measured archive cap.
   Verify8members/four actual images,126cold SQL-text tables, all PF bytes,
   same source running state and separate private host/producer companion.
   Do not update app images: the fixes are host operator tooling only.
4. Only after actual backupPASS: `full-recovery1-restore.mjs` to a NEW exact-owned
   `full-recovery1-target-current1` on5192. Supply explicit profile/backup-result
   SHAs; no default drill/5190. Preserve all126SQL-text table rows before fence;
   qualify only two auth groups/three documented tables, epoch/JWT rotation,
   unchanged lease rows and seven blank producer variables. No authority restart.
5. Execute frozen `full-recovery1-target-readback.mjs` SHA
   6b302a2d0a2578b1b8f93eab7cafe08c9c30aba3b7651eb3d68440e684118759
   using existing tsx loader and explicit restore-result/SHA/newlabel. It uses
   normal target login/protected sessions, current model/network/job and all230
   normal proposal GETs with production ledger validation and pinned actual
   baseline. Maximum300requests/600s/8MiBresponse/256MiBtotal; no automatic retry
   of unknown login/session outcomes. Private auth is never printed/committed.
6. Computer-use in a NEW temporary5192tab: normal login, actual model, non-MV
   proposal, filledGhost/originalcolors/yellowline/Clear. No NOP_VIEWER product
   bypass, calculation, mappings, review or Apply. Close only this target tab;
   source5191 browser deliverable remains. Record actual UI evidence separately.
7. Collect post-UI SQL equality for every non-auth table, exact cable/job/proposal/
   Apply/lease/epoch rows; observe the two normal auth groups separately. Supply
   the retire driver's14-check qualification ONLY from actual pinned PASS proof.
   Retire ONLY this positively qualified5192fixture, then prove no target resources
   or listener and source/outside preservation. Keep source5191/archive/private
   companions/evidence; no globalprune/denied paths/unqualified1Bvolume deletion.

Record failures honestly and preserve exact receipts. Local commits only. Full
recovery remains BLOCKED/NOT_RUN until the actual gates pass. After that, only
human1042missing/48ambiguous shared locations (1578nonMVblocked cables), review
of230 proposals and17unresolved cross-revision mappings remain. Do not invent
those decisions or engineering acceptance. Pause recurring automation when no
independent authorized work remains; re-enable only after a real resume condition.
