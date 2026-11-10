# Deployed Materials / STEP acceptance — 2026-11-10

Scope: canonical Materials families, independent component SKUs, STEP revision assets,
pinned proposed instances, isolated Aalborg validation and STEP/MTO readback. Work remains
on `feature/aalborg-step-routings-builder-poc-20261110`; no merge/deployment to `main`.
This report supersedes the incomplete acceptance items in checkpoint 13.

## Isolation and source preservation

PoC application is running at **http://127.0.0.1:5181**, Compose project
`wfc-aalborg-poc`, with its own PostgreSQL, MinIO, model staging and PathFinder volumes.
Only the frontend publishes a loopback port. Five PoC services are independent of WFC
5180. Real application API/web images were built and deployed; converter is bounded
to its existing isolated process. `.env.poc` remains ignored and protected by Windows ACL.
The bootstrap script's Windows PowerShell parameter-default failure was fixed and its
real execution succeeded without exposing settings.

The verified original Aalborg ZIP was imported through the normal authenticated model
API into a **new** PoC project. This is a fresh project with the same immutable SVF,
not a full clone of source cable/project/user/session records. No cold maintenance or
hot copy of source storage was used. The source active registry was inspected in a
read-only transaction and its fingerprint matches the verified archive:

- Source project: `0c0007c9-d73f-4d13-bc87-601c544727b7`.
- Source active version: `9dbe511d-9c51-49e8-bb4a-b52033b98f35`, ready / healthy.
- Fingerprint: `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`.
- ZIP SHA-256: `e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922`.
- Package UUID: `cc477b02-e0f9-47bc-b965-7064e93404fe`; 342 resources / 439007803 raw bytes.
- PoC project: `1e505b2f-12a4-4044-82ee-97cd9d32ff15`.
- PoC active version: `585c6bfe-9db1-43ef-aef7-e7b2b6ef520a`.

The current Materials snapshot was separately cloned using the guarded procedure in
[report 14](14-materials-snapshot-clone.md): 48 trays, 5 referenced curves, 1254 points,
4 images / 729085 bytes. Full row/hash readback and an idempotent rerun passed.
Source digest remained `cadaa19851553057e4bd23b2864a932e618e9875773797006cbe61b6a008aecb`
when captured again after the PoC CAD operations. No source users or credentials were
copied. The PoC has its own independently registered admin. Its login is stored locally
as `POC_ADMIN_EMAIL` / `POC_ADMIN_PASSWORD` in the private `.env.poc`, never in Git.

Source frontend/backend/database/MinIO kept their original start times around
`2026-11-10T16:26:41Z`, restart counts zero; source 5180 health remained HTTP 200.
The original `main` checkout remained at `1020184` and was not changed.

## Real browser acceptance

Executed against the actual pinned Autodesk Viewer 7.130.0 and full Aalborg SVF,
not a mocked scene. Viewer reported ready with original geometry/identifier metadata.

| Scenario | Result |
| --- | --- |
| Materials preserves original straight identity/curve/image link | PASS, existing `KL 60.303 F` selected |
| Upload real straight STEP through Materials UI | PASS, original source bytes / revision 1 |
| Add fitting with independent SKU in the same family | PASS, separate bend component, no straight-tray FK |
| Upload real bend STEP through Materials UI | PASS, separate asset / revision 1 |
| Select both from the shared Materials picker | PASS, project stores references only |
| Pick a real source-model surface point | PASS, canonical world coordinates populated |
| Save straight with Rx=90 degrees | PASS, persisted transform, actual mesh acknowledged |
| Snap bend to straight end and save | PASS, 2 instances / 1 connector relationship |
| Refuse connected instance motion | PASS, real API returned HTTP 409 |
| Disconnect, nudge bend Y by 50 mm, save | PASS, API readback showed revision 2 and +50 mm |
| Snap again, update, reconnect | PASS, final design revision 8 / 2 instances / 1 connection |
| Reload page and rehydrate scene | PASS, both original pins and connection retained; 2/2 meshes acknowledged |
| Focus each saved CAD part in the real scene | PASS, straight rungs and bend visible against source model |
| Export STEP and MTO using UI controls | PASS, both files downloaded to local Downloads |

The bend identity `NDX_KLBK_60-303_MED_214` is taken verbatim from the supplied STEP's
embedded PRODUCT identifier. It is not a fabricated manufacturer order number. No tee,
coupler or accessory stock number was invented; those supported kinds await actual
manufacturer product data/files.

To inspect small parts inside the large source scene, a new **Zoom to selected
component** action was added. Its strict model-scoped CAD_FOCUS request resolves only
the saved UUID's owned dynamic instance, never caller-supplied source SVF object IDs.
The button stays disabled until actual display acknowledgement. Dynamic-model cleanup
now unloads the owned model instead of retaining it in the hidden-model queue.

## Revision and exact export acceptance

The active straight STEP was uploaded again and reused. A labelled, header-comment-only
test revision was then published; the existing design remained pinned to revision 1,
whose download retained the exact original hash. Original manufacturer bytes were
published again as current revision 3. All history remains; final instances still pin
revision 1. This exercised storage/conversion/revision behavior without inventing
changed manufacturer geometry.

`validate-deployed-design.mjs` passed against the deployed application: independent SKU
identity, 401 without authentication, 400 for project metadata overrides, 409 for
connected motion, source-byte hashes, pinned revision/history, coherent STEP response
headers and two correctly identified MTO rows.

The exported STEP was re-imported into the isolated OCCT worker and compared with
each original pinned STEP transformed by its saved quaternion/translation. **Two
solids matched within 0.05 mm on every bounding-box coordinate.** Final bounds in mm:

- Straight: `(22232.37052941,-39006.38036828,18772.77551411)` to
  `(22532.37052941,-33006.38036828,18832.77551411)`.
- Bend: `(22232.37052941,-39951.38036828,18772.77551411)` to
  `(23177.37052941,-39006.38036828,18832.77551411)`.

Local deliverables and the exact hash/revision receipt are under
`.data/poc-deliverables/`: `Aalborg-Proposed-Cable-Trays.step`,
`Aalborg-Proposed-Cable-Trays-MTO.csv`, `acceptance-manifest.json` and real Viewer JPGs.
The STEP is 1863805 bytes; MTO contains two rows. Export hashes can change with the
STEP writer's timestamp; compare geometry and saved-revision metadata, not byte equality
across separate generated exports. Proprietary model/STEP/image bytes are not committed.

## Verification coverage and repeatability

- Full Materials suite: **17/17 passed**, including all 14 previously unfinished table,
  filter and return-state scenarios, 201.68 seconds. Queries were optimized without
  removing assertions; multi-action table tests have a measured 60-second budget.
- Full ViewerController suite: **154/154 passed**.
- New focus readiness/failure UI tests, existing picker tests, protocol, scene ownership,
  clone guards, module-closure tests, TypeScript, lint and actual Docker builds passed.
- The existing PoC workflow now includes full Materials and ViewerController coverage,
  CAD focus UI/protocol checks and snapshot guards. Previous commit `bc536dc` passed
  [CI run 42872507829](https://github.com/MrToKa/WFC/actions/runs/42872507829).
  The continuation's exact CI run is recorded with its commit in the final delivery.

Repeat deployed readback using `node scripts/poc/validate-deployed-design.mjs`.
`--exercise-revisions` deliberately adds retained test revisions to this PoC only.
Run `verify-deployed-export.py` inside the converter image with the deliverables mounted
read-only to verify exact bounds again. Bootstrap with
`initialize-acceptance-project.mjs <verified Aalborg ZIP>`; it refuses another archive
hash and reuses the dedicated existing PoC project/version. Run only the dedicated
Compose file/project; no source service needs to stop.

## Acceptance boundary

This completes software acceptance for the requested Materials/SKU/STEP integration
and the two supplied-part PoC. It does not certify engineering fit, structural capacity
or collision clearance. Verified snap ports currently cover only the two supplied
SHA-pinned samples. Arbitrary fitting connector definitions, a freehand mouse gizmo and
true 2D DWG section export are not implemented by this Materials increment.
