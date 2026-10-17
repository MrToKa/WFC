# Stage 8 isolated cable routing validation

This runner uses a new `wfc-routings-viewer-stage8-<run ID>` Compose project,
private PostgreSQL/MinIO/staging volumes, two API workers and explicit loopback
Docker/development origins. It never reads an existing `.env`, reuses Stage7
fixture state, calls APS/Preparer/PathFinder or changes the working WFC project.
Historical Stage7 tooling and evidence remain unchanged.

```powershell
node scripts/routings-viewer-stage8/run-stage8.mjs init --run-dir C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-cable-routing-output/fixture
node scripts/routings-viewer-stage8/run-stage8.mjs build --run-dir <same-directory>
node scripts/routings-viewer-stage8/run-stage8.mjs start --run-dir <same-directory>
node scripts/routings-viewer-stage8/run-stage8.mjs contracts --run-dir <same-directory>
node scripts/routings-viewer-stage8/run-stage8.mjs integration --run-dir <same-directory>
node scripts/routings-viewer-stage8/run-stage8.mjs browser --run-dir <same-directory> --playwright-module <local-module> --browser-executable <local-browser>
node scripts/routings-viewer-stage8/run-stage8.mjs regression --run-dir <same-directory>
node scripts/routings-viewer-stage8/run-stage8.mjs stop --run-dir <same-directory>
```

Ports default to18088/15188. The single mounted real Aalborg ZIP is pinned to
439112829 bytes and SHA256
`8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5`.
Import and explicit selection use public APIs. Synthetic fixture credentials
remain in process memory; reports contain public UUIDs/counts/statuses/screenshots.

API validation has two current full-list/read-role contract cases, six actual
import/cable-mutation/model-fence cases and one actual two-worker restart case.
The fixture contains87 cables:70 filler rows, two distinct UUIDs sharing an
original tag, both known routes, equal routing under different UUIDs, null/empty/
whitespace tags, NFKC-preserved labels, long/out-of-first-page tags and nullable/
empty/SECONDARY/invalid/all-missing routing. A nonempty cable-type routing is an
explicit negative fallback control. Only the fixture controls change these rows.

The browser runs18 cases per production/development mode, each with a fresh
context and the unchanged Stage5 browser-wide egress boundary. Cases cover real
keyboard/click cable routes, local filtering, manual draft/mode independence,
request identities, controlled races, true fixture reroute/delete/retag, stale
refresh, DB/model independence, layout, selection fencing, read roles and access
revocation. Basic also completes actual geometry loading and a keyboard cable
route. Browser transport/DTO/status faults are labelled as simulations; actual
server statuses and DB changes are separate observations. The observer sees only
public protocol messages from the exact current frame; it never reads SDK state,
credentials, cookies or arbitrary browser storage.

All business writes from application browser contexts are rejected by the final
assertion; authenticated viewer-session lifecycle requests remain allowed.
Mutation helpers require the exact `STAGE8-<run UUID>-<project UUID>` ownership
marker and known seeded cable identity. Cleanup checks Compose project and run
labels, and removes only newly owned fixture resources. Inputs/evidence/failures
are retained. Historical blocked cleanup is not retried.

Geometry and legacy fixtures retain their pinned SHA256. Applicable focused
API/list/hook/UI/Manual/Details/project-access/controller/aggregate regressions
and typecheck/lint/build run in a nonroot Docker image with network disabled.
The historical68 Stage7 runtime tests and unchanged engineering/AuthContext
suites are not rerun. Actual current cable protocol/rendering is exercised in
the real browser and pinned geometry/SDK preservation is checked separately.
No full Stage5 suite or native125percent rerun is claimed.
Current source/build stability, image identities and each actual result are
recorded; presence of tools or historical PASS is not a Stage8 PASS.
