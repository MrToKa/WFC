# Selected-object bounding-box assignment correction

Status: SOURCE_CHECKS_PASS / STATIC_WEB_DELIVERED / REAL_BROWSER_CHECK_BLOCKED.
Branch: pf-u9-selected-bounds-local-20261021.
Final product source: fee2d78861c7c0ec9b1dfcb5792f3f1487814992.

## Cause and corrected behavior

The screenshot's notice did not mean that the visible SDK object had no geometry.
The protected selection reader supplies the exact selected object's recursive
bounding box. The former popup Assign action required that same SDK ID to have
an equipment record in the prepared artifact/current trace. Preparation includes
automatic endpoint-name candidates, so an arbitrary selected child can be absent,
or retained only as hierarchy. The exact response from the screenshot was not
observed; source establishes these failure paths, not which specific reason ran.

The normal paired popup now calls a dedicated read-only assignObjectBottomCentre
operation. Available retained equipment still uses its verified object-derived
anchor. Only SDK_OBJECT_NOT_RETAINED, SDK_OBJECT_GEOMETRY_NOT_RETAINED or
SDK_OBJECT_EQUIPMENT_GEOMETRY_REQUIRED may stage the explicit selected point using
the existing fixed-world/manual-world-point contract and displaySdkObjectId.
Every returned reason must be allowed. Hidden, ambiguous, changed-scope, corrupt
anchor, authority and HTTP failures never turn into coordinate fallback.

The selected point is ((minX+maxX)/2, (minY+maxY)/2, minZ) in canonical project
metres: the bottom-plane centre, not the centre in all three axes. A single finite
current protected selection and a matching current endpoint context are required.
Assign does not save or calculate. Save remains one durable atomic From/To command
and retains the cable logical location names, shared reuse, recovery/idempotency,
affected non-MV recalculation and both-empty initial-fill policy. Existing routing
or design length still requires human comparison/Review/Apply. Installed length
is unchanged. No C# formula or server authoring contract changed.

A manually assigned point is explicitly fixed in the current model frame; it does
not silently become revision-following object attachment. Its SDK ID is retained
in command audit; the binding stores the point. The current read context does not
restore that manually selected object's label after a reload, so Saved endpoint
and the saved coordinates may be shown. Durable object-label display and verified
cross-revision attachment are not newly claimed by this correction.

## Checks

- PASS: 120 hook/pair/popup tests across three files. Executed at3e9f3f6; their
  production/test file contents are unchanged in finalfee2d78. Covers absent
  equipment/hierarchy, exact bottom point, logical name preservation, no write
  until Save, atomic paired command, forbidden reasons, authority and late reads.
- PASS: final48 Node Viewer source tests atfee2d78, including six new bounds tests:
  selected parent/child distinction, lower-face point, units/offset exactly once,
  empty/changed selection, fragment cap and unchanged Ghost/appearance/selection.
- PASS: frontend TypeScript noEmit, scoped ESLint, Node syntax and git diff checks.
- PASS: final Docker web build including Vite production and server TypeScript
  compilation. Compiling the server does not install or restart its API image.
- PASS: independent source/security and operational review. One optional low-level
  model guard was deferred to avoid changing the API's hashed projection closure.
  Existing protected load/model/selection checks remain. No visibility mutation,
  parent substitution or new browser bypass was introduced.
- BLOCKED/NOT_RUN: actual Aalborg reread and live Model Browser/Assign/Save check.
  The saved browser-origin refusal was not retried unchanged or bypassed. Existing
  synthetic server-chain proof is report71, not a new real-model test here.

## Actual static-web delivery

The exact owned5191 runtime is unchanged: owner8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46,
composewfc-pathfinder-local-0cba87606e9b, runtime
pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600.
Root alone executed Docker/HTTP operations. Private operator receipts/logs are in
pathfinder-engine/.scratch/selected-bounds-web-20261021-fee2d78.

Preparation PASS preserved the old web image as a55,296,512-byte rollback tar,
SHA25663f69229a6b75bf05b40b4e1eaf1a2ce620cda4287a7436a5451199904edf3d7,
plus private prior runtime/env metadata. This backup covers the only resources
changed by this static-web update. No new database/model archive was made here;
the existing U8 database/model archive and private companion are retained.

Activation PASS at2026-10-21T02:35:37.757Z used compose --no-deps web only.
New web image: sha256:aa5e3afd5f1ebd8a387f3859a11773a5ff730b23d0be97811980eee70527bb0f.
New web container:4d098f2e65b14efac495d85081faf025842fd0f00580fc98e9d224764e3556a5.
API remains3476333e, with unchanged container/start; PostgreSQL and MinIO also
retain exact identities/configurations/start state. No SQL, model/resource writes,
real endpoint Save, Review, Apply, new grant or engine identity change was issued.

A byte check caught local CRLF conversion although git content was unchanged.
The final build uses the canonical39018-byte pathfinder.mjs from Git, byte-equal
to the existing API and prior web: SHA256
bf4c8f76e63a04d6f08c0a618238bb5a417219433df1fc7700072363340e06a8.
Thus the computational runtime source remains aligned with the current API.
The served bundle ProjectDetails-BMp99Zh3.js contains the new assignment action;
container health and unauthenticated /health200 passed. These static/server checks
are not a browser UI PASS. The operator retains exact web-only rollback on failure;
rollback execution was NOT_RUN because activation succeeded.

All non-web container identities/configuration hashes were conserved. The already
restarting original backend had external process-state changes, observed honestly;
root issued no control actions to it. Original5180/5190/checkouts/sources remain
untouched by this delivery. No push, PR, merge or Path Finder deployment there.

Cleanup removed the owned unused3e9f3f6 build tag/image after verifying labels and
no container users. The supersededbff56c intermediate image was already absent.
No new test DB/container/volume was created. Keep the active5191 image, original
rollback image/tar, logs and evidence; no prune or denied-path cleanup occurred.

## Remaining work and sequencing

Use handoffs/PF-U7-selected-bounds-browser-check.md once legitimate browser access
changes. Re-read Aalborg before real-model checks, then verify the selected BOX
object's point and explicit Save/reuse/calculation. Do not manufacture mappings or
human engineering approval. The existing automation remains PAUSED at that gate.
After the required Path Finder technical checks, resume the preserved Simplified-
Preparer-WFC integration on main5180 as explicitly directed by the user, with a
fresh inventory and verified database/model backup before that separate update.
Cached origin/main comparison was3behind/128ahead atfee2d78; live remote/PR/CI
were NOT_RUN for this correction. Earlier remote observations remain historical.