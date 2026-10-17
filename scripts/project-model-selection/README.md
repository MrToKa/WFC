# Isolated Stage 6 model selection acceptance

This tooling creates a new labelled disposable PostgreSQL/MinIO/two-worker API environment. It never uses a working WFC database, environment file, Model Preparer endpoint or APS account. Stage 5 tooling and evidence remain unchanged.

```powershell
node scripts/project-model-selection/run-stage6.mjs init --run-dir C:/stage6-evidence/run-01 --port 18086 --dev-port 15186
node scripts/project-model-selection/run-stage6.mjs build --run-dir C:/stage6-evidence/run-01
node scripts/project-model-selection/run-stage6.mjs start --run-dir C:/stage6-evidence/run-01
node scripts/project-model-selection/run-stage6.mjs contracts --run-dir C:/stage6-evidence/run-01
node scripts/project-model-selection/run-stage6.mjs integration --run-dir C:/stage6-evidence/run-01
node scripts/project-model-selection/run-stage6.mjs browser --run-dir C:/stage6-evidence/run-01 --playwright-module C:/local/node_modules/playwright/index.mjs --browser-executable C:/local/chrome.exe
node scripts/project-model-selection/run-stage6.mjs regression --run-dir C:/stage6-evidence/run-01
node scripts/project-model-selection/run-stage6.mjs stop --run-dir C:/stage6-evidence/run-01
```

Use a new directory outside the repository. Each run generates its own `wfc-project-model-selection-stage6-<id>` project, tags and ownership labels; no previous Stage 5 state is reused. The fixture intentionally retains the internal synthetic Stage 4 database and bucket names so the existing strict fixture-environment guard remains valid. Ports are loopback only. Input ZIPs are pinned, read-only individual mounts. The secondary Stage 1 ZIP is a transport alias, not a second content version.

The API and browser fixtures import actual Aalborg content through the public Stage 4 API and verify that import does not select a model. They also publicly pack and import a small synthetic model with different actual property-resource bytes and the same label. This B model is a distinct verified content identity for selection/CAS tests; it is not claimed to be a second renderable Aalborg model. The harness loads only actual Aalborg A. Unavailable tests delete one explicitly checked owned synthetic resource, then use the real selection readback path to obtain503 and persist unavailable health, preserving active A.

`contracts` runs only focused real metadata/header/legacy-JWT checks. `integration` covers real import, UUID identity, null/reselect/CAS, read-only enforcement, cookie-session revocation and two-worker restart persistence. `browser` covers actual Details editor/read-only UI, keyboard save, pending/no-op behavior, cross-tab conflict, lost-response reconciliation, unavailable/error/empty states, and production/development API wiring. Only production mode performs the required opened-harness and explicit fresh-load check; the full Stage 5 route/geometry suite is not repeated. The same browser-wide exact-origin boundary from Stage 5 applies to all browser workers. Credentials arrive on stdin and tokens/cookies remain in memory; evidence contains safe IDs, paths, status and counters only.

`regression` runs typecheck/lint/build plus the focused model API/hook/component, Details/project-access, existing ViewerController and engineering settings tests in an immutable nonroot image with no network. Source and image identities are recorded before/after. Source presence alone is not a test PASS.

`stop` validates the exact run/project labels before removing only its own containers, networks and three volumes. Keep inputs and evidence. Coordinate stopping with the parent task so pending browser or restart checks are not interrupted. Unreferenced images from this exact run require a separate ownership/reference check; shared caches and existing services must be preserved.
