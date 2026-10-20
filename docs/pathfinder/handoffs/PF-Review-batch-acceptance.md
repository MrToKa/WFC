# Path Finder — verify proposal preview and selected batch acceptance

Status: technical delivery verified; live browser verification BLOCKED and real
engineering acceptance AWAITING_HUMAN_INPUT. This is not a new full implementation
stage or permission to rerun completed PF stages.

## Goal and baseline

Verify the reported slow/disappearing proposal preview in the actual browser,
then let the human review and explicitly apply selected non-MV proposals through
the new batch controls. Do not treat automated tests as live visual acceptance.

Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-review-batch-preview-local-20261020`, parent
`efe9fc0b7358ed2397d4850eb770335be676b890`. Read live HEAD/status and agents first;
the containing local delivery commit follows that parent. Production and test
bytes are identified in [actual.json](../evidence/review-batch/actual.json).
Read [report56](../56-review-batch-and-preview-reliability.md),
[progress](../automation-progress.md), and the still-applicable engineering scope
in [PF-Aalborg-engineering-review.md](PF-Aalborg-engineering-review.md).

On 20 October, live remote main and the clean original WFC checkout were both
`96e63f13fdc2b1d30b8f8ff658dd662f25fac104`. Before this delivery commit the local
branch was 90 ahead/3 behind cached main. No remote CI, push, PR or merge occurred.
Do not infer remote acceptance from these local checks.

## Runtime, authority and preserved behavior

- Only own 5191 is eligible: owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, compose
  project `wfc-pathfinder-local-0cba87606e9b`, runtime
  `pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`, Aalborg
  project `1af0f807-7653-40ea-8391-7eea6c54e7d4`.
- API image is `sha256:78536ccdf8050ccd732f383d09da56456e3fc9b10d9312568238577eea976f9c`;
  web is `sha256:4f6acddc21724b8c3d62d74bcb810576a4c4d317fb6509c5995cde7c829a5f1c`.
  Upgrade/final health PASS. Engine identity and all2153database cable rows plus
  2preexisting database Apply receipts unchanged; Aalborg itself has2140cables.
- Two earlier full2140jobs were explicitly cancelled;0activejobs and412retained
  project proposals were checked. Do not relaunch those jobs or calculate all
  cables merely to inspect this UI. The earlier230calculated results are a
  historical count, not proof that230are currently applicable.
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

228distinct targeted tests, final frontend/backend typecheck, scoped lint and
production API/web builds PASS. Do not rerun them merely to prepare another prompt.
The original build operator's before/after byte-level source closure was
NOT_MEASURED; the build success, image IDs, actual upgrade engine/data fences and
source freeze are recorded separately. First upgrade FAIL and later independent
rollback reconciliation PASS remain immutable, as does the successful case2.

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
Final readback proved0owned temporary helper containers; no new test stack exists.
The finalizer initially matched the retainedAPI/web image provenance labels; exact
runtime IDs corrected classification before any deletion. Do not remove the demo.
Historical denied scratch paths and parents remain untouched; no global prune.
Do not use5192-only test credentials at5191/5180 or reset/promote accounts.

After any genuinely new completed authorized work, record exact revision, scope,
PASS/FAIL/BLOCKED/NOT_RUN and retained failures; commit locally, then prepare the
next evidence-backed prompt. Stop at missing human engineering decisions rather
than creating recurring unchanged work.
