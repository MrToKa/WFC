# Review the proposal from the selected calculation

Date: 2026-10-20. Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-review-scope-consistency-local-20261020`, parent
`e0eb4f8bf84dbfb388c6c10cb6f7b7be19867119`. Read live HEAD for the delivery commit.

## Diagnosis and correction

The user correctly selected the completed manual calculation created at
2026-10-20T08:48:42.348Z. The selector previously owned only the paged revision
table. The independently opened proposal and recent global proposal shortcuts
could still belong to a newer running job. Thus a completed selection and an
incomplete-proposal warning could coexist. This was a UI ownership defect;
the user's selection was not the problem.

The child now reports the exact admission/job identity and current completion
readiness to the parent. Changing that identity aborts outstanding proposal and
endpoint reads, invalidates individual review/display state, and restores an
owned old path. Recent shortcuts are restricted to that job. Paged opening
checks the sealed admission/job, carries the expected job ID, and the parent
checks the returned proposal ID/job before display. Opening again carries the
same identity. Polling the same selection does not retarget it. Pending Apply
reconciliation retains its original account/project command across selections.
The selected calculation timestamp and status are explicit.

No server, C# core, dependency/permission rules, engine mode/identity, calculation
inputs, original colors, filled Ghost, endpoint foreground, yellow line, or
installLength behavior changes. Review and Apply remain explicit; neither is
performed on real data by this delivery.

## Actual read-only findings and performance limits

At 2026-10-20T15:55:12.985Z, normal authenticated GET and read-only SQL verified
the exact completed scope and the user's cable result. The result was current,
compatible and `canApply=true`. The Aalborg project had zero review records and
zero Apply receipts. Its whole calculation finished at 09:22:33.391Z, taking
33m51.043s: 230 calculated cables and 1578 blocked inputs, not 1808 path searches.

Two other jobs were still queued/running: 81 calculated with149 waiting in the
new non-MV scope, and190 calculated with40 unfinished in the older2140 scope.
They share one engine lane and can repeat the same eligible cables. The runtime
uses `oneshot`; each eligible cable incurs process/snapshot preparation, a new
category-filtered routing graph/shortest-path calculation, dependency checks and
sealed result persistence. Frequent full-state polling also shares the project
transaction mutex. These are source-backed sources of work; phase timings were
not measured, so their individual contribution is unknown. The observed completed
batch averaged8.83s per calculable cable including overall overhead. No stable
ETA or speed improvement is claimed.

Two newer2140 jobs had failed with the recorded request-context/authority error,
not a proven shortest-path failure. This delivery did not submit, cancel, restart
or repair those jobs. Performance optimization is a separate versioned change;
changing the loaded worker/core now could invalidate existing calculations.

## Verification

Final targeted Results20, RevisionResults18 and revision hook18: **56/56PASS**.
A private replay of the actual normal GET admission/result/proposal, using both
production components and the real paging hook, passed **1/1**: newer jobs remain
present, the correct saved path opens, and individual and batch Apply controls
enable only after explicit stubbed Review. All transport in that replay was
stubbed; live Review/Apply calls:0. Affected full-Tab integration passed8/8;
49other Tab cases were not completed in this delivery. Total65distinct targeted
tests PASS. Frontend/backend typecheck, scoped lint and diff check PASS.
No live computer-use verification is claimed: the saved browser
tool refusal is unchanged and was not bypassed. User screenshots are user evidence.

The initial broad diagnostic timed out because its single-client pool query
waited for its own checked-out client. The corrected bounded read-only diagnostic
passed. Its earlier root-created helper was identified by the exact program
SHA256 in the owned API container and terminated; API/engine processes were
excluded. The initial typecheck found the missing job argument on Open path again;
it was corrected and the final typecheck passed. The broad57-case Tab attempt
was interrupted without results. A bounded first8-case run had6PASS/2FAIL because
legacy assertions expected disabled controls after scope invalidation; those
test-only assertions now require removed controls and no Apply transport. The
same8-case rerun passed8/8. These failures are not relabelled as passes.

WEB build PASS16:08:10.357Z with1280consumed inputs/94,473,363bytes and matching
before/after closure SHA256
`8cae1e3894cbfa0c5bed3fb8610db1b5409248aeed264d1535053b771746223e`.
WEB-only upgrade PASS16:11:37.219Z; web image
`sha256:4bd4bda6b99e35e03d1cbcbdca80d17db9a66e871fb9e94825c16b93702d333a`.
API remains
`sha256:78536ccdf8050ccd732f383d09da56456e3fc9b10d9312568238577eea976f9c`.
API/PostgreSQL/MinIO IDs/start times, engine identity, volumes and networks stayed
exact. All2153database cable rows and2preexisting database Apply receipts stayed
exact. One active job remained before/after web replacement; natural job progress
was allowed. Outside container configuration stayed exact; an original backend
restart-loop start-time transition was observed, with no agent control of it.

A fresh concurrent consistent DB backup preceded web replacement:20,064,233bytes,
SHA256 `853c5b3cb6fd5995fafbbcc99c57a76886bedbe5f525e8cba34f00fbc3d866d1`.
Mounted TOC verification passed84,447bytes. This is not a new restore drill.
Final readback PASS16:11:57.967Z: health200, exact owned resources,0temporary helper
containers, dump bytes/hash and final production bytes match the frozen build.
The exact user's completed proposal remained current and canApplytrue on a final
normal authenticated GET. [Actual receipt](evidence/selected-calculation-review/actual.json)
contains sanitized verification; all business rows remain private.

Private data and receipts remain under owned ignored
`pathfinder-engine/.scratch/tray-catalog-f31630bd-db55-4105-8cad-f1be475f2f10`
and the explicitly referenced earlier diagnostic work directory. Keep backups,
models, the5191 demonstration and historically denied paths. No original5180/
5190 control, push, PR, merge or deployment. Preparer integration and recurring
PF automation remain PAUSED. Technical verification does not establish human
engineering acceptance.

## Using the delivered controls

Reload5191 with Ctrl+F5. In Path, choose the completed manual calculation at
08:48:42.348Z (11:48 local Europe/Kiev on this date). Use a row's Inspect and
Open exact proposal in Viewer for individual Confirm proposal review, followed
by Apply reviewed result. For a batch, select ready row checkboxes or Select
ready cables on this page; the Review selected cables toolbar above the selector
offers Confirm review for selected cables and then Apply reviewed selection.
The batch excludes MV and preserves all server currentness/revision checks.
