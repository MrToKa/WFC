# PF-B11 — keep saved obstacles visible after refresh

Execute immediately under the user's existing automatic-stage authorization.
The user prioritized PF-B10 cable search/list/click popup first; that technical
delivery is complete. This stage addresses their separately reported disappearing
saved walls/obstacles. Simplified Preparer remains queued after these PF repairs.

## Baseline and boundaries

Workspace C:/Users/todor.chankov/source/WFC-pathfinder-local. PF-B10 product
d4bec199deb18b430dc4b885f72255840c2d71e1 on
pf-b10-cable-workspace-availability-local-20261022 inherits b3f941b. Its receipt is
docs/pathfinder/evidence/cable-workspace/b10-delivery.json and report93.
Create a new inheriting local PF-B11 branch after committing the delivery record.
Foreign .pf0-work/.pf2-work are untracked; preserve them and every denied scratch
child/parent. No reset, original checkout changes, sources edits, push/PR/merge.

5191 runtime pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600,
owner8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46,
composewfc-pathfinder-local-0cba87606e9b; project1af0f807-7653-40ea-8391-7eea6c54e7d4,
modela613151e-c370-45c5-80f3-42ae58603b9a. API ac0d16ab1b0f4c92922c20d1a13a5ea142d4c6e92558de1870daf4db7fd60fcf
remains the same running container. Web now e40d07e7c7a5f9ef5e88c0765d9ec198d9ec96a8a262e03f9dd2bda2b6ad976c.
Do not reuse the old B10 install operation or its old-image baseline blindly.
Use a fresh exact-source web-only operation if this remains frontend-only.
Retain B10 verified web archive/private old pair and B9 full backup. No SQL/data,
API restart, real cable Apply or change to5180/5190. Root is sole actual executor;
agents have non-overlapping source ownership and preserve each other's edits.

At2026-10-21T23:26Z live origin/main (ls-remote) is
96e63f13fdc2b1d30b8f8ff658dd662f25fac104, matching cached main. GitHub connector
finds main and no PR for the B10 head; no CI or acceptance inferred. B10 product
169 commits ahead of cached main. Remote status is context, not authorization.

## Source-backed problem and implementation

Server barrierRegistryRepository.get() resolves currentScope then persisted
pf_barrier_heads and the checked immutable manifest. It returns saved parents
even for state=stale; list/getSnapshot are authorized current-frame-independent
reads. No storage/schema replacement is justified by the current source finding.
This is not actual proof of this user's saved row or captured civil geometry.

usePathfinderBarriers.refresh() currently clears draftParents for a stale frame;
the panel only displays that draft. A cold GET with CURRENT_FRAME_UNAVAILABLE
cannot reach the saved head. Separate saved display from current authoring:

1. Read current registry/manifest normally. Same-frame reload/remount restores
   saved parents from the server. Keep current editable draft distinct.
2. Display saved selected names, original snapshot scope and honest
   current/recapture-required/unavailable status even when draft is empty/stale.
   Never copy old dbIds/meshes into new captures or infer current readiness.
3. Where current-frame retrieval is unavailable, use at most one bounded
   existing snapshot-list request (limit1), then exact immutable manifest read
   with strict schema/project/reference/hash validation. This is historical
   display only. Registry/current admission must remain unavailable.
4. A failed refresh cannot leave a stale ready registry enabling calculation.
   Retain last verified names as unavailable within the same authorized owner;
   401/403 or project/login/model ownership loss clears them immediately. No
   history fallback after access refusal. Abort/late-response fences remain.
5. Label additions as unsaved until Save barrier set succeeds. Do not silently
   publish or declare empty. Retain exact uncertain command/key reconciliation;
   reads cannot settle a previous unknown write. Show persisted empty declaration
   honestly instead of resurrecting an older nonempty snapshot.

Likely source ownership: src/api/pathfinderBarriers.ts + tests;
src/pages/ProjectDetails/hooks/usePathfinderBarriers.ts + tests;
src/pages/ProjectDetails/PathFinderBarriersPanel.tsx + tests. Root owns docs/runtime
planner/driver and stage commits. Existing B10 compact cable UI must stay intact.

## Checks and completion

Test ready saved reload/remount and Viewer generation change; stale frame display
with no reused capture IDs; failed current read/history fallback; empty history,
explicit-empty, malformed/cross-project/reference/hash failures; no history after
401/403; owner loss/late reads; unsaved vs saved draft; pending exact command remains
unsettled. Run relevant hook/panel/API and B10 compact-list regression checks plus
typecheck/build. Root alone runs tests and runtime actions.

Any actual metadata diagnostic must be read-only, bounded and exact5191-owned,
output only counts/booleans/scope comparisons, no mesh/business rows/secrets inGit.
Actual5191 browser refusal remains BLOCKED: no retry/alternate-browser/native/origin
bypass. Public operational health/index/assets can verify static delivery only.
Civil geometry/openings/Aalborg engineering acceptance remain BLOCKED/NOT_RUN.

Complete with source review, exact test results/revision and web-only delivery
receipt (or precise failure), updated automation-progress/report/local commits.
Separate technically implemented/verified from user acceptance. Apply
prepare-stage-handoff for the first unfinished Simplified Preparer step using
its current worktree evidence, then continue immediately. No duplicate seed,
old Autodesk upload or test/backup operation. Preserve known failed attempts.
