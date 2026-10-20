# Path Finder — verify proposal preview and selected batch acceptance

Status: technical delivery verified; live browser verification BLOCKED and real
engineering acceptance AWAITING_HUMAN_INPUT. This is not a new full implementation
stage or permission to rerun completed PF stages.

## Goal and baseline

Verify the reported slow/disappearing proposal preview in the actual browser,
then let the human review and explicitly apply selected non-MV proposals through
the new batch controls. Do not treat automated tests as live visual acceptance.

Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-review-discoverability-local-20261020`, parent
`26be0e789e279a893da34a9e0d74d646e4e7ed5c`. Read live HEAD/status and agents first;
the containing local delivery commit follows that parent. Production and test
bytes are identified in [current actual.json](../evidence/review-discoverability/actual.json).
Read [report57](../57-review-discoverability.md),
[report56](../56-review-batch-and-preview-reliability.md),
[progress](../automation-progress.md), and the still-applicable engineering scope
in [PF-Aalborg-engineering-review.md](PF-Aalborg-engineering-review.md).

On 20 October, live remote main and the clean original WFC checkout were both
`96e63f13fdc2b1d30b8f8ff658dd662f25fac104`. Before this delivery commit the local
branch was 91 ahead/3 behind cached main. No remote CI, push, PR or merge occurred.
Do not infer remote acceptance from these local checks.

## Runtime, authority and preserved behavior

- Only own 5191 is eligible: owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, compose
  project `wfc-pathfinder-local-0cba87606e9b`, runtime
  `pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`, Aalborg
  project `1af0f807-7653-40ea-8391-7eea6c54e7d4`.
- API image is `sha256:78536ccdf8050ccd732f383d09da56456e3fc9b10d9312568238577eea976f9c`;
  web is `sha256:2cab777210ebef28b251378187c326e3febbe2293dc8b38b733e19efe1742f56`.
  Upgrade/final health PASS. Engine identity and all2153database cable rows plus
  2preexisting database Apply receipts unchanged; Aalborg itself has2140cables.
- Two earlier full2140jobs were explicitly cancelled;0activejobs and412retained
  project proposals were checked. Do not relaunch those jobs or calculate all
  cables merely to inspect this UI. The earlier230calculated results are a
  historical count, not proof that230are currently applicable.
- A newly observed2140calculation was running during report57; the agent did not
  submit it, and this diagnosis did not establish the originating actor.
  The UI correction did not cancel/restart it or control API/PG/MinIO. The final
  upgrade saw2active jobs globally before/after, allowing natural progress. Read
  current job states; do not carry that count forward as current. One normal GET
  from the oldercomplete1808job still hadcanApplytrue/stalefalse after upgrade.
- Keep strict current-role admin enforcement, protected Viewer bridge, exact
  immutable proposal/revision/dependency/cableWriteRevision guards and idempotency.
  Preserve filled Ghost, original tray colors, yellow path and Clear/restore.
  No direct NOP_VIEWER integration or relaxed engineering gate.
- MV stays excluded from batch selection; Instrumentation uses Control. Project
  Details remains the source of SECONDARY/end connection/bending/gap values.
  Drawing Left/Right rules do not change routing or design length.
- Primary WFC5180, old5190, original/canonical PathFinder and synced sources are
  read-only/outside runtime changes. The primary Simplified Preparer integration
  and recurring PF automation remain PAUSED. No background authority was enabled.

## What is implemented and verified

Source contains independently bounded detail reads, single non-overlapping polls,
a five-row recent preview with complete paged results, preserved appearance while
loading a proposal, acknowledged Clear before Begin and bounded60sappearance
commands. It includes model reload recovery and specific missing-result handling.

Batch selection persists across pages of the same calculation. Explicit
`Confirm review for selected cables` and then `Apply reviewed selection` use the
existing server Review/Apply endpoints, with shared durable pending-command
recovery and exact identity checks before each dispatch. Batches are atomic per
cable; confirmed partial success survives stop/failure. No real engineering
Review/Apply was performed during this delivery.

Report57 adds an always-visible batch toolbar above pages, exact cancellation/
incomplete/unknown job explanations, initial known-complete selection without
poll retargeting, historical job-state verification and explicit manual non-MV
calculation IDs. Empty selection never calls Review/Apply. Ctrl+F5 the browser;
choose the complete1808scope, inspect/select ready rows and use the visible toolbar.

Current55distinct targeted tests, final frontend/backend typecheck, scoped lint,
production WEB build and WEBONLY upgrade PASS. API/PG/MinIO IDs/start times stayed
exact, all2153DBcables/2preexistingApplyreceipts unchanged; no realReview/Apply.
1277consumed inputs/94412540bytes had before/after source-closure verification.
New consistent concurrentDBsnapshot16225946bytes passed mountedTOC and finalhash
readback; it is not a cold dump or new restore drill. Do not rerun checks merely
for handoff. Historical228checks and the first build's NOT_MEASURED closure are
recorded at report56's revision; firstupgradeFAIL/reconciliationPASS/case2PASS
remain immutable. User screenshots show route/Ghost; no new toolbrowservisual
acceptance is claimed. Exact current scope is in report57 and its receipt.

## Bounded next actions and acceptance

1. Use the supported browser tool only if its saved-permission state is changed
   or access is otherwise actually restored. Current tool inventory could list
   tabs but binding `http://127.0.0.1:5191/login` was refused even after the user
   enabled Browser/Browsing and rebooted. Do not bypass the refusal with another
   browser, raw CDP, token extraction or indirect page-content access. If the same
   denial remains, record BLOCKED and continue only genuinely independent work.
2. With the human's existing normal administrator login, hard-refresh5191, open
   Path Finder → Path, choose an actual completed calculation under Cable revision
   results, and inspect an eligible exact proposal. Confirm model remains visible
   while loading, the exact path appears with filled Ghost/colors/yellow line,
   Zoom works, and Clear restores the full model. Capture actual errors and
   bounded timings; do not call the exact disappearance issue reproduced without
   observing it. Reload protected model should recover a genuine failed session.
3. Inspect checkboxes and selected route/design information across pages. Changing
   calculation must clear unprocessed selections; MV and known cancelled/incomplete
   jobs cannot be selected. Current dependency and server eligibility still govern
   all selections. A blocked result requires its actual reason to be resolved;
   never invent locations, aliases or geometry to make it ready.
4. Human must approve the concrete selection before Confirm review/Apply. Do not
   activate those real-data controls on the human's behalf from this generic
   diagnostic handoff. Real routes/lengths remain engineering decisions. Test
   mutation behavior only on positively owned synthetic fixtures if additional
   implementation changes genuinely require it. Never alter real cable values
   merely to demonstrate that the batch buttons work.
5. For a human-approved actual batch, verify routing+designLength together,
   installed length preserved, per-cable history/provenance, exact pending-command
   reconciliation and partial-success reporting. Pending Retry/Close confirmations
   currently refresh through the normal idle poll; normal Apply and batch completion
   force a fresh read. Distinguish that delay from an unconfirmed command.
6. If code changes are needed, use a new inheriting local branch, divide file
   ownership and preserve concurrent work. Root alone performs actual runtime,
   SQL and HTTP operations. Run tests appropriate to the changed behavior, create
   a fresh own backup before upgrade and compare exact engine/data/auth boundaries.

Complete only when actual browser checks and explicit human acceptance have the
corresponding evidence. Otherwise report the precise remaining BLOCKED/NOT_RUN
checks. Keep implementation/verification/acceptance separate. No automatic real
Apply, push/PR/merge or primary deployment is authorized by this prompt.

## Evidence and cleanup

Retain5191, its prior full model archive, both new cold DB dumps, original rollback
images, and private failure/reconciliation receipts under owned ignored
`pathfinder-engine/.scratch/tray-catalog-48e496e3-b4b3-4f6f-bc6c-cc595d8da8ad`.
The newest consistentDBbackup and currentUIrawreceipts are separately retained in
ownedignored `pathfinder-engine/.scratch/tray-catalog-344b78b8-6f66-4532-b9f6-0825f889b47c`.
Final readback proved0owned temporary helper containers; no new test stack exists.
The finalizer initially matched the retainedAPI/web image provenance labels; exact
runtime IDs corrected classification before any deletion. Do not remove the demo.
Historical denied scratch paths and parents remain untouched; no global prune.
Do not use5192-only test credentials at5191/5180 or reset/promote accounts.

After any genuinely new completed authorized work, record exact revision, scope,
PASS/FAIL/BLOCKED/NOT_RUN and retained failures; commit locally, then prepare the
next evidence-backed prompt. Stop at missing human engineering decisions rather
than creating recurring unchanged work.
