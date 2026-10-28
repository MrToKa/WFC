# Path Finder — selected calculation Review and Apply acceptance

Goal: verify that the completed calculation selected by the human owns the displayed proposal and review controls, then allow the human to review/apply selected non-MV proposals. Automated verification never supplies that acceptance.

## Baseline and observed defect

Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, inherited branch `pf-review-scope-consistency-local-20261020`, parent `e0eb4f8bf84dbfb388c6c10cb6f7b7be19867119`. Read live branch/HEAD/status and agents before work; the containing delivery commit follows this parent. Byte revision, checks and runtime are recorded in [report59](../59-selected-calculation-review.md) and its [actual receipt](../evidence/selected-calculation-review/actual.json). Reports56–58 remain historical at their revisions. Do not rerun accepted stages or PF-0 receipt writers for handoff preparation.

The user correctly selected manual scope2026-10-20T08:48:42.348Z. Its table was selected, but parent preview/recent shortcuts could remain from a newer running job. The correction pins admission/job identity, clears old scope display/review, filters shortcuts and checks exact returned proposal/job before showing a path. Do not explain a newer running proposal as if the human chose the wrong scope.

Read-only observations2026-10-20T15:55:12.985Z: selected old scope complete,230calculated/1578blocked, exact user's result current/compatible/canApplytrue; Aalborg0successful Review/0Apply. Two other queued/running jobs shared one engine. These counts are observations, not permanent current state. Old batch duration33m51.043s does not establish a new ETA or performance improvement.

Original WFC was cleanmain96e63f13 when inspected. This branch was93ahead/3behind cachedorigin/main before delivery commit; live remote and remote CI NOT_RUN for this local correction. No push, PR or merge. Do not infer remote acceptance.

## Runtime and boundaries

Only owned5191 is eligible: owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, compose project `wfc-pathfinder-local-0cba87606e9b`, runtime `pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`, Aalborg project `1af0f807-7653-40ea-8391-7eea6c54e7d4`. Read current resources/images from the validated runtime and actual receipt; root is sole runtime/SQL/HTTP executor. Do not restart API/worker or submit/cancel calculations just to inspect the UI.

Preserve current-role admin/auth, protected Viewer bridge, exact proposal/hash/dependency/cableWriteRevision/idempotency and pending-command recovery. MV remains excluded; Instrumentation follows Control. Project Details supplies S/E/P/gap. Keep From/To foreground, original materials, filled Ghost, yellow path and Clear. No direct NOP_VIEWER product API. No real Review/Apply on behalf of the human.

Original5180/old5190, original/canonical PathFinder and sources remain untouched. Primary Simplified Preparer integration and recurring PF automation remain PAUSED. No push/PR/merge/deployment or activation of background authority. Retain5191, model archives, backups, evidence and historically denied cleanup paths.

## Required next checks and stopping condition

1. If browser tool access becomes available, use normal computer-use without bypassing the saved refusal. No tool visual PASS is established by a replay. User-provided screenshots are user evidence only.
2. Reload5191 with Ctrl+F5. Select the completed manual scope at08:48:42.348Z (11:48local Europe/Kiev on20October). The explicit status must be complete.
3. Inspect a calculated row, then Open exact proposal in Viewer. Its route, From/To equipment and job must belong to that selection. Another running job must not replace it. Verify original colors/Ghost/clear; changing scope must invalidate the old individual review, including outstanding late responses.
4. Human individual flow: Confirm proposal review, then Apply reviewed result. Human batch flow: select current non-MV row checkboxes or Select ready cables on this page; use Review selected cables above the selector, Confirm review for selected cables, then Apply reviewed selection. Do not click these on actual data autonomously. Verify exact atomic routing+designLength update, installLength preservation, partial success/history and pending recovery.
5. If controls remain blocked, record selected admission/job, actual opened proposal/job and precise visible reason; use normal authorized bounded GETs to check those exact records. Do not assume cancellation or missing approval is the UI cause. Never manufacture canApply, review IDs, credentials or roles.

Stop technical acceptance when the delivered scope binding is verified and only human engineering Review/Apply remains. Report PASS/FAIL/BLOCKED/NOT_RUN at the actual revision; native parity and human acceptance remain NOT_RUN until proven.

## Separate performance follow-up

No performance improvement is claimed by this UI correction. The current oneshot worker serializes jobs, rebuilds category-specific graph work per cable, repeats snapshot/dependency/identity checks, and competes with full-state polling. Phase costs have not been measured. After preserving active work, a separately scoped stage should profile a bounded10–20request isolated replay, prevent redundant scope submissions, reduce full-state progress reads and qualify session/topology reuse against exact route/length outputs and all authority/fencing checks. Never silently change engine identity or mode under admitted current jobs. Preparing this follow-up does not resume the paused Preparer/PF automation.
