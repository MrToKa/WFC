# Visible batch controls and calculation-specific Review blockers

Date: 2026-10-20. Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-review-discoverability-local-20261020`, parent
`26be0e789e279a893da34a9e0d74d646e4e7ed5c`.

## Actual diagnosis

The user's screenshots show an exact route and filled Ghost, but disabled Review
and no visible batch controls. Source inspection found the empty batch panel
returned null, and the controls were below the entire paged results component.
The first automatic calculation selection used the newest admission even when
its job was cancelled. Calculated partial results are retained for inspection;
the server correctly requires a complete, uncancelled job for Review/Apply.
The generic endpoint engineering notice did not explain that job-specific block.

Root performed only normal authenticated GETs and read-only SQL in the positively
identified5191 installation. A calculated proposal from a cancelled1981/2140job
had `canApply=false`, `stale=false`, `compatibilityIssue=null`. A proposal from
the retained complete1808/1808non-MV job had `canApply=true`, `stale=false`,
`compatibilityIssue=null`; that job contains230calculated results. Its immutable
admission was created at `2026-10-20T08:48:42.348Z`. This is one checked proposal,
not an assertion that every historical result is currently applicable.

A new2140job was running with1949processed/39calculated during the readback.
The agent did not submit or cancel it. Own resources, all2140Aalborg cable rows
and Apply count remained unchanged by the diagnosis. The UI update must preserve
the running API and worker; only the web container is eligible for replacement.

Raw readbacks remain private in owned ignored
`pathfinder-engine/.scratch/tray-catalog-344b78b8-6f66-4532-b9f6-0825f889b47c`.
No real Review, Apply, location edit or new calculation is authorized by this
diagnostic execution itself. Existing server completion, cancellation, dependency,
current-admin, cableWriteRevision, immutable result and idempotency guards remain.

## Delivery and verification

Delivered behavior:

- The batch toolbar is always visible above Cable revision results, with exact
  empty/blocked guidance. Explicit Review and Apply remain separate actions.
- First automatic selection prefers a known complete, uncancelled calculation.
  Initial reads wait for project state; later job polls do not retarget the user's
  selection. Missing historical job metadata is read through the existing bounded
  job endpoint, with account/project/context ownership and explicit retry.
- Cancelled/running/failed/unknown jobs show their concrete Review blocker.
  Calculated rows no longer promise readiness when their job is ineligible.
  A denied revision read shows a generic account error without retained rows/actions.
- Manual project calculation sends explicit LV/Control/Instrumentation IDs. MV and
  unknown categories are excluded; selecting an MV cable cannot dispatch a manual
  cable calculation. No calculation is dispatched automatically by these changes.
- Clear selection can abandon reviewed/blocked unapplied entries while preserving
  applied history. Existing server eligibility and fresh per-item checks remain.

**55 distinct targeted tests PASS**:32component tests (11Results,16RevisionResults,
5BatchReview),18revision-hook tests, and5affected full-Tab integration scenarios.
The remaining52Tab cases were not rerun for this delivery; report56 retains the
previous full-Tab evidence at its earlier revision. Final frontend/backend typecheck,
scoped ESLint, diff check, operator syntax and independent source reviews PASS.
No server, C# algorithm or calculation identity source changed.

WEB build **PASS** at2026-10-20T15:15:58.263Z. Before/after source closure verified
1277consumed files/94,412,540bytes; manifest SHA256
`9ccbb3e3beffd1938162fc3312aef1db68a3a06b86f9e84780aa95d3e28dc227`.
Build operator SHA256 `401cb200bb61f6529f2540d3891fd7722049ff41a5f7a7cf473240af6e59a479`.
The existing original backend restart loop changed StartedAt during build; full
configuration stayed exact and the agent did not control that container.

WEB-only upgrade **PASS** at15:16:47.863Z. New web image:
`sha256:2cab777210ebef28b251378187c326e3febbe2293dc8b38b733e19efe1742f56`.
API image remains `sha256:78536ccdf8050ccd732f383d09da56456e3fc9b10d9312568238577eea976f9c`.
API/PostgreSQL/MinIO IDs and start times, volumes/networks and outside configuration
were preserved; no outside running/start transition occurred during upgrade.
All2153database cable rows and2existing database Apply receipts were unchanged.
Two active jobs were observed globally both before/after; jobs and proposals could
progress naturally. No job was cancelled or restarted by the operator.

Before web control, a concurrent consistent `pg_dump` snapshot was saved privately:
16,225,946bytes, SHA256
`4bd99928f272ad181e173227afcc0a79f72da862afa367714f744579e4ab43d2`.
Mounted-file TOC verification passed (84,447bytes); final dump byte/hash readback
also passed. This is not a cold dump or new restore drill. The prior verified
full model archive remains retained. Upgrade operator SHA256
`08f84f1eb430cacf6ab483d7fc653fbfa7d8684d3eb555abb08c392126e6eaed`.

Final readback **PASS** at15:18:10.104Z: health200, exact runtime resources,0owned
temporary helper containers. A fresh normal GET of the same earlier complete-job
proposal still returned `canApply=true`, `stale=false`, `compatibilityIssue=null`.
No real Review/Apply or replacement calculation was performed. Exact scope and
source hashes: [actual.json](evidence/review-discoverability/actual.json).

Use Ctrl+F5 at http://127.0.0.1:5191, then Path Finder → Path. In Cable revision
results choose the completed1808-cable calculation if needed. Select ready rows
and use the visible toolbar above the results: Confirm review for selected cables,
then Apply reviewed selection. Inspect and approve actual paths/lengths first.

Browser-tool origin access remains blocked from the prior delivery; the user's
screenshots are distinct from a new live computer-use session. No permission
bypass or live visual acceptance is claimed. Broader engineering mappings and
human acceptance remain outstanding; use the updated acceptance handoff.

Read-only final Git checks confirmed original WFC clean on main
`96e63f13fdc2b1d30b8f8ff658dd662f25fac104`; live remote main returned the same SHA.
Before the new delivery commit this branch was91ahead/3behind cached main.
No remote CI or publishing occurred. Updated next prompt:
[PF-Review-batch-acceptance.md](handoffs/PF-Review-batch-acceptance.md).

PrimaryWFC5180, old5190, original/canonicalPathFinder and synced sources remain
outside changes. PrimaryPreparer and recurringPFautomation stay PAUSED. Preserve
historical denied paths, needed archives/rollback images/private evidence. No
push/PR/merge or unattended engineering Apply.
