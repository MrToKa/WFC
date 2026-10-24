# SP-1 — recoverable main WFC backup and health

Prepared using prepare-stage-handoff from accepted human changes and current
local evidence on 24 October 2026. Execute this stage immediately; routine stage
continuation is already authorized. Source is the Preparer worktree at
C:/Users/todor.chankov/source/WFC-preparer-local-20261020, branch
sp-1-main-backup-local-20261024 inheriting a3461c69ca85b8e8f0a9ed9d1cb142d4b17b2a75.
Re-read live Git/status/progress/processes before any operation and preserve
parallel security/service/UI edits. Root is the only actual test/runtime executor.

Read 00-plan.md's 24 October overrides, 01-backup-contract.md and current
automation-progress.md. Baseline qualification is Windows281 plus five exact
Linux platform checks; the retained strict full-run FAIL is not a new PASS.
Fresh candidate full Linux verification is a later deployment gate.

Target only original main WFC5180. Freshly pin API/web/postgres/minio IDs,
images/config/mounts/networks and every external writer. The existing PG on5434
is stopped; API restarts because it cannot connect; web is unhealthy. Do not
start original PG to make a backup. Use scripts/preparer-main/offline-seed.mjs
with a new immutable private intent/operation, exact helper image and explicit
excluded PF5191/5190/other resources. Capture all PG data, MinIO, staging, exact
images and separate private configuration companion. Retain originals and prove
source restoration; capture PASS alone has qualification NOT_RUN.

Recover the physical seed only in newly owned isolated PG resources. Produce a
logical dump and lossless raw all-public inventory/catalog/global objects. Restore
again into new quarantine and compare exact rows/keys/catalog/sequence/ACL/owners
before declared auth fencing. Perform read-only model/ZIP integrity checks without
production audit writes. Never terminate unknown clients or use blanket prune.
Only after recoverability is proved may original PG be started to repair normal
main health. Preserve exact rollback files and report statuses/revision/limits.

Do not touch PF5191,5190 or their volumes, denied historical paths or sources/.
No push/PR/merge. No secrets/business rows in Git. The user allows .env only for
tests and explicitly forbids new model conversion: no APS upload/translation on
startup, restart, recovery or tests. Use fake APS/existing completed packages.

Completion: verified backup+restore evidence, main health outcome, owned cleanup,
local stage commit and concise progress. Then prepare a self-contained SP-2
handoff via prepare-stage-handoff and execute immediately: strict current-admin,
memory-only page credentials, owner/login/page/revision leases, no global fallback.
Retain all truthful FAIL/BLOCKED/NOT_RUN limits and continue useful independent
work if a concrete external prerequisite remains.
