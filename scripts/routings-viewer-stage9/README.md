# Stage 9 isolated cable information validation

This runner creates a new `wfc-routings-viewer-stage9-<run ID>` Compose project,
private PostgreSQL/MinIO/staging volumes, two API workers and explicit loopback
production/development origins. It does not read existing `.env` files, reuse old
fixture state, call APS/Preparer/PathFinder or change the working WFC project.
All historical stage tooling and evidence remain unchanged.

```powershell
node scripts/routings-viewer-stage9/run-stage9.mjs init --run-dir C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-cable-information-output/fixture
node scripts/routings-viewer-stage9/run-stage9.mjs build --run-dir <same-directory>
node scripts/routings-viewer-stage9/run-stage9.mjs start --run-dir <same-directory>
node scripts/routings-viewer-stage9/run-stage9.mjs contracts --run-dir <same-directory>
node scripts/routings-viewer-stage9/run-stage9.mjs integration --run-dir <same-directory>
node scripts/routings-viewer-stage9/run-stage9.mjs browser --run-dir <same-directory> --playwright-module <local-module> --browser-executable <local-browser>
node scripts/routings-viewer-stage9/run-stage9.mjs regression --run-dir <same-directory>
node scripts/routings-viewer-stage9/run-stage9.mjs stop --run-dir <same-directory>
```

Default ports are 18089/15189. The single mounted real Aalborg ZIP is pinned to
439112829 bytes and SHA256
`8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5`.
Import and explicit selection use public APIs. Synthetic fixture passwords and
login tokens remain in process memory; reports use public UUIDs, original fixture
fields, counts, statuses and screenshots.

API acceptance contains two full-list/read-role contract cases, three actual
import/information-update/model-preservation cases and one actual two-worker
restart case. The fixture contains 87 cables, including duplicate tags under
different UUIDs, null/empty/whitespace values, original Unicode and multiline
locations/routing, markup-looking text, long fields and out-of-first-page rows.
Connection dates are deliberately different from location strings. A nonempty
cable-type routing is a negative fallback control. Information updates, deletion,
retagging and ACL revocation affect only exact fixture-owned identities.

The browser runs 18 focused cases per production/development mode, with one full
actual model load per mode. It preserves both known drawable cable routes and
manual text, then checks actual delayed hover timing, early leave, pointer gap,
nonmodal focus, pinning/filtering/scroll, Alt+Enter, native Enter/Space routing,
original fields, full-snapshot updates of unselected UUIDs, true deletion, stale
refresh, small layouts/dark shell, read roles without an active model and lifecycle
retirement. Exact fake-timer 999/1000 boundaries are unit coverage; the real
browser records actual scheduler timestamps without advancing its clock.

Clipboard evidence distinguishes native success, actual Chromium permission
denial through CDP, simulated unavailable API, simulated rejected/deferred
promises and actual Ctrl+C/paste into a test-owned textarea. The observer reads
only controlled fixture text after explicit test writes/copies. The application
never reads clipboard contents. Native permission denial is not presented as a
human interaction with a permission prompt. Temporary API simulations are restored.
Windows native readText converts LF to CRLF in the preflight; the observer records
that platform behavior and requires an exact real paste into its own textarea.
Unit tests separately require the original exact writeText argument.

Fresh contexts use the unchanged browser-wide egress boundary. All roles' requests
are included in the zero-business-write assertion; login and exact protected
viewer-session lifecycle requests are allowed. No hover detail request is needed.
The observer sees public bridge messages only from the exact current frame and
records only safe network metadata, never credentials, cookies or query values.

The regression runner executes exactly eight affected API/list/hook/panel/UI/
project-access files plus typecheck, lint and production build in a nonroot Docker
image with network disabled. Unchanged controller/aggregate/runtime/engineering
suites and native browser zoom are historical coverage and are not rerun here.
Pinned geometry and legacy fixtures retain their SHA256; actual current rendering
is exercised in the real browser.

Before/after source inventories, image identities, host observer identity and each
actual result are recorded. Tools or historical PASS results do not constitute a
Stage 9 PASS. Cleanup checks the exact Compose project and run labels, removes only
new owned fixture resources and preserves inputs/evidence/failures. Historical
blocked cleanup is not retried.
