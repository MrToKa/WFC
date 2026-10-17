# Stage 7 isolated manual routing validation

This runner creates a new `wfc-routings-viewer-stage7-<run ID>` Compose project,
two private API workers, disposable PostgreSQL/MinIO/staging volumes and explicit
loopback Docker/development origins. It does not read an existing `.env`, reuse
older fixture state, call APS/Preparer/PathFinder or change the original WFC project.

```powershell
node scripts/routings-viewer-stage7/run-stage7.mjs init --run-dir C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-manual-routing-output/fixture
node scripts/routings-viewer-stage7/run-stage7.mjs build --run-dir <same-directory>
node scripts/routings-viewer-stage7/run-stage7.mjs start --run-dir <same-directory>
node scripts/routings-viewer-stage7/run-stage7.mjs contracts --run-dir <same-directory>
node scripts/routings-viewer-stage7/run-stage7.mjs integration --run-dir <same-directory>
node scripts/routings-viewer-stage7/run-stage7.mjs browser --run-dir <same-directory> --playwright-module <local-module> --browser-executable <local-browser>
node scripts/routings-viewer-stage7/run-stage7.mjs regression --run-dir <same-directory>
node scripts/routings-viewer-stage7/run-stage7.mjs stop --run-dir <same-directory>
```

The default ports are 18087 and 15187. Only the pinned 439112829-byte Stage3
Aalborg ZIP is mounted read-only; the model is imported through the public API and
explicitly selected. Synthetic fixture credentials remain in memory; evidence
contains public UUIDs, counts, statuses and screenshots, never tokens/cookies.

API cases validate the complete tray DTO/read-role/auth distinction, actual
database deletion/NFKC collision and protected-model independence, selection
revision fencing and restart persistence. Browser cases exercise the actual
project tab with both route chains, fresh DB reads, controlled network/race
faults, settled screenshots, responsive layout, role admission and current access
revocation in Docker and development. Network faults are labelled as browser
transport faults; they are not claimed as real authorization denials. No actual
geometry or engineering length conclusion follows from a yellow connector.

All mutation helpers enforce an exact Stage7 project number containing this
run UUID. Cleanup checks the exact Compose project and Stage7 ownership label;
it removes only the newly created fixture resources. Failed attempts are retained
as evidence. Source code, historical PASS results and dry-run presence are not a
current test PASS. The full Stage5 acceptance suite is intentionally not replayed.
