# Aalborg Niedax STEP Routings Builder — implementation checkpoint, 2026-11-10

**Status: CODE-INTEGRATED / NOT DEPLOYED / NOT END-TO-END ACCEPTED.**

Work is exclusively on `feature/aalborg-step-routings-builder-poc-20261110`. Original `main`, production-like WFC on localhost:5180, `wfc_app` PostgreSQL and `wfc-minio` are unchanged. The continuation now has local Docker access for disposable tests. See [Materials catalogue continuation](12-materials-components-catalog.md) and [local validation evidence](13-materials-validation-20261110.md); older stage notes below describe the preceding checkpoint.

## Acceptance gates by implementation stage

| Gate | Implemented source | Verification | Status |
| --- | --- | --- | --- |
| 0: Safe isolated PoC | `compose.poc.yaml`, private credentials, isolated Python converter, separate PG/MinIO volumes | Local Docker config/build and coherent Aalborg restore pending | **NOT RUN** |
| 1: Real catalogue | SHA-bound import endpoint, isolated STEP-to-mesh conversion, original STEP and mesh in MinIO, catalogue UI | CAD geometry imported in separate local CadQuery 2.8 feasibility; PoC HTTP integration not tested | **CODE ONLY** |
| 2: Scene API overlay | `cad-scene.mjs`, bridge protocol, chunks and scope validation, ViewerController methods | Official Scene API shape reviewed; real SDK 7.130/Aalborg browser not tested | **CODE ONLY** |
| 3: Manual positioning | Pick existing SVF surface point, world-mm XYZ, axis nudge +/- step, Euler fields, quaternion persistence | UI tests not executed; precision on imported SVF not measured | **CODE ONLY** |
| 4: Connector snap | Two exact SHA-verified Niedax port frames, snap transform, DB ports/connection graph, 1mm/0.1degree validation, explicit disconnect | Pure tests authored; mechanical joint/clearance not vendor-approved | **CODE ONLY** |
| 5: Save and reload | Project/model-scoped PostgreSQL instances, optimistic revision, rehydrate in Viewer on reload | Full DB/browser concurrency and rehydration tests not executed | **CODE ONLY** |
| 6: Client export | MTO CSV, saved-instance STEP assembly from original B-Rep; converter reimports generated assembly | Separate local exact B-Rep export of same two STEP parts: two solids reimported. HTTP/UI ZIP not tested | **PARTIALLY VERIFIED** |
| 7: Full Aalborg end-to-end | Tests and scripts in branch | Cannot start/access Windows Docker from this session | **BLOCKED BY ENVIRONMENT** |

## Exact test CAD assets

- Bend `NDX_KLBK_60-303_MED_214.step`, SHA-256 `7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014`; source Part21 AP214, 1 solid, bounds 945 x 60 x 945 mm.
- Straight `NDX_KL_60-303_F_MED_214.step`, SHA-256 `d381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd`; Part21 AP214, 1 solid, bounds 300 x 60 x 6000 mm.
- The isolated POC catalogue importer deliberately **rejects any other STEP hash or filename** until units, vendor fit, connector profiles and conversion limits have independent verification.
- The initial connection ports are *geometry-derived hypotheses*, not certified Niedax assembly clearances. Material list counts installed parts, not implicit couplers/supports.

## Code architecture and relevant files

- **Frontend**: `src/pages/ProjectDetails/RoutingsViewerTab.tsx` (feature-gated Components mode; existing Manual/Cables retained), `CadComponentsPanel.tsx`, `CadPlacementPanel.tsx`; `src/viewer/ViewerController.ts` wraps the protected protocol.
- **Shared geometry**: `shared/cadTransforms.ts` and `shared/cadPocPorts.ts` are used by browser/backend. Snap is explicit and SHA-verified.
- **Frame**: `viewer-runtime/protocol.mjs` validates CAD_BEGIN/APPEND/COMMIT/TRANSFORM/REMOVE/ACK, `bridge.mjs` reassembles bounded chunks, `adapter.mjs` owns dynamic scene; `cad-scene.mjs` converts canonical world mm into SVF display coordinates.
- **Server**: `server/cadDesign/schema.ts`, `routes.ts`, `converter.ts`, `stepAssemblyClient.ts`, `pocPortSeed.ts`, `stepFileValidation.ts`. Feature gate `WFC_CAD_DESIGN_ENABLED` off by default.
- **Worker**: `Dockerfile.poc-converter` and `scripts/poc/step-mesh-converter.py` (isolated CadQuery/OCCT process; JSON mesh and exact STEP assembly).
- **CI/static validation**: `.github/workflows/aalborg-poc-validation.yml`, `scripts/poc/validate-poc.ps1`, relevant Vitest tests, `viewer-runtime/test/cad-protocol.node-test.mjs`.

## Stage 8 — required next plan: local static and runtime validation

**8.1. Git/Node:** In the existing `C:\Users\todor.chankov\source\WFC-aalborg-poc` worktree, require clean branch, fast-forward from GitHub. Do not switch/reset the main checkout. Node 24 required.
**8.2. Quality:** Execute `scripts/poc/validate-poc.ps1`, which uses locked npm dependencies and runs typecheck, lint, focused Vitest, viewer-runtime protocol tests and frontend/backend builds. If any fails, correct the exact source/test and rerun until clean. The authored GitHub push workflow has not been observed to complete.
**8.3. Converter:** Build isolated converter image and validate /health, import both actual STEP files, measured bounds/mesh counts, and /assemble/readback; require no unknown external URLs or unexpected worker writes.
**8.4. Database:** Run schema migration only in PoC database. Test project access rights, import idempotence, model revision selection, cross-project denial, concurrent edits, same-design port FKs, snap enforcement, and disconnect before move.

**Gate 8:** All typecheck/lint/build/unit/DB/converter tests pass with recorded Git SHA and image digests. If failure, **stop before app deployment**.

## Stage 9 — required next plan: coherent isolated Aalborg data restoration

**9.1. Read-only source inventory:** Verify current source Aalborg project UUID, active model version, model registry health, exact MinIO bucket/prefix/objects, existing back-up status and source endpoints (without printing credentials).
**9.2. Coherent backup:** Use WFC model-aware backup procedure (`docs/routings-viewer/10-operations-backup-restore.md`) with verified roles/mounts and cold consistency boundary. Keep production writing paused only during a controlled backup if required. Do not copy live PostgreSQL data files or do a filesystem-only hot copy of MinIO as a substitute.
**9.3. Restore into PoC only:** Independent PostgreSQL role/database and MinIO volume; ensure Aalborg model registry and source objects match backup readback. `WFC_MODEL_BUCKET` stays a bucket name, not a new external store.
**9.4. Secrets/ownership:** Rotate/replace any copied auth credentials, never publish them; keep PoC endpoints bound to loopback; verify PoC cannot reach or mutate original data stores.

**Gate 9:** Exact active Aalborg model loads from restored data on isolated storage; source inventories unchanged. If the source backup/tool profile is unsupported, stop and choose a reviewed project-only migration instead.

## Stage 10 — required next plan: real visual authoring and export acceptance

**10.1. Deploy isolated stack:** `docker compose --env-file .env.poc -f compose.poc.yaml -p wfc-aalborg-poc --profile app up -d --build` only after gates 8 and 9, from the dedicated worktree. Verify original 5180 remains healthy and PoC 5181 responds.
**10.2. Exact first part:** Sign into PoC and open the restored Aalborg active model, enter Components, import the verified straight ladder, pick a real SVF surface point and save an instance. Verify matching coordinates, mesh orientation/scale and persisted location after refresh.
**10.3. Exact second part:** Import the verified bend, choose ports and connector snap. Save and verify two persisted instances plus one connection; test rejection of >1mm displacement, incompatible or occupied ports.
**10.4. Editing:** Disconnect and move a part with XYZ axis nudges; save and reload; verify original model remains unchanged, Manual routing/Cables/PathFinder regressions pass, no broken frame sessions.
**10.5. Export:** Download MTO CSV and exact STEP, re-import STEP in independent CAD tool, compare 3D part placements and solid count, validate units/manifest. Mechanical fit/coupler clearance requires independent engineering validation. DWG 2D section is a **separate future feature**, not misrepresented as STEP export.

**Gate 10:** Real Aalborg end-to-end video/screenshots, healthy Docker logs, no errors, original storage untouched, downloadable client CAD and MTO match on-screen saved design. Fail the PoC if not.

## Known limitations / stop conditions

- Local Docker access was verified during the Materials continuation; disposable database/worker tests are distinct from application deployment.
- Automatic mesh display depends on the Scene API runtime behavior under the pinned Viewer 7.130.0. Dynamic model coexistence and coordinate offset must be visually tested.
- The interactive mouse gizmo (draggable axis handles) is **not implemented**; pick point, numeric input and axis nudges are.
- Snap currently supports these two verified assets, not arbitrary Niedax catalogs; exact manufacturer connectors, spacing/clearances and collision checking are unverified.
- STEP assembly and MTO endpoints exist; a combined PDF/ZIP customer handover and true 2D DWG export are not implemented in this PoC.
- Database triggers block motion of connected instances until explicit disconnect.
- Do not tag code as production-ready or merge main while gates 8-10 are incomplete.
