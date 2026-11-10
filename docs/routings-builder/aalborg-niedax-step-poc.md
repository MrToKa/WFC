# Aalborg Niedax STEP — Routings Builder POC

Status: **Implementation plan / NOT YET ACCEPTED**. This document describes a staged, safe implementation for the existing WFC repository. No claims that Viewer-side placement, export, migration, or deployment are already complete.

## Mission and constraints

Build an independent, editable proposed cable tray assembly on top of the existing **Aalborg** imported SVF in **Routings builder** (the existing `routings-viewer` URL/tab identifier remains stable).

Authoring interaction:
1. Select STEP catalogue item, one at a time.
2. Place it at an approximate location in the loaded SVF scene, with a preview/ghost.
3. Translate along world or local X/Y/Z with manipulators, or type absolute XYZ in **mm**; enter delta movement and 3-axis rotation.
4. Explicit **Save** commits to the development project. Keep dirty drafts local and reversible.
5. Place another component with geometry snap and **connector-port snap** to the previous component, then save.
6. Reload WFC and re-open Aalborg: position/orientation/snap connection persist without modifying source SVF.
7. Produce a client delivery package: exact CAD STEP of the added assembly, itemized MTO, coordinates, model reference and optionally 2D drawing/PDF preview. STEP first; DWG requires separate licensed converter and geometry projection.

Non-goals: editing or overwriting SVF; publishing to production; automatically choosing trays, fully automatic cable routing, claiming an AVEVA import method without client-side validation.

## Inspected repository baseline

- `MrToKa/WFC` default branch `main`.
- React + TypeScript + Fluent UI in `src/pages/ProjectDetails.tsx` and `src/pages/ProjectDetails/RoutingsViewerTab.tsx`.
- Node/Express TypeScript backend under `server`; **not a .NET WFC API**.
- Viewer 7.130.0 in a sandboxed iframe `viewer-runtime/`, with `ViewerController.ts`, `protocol.mjs`, secure same-origin session/request boundaries.
- `Routings viewer` was a read-only route display with Manual routing/Cables; leave that functionality working. New Builder is a distinct editing mode, not a replacement for routing display.
- Current `docker-compose.yml` has fixed container names `wfc-postgres`, `wfc-minio`, `wfc-api`, `wfc-web`. **DO NOT run this unchanged for a second dev stack.**
- Historical Aalborg app notes describe `docker-compose.app.yml`, `http://127.0.0.1:5180`, and separate frontend/backend; verify current Docker state, mount references, model and database identities before acting.

## Inspected STEP inputs (Open CASCADE / cadquery)

| File | Format | Exact solids | Faces | Local bounding box / mm |
|---|---|---:|---:|---|
| `NDX_KLBK_60-303_MED_214.step` | STEP AP214, SolidWorks 2019 | 1 | 152 | X -645..300, Y 0..60, Z -945..0 |
| `NDX_KL_60-303_F_MED_214.step` | STEP AP214, SolidWorks 2019 | 1 | 340 | X -150..150, Y 0..60, Z 0..6000 |

Observed sizes: curved component 945 × 60 × 945 mm; straight component 300 × 60 × 6000 mm. These are **bounding-box extents**, not verified connector positions or vendor-approved joining dimensions. Do not infer connection ports directly from bounding boxes. Preserve exact source binaries and SHA-256; don't check manufacturer STEP binaries into public Git without redistribution permission.

## Safety gate 0 — isolate Aalborg development

1. Verify actual repository/head/working tree, stash or preserve existing uncommitted work without overwriting it. Work from `feature/aalborg-step-routings-builder-poc-20261110`; never checkout/merge/reset production main in place.
2. Identify exact Docker context, compose project, service names, networks, bind mounts, volume IDs and listening ports. Record `docker context ls`, `docker compose ls`, `docker ps --format ...`, `docker inspect`, `docker volume ls` and image IDs **without credentials**.
3. Verify Aalborg project UUID and active `modelVersionId` from WFC's authoritative `GET /api/projects/:projectId/model-versions`, and prove that the model package is present, loads in the protected viewer and matches the intended Aalborg test project.
4. Export database and MinIO backups; verify backup manifests and ability to read them. Take a copy of dev Postgres/MinIO data when feasible. Never share or overwrite production storage.
5. Use separate compose project, no fixed names overlapping `wfc-*`, separate named volumes and networks, e.g. `wfc-aalborg-poc`. Prefer loopback-only ports (web 5181, API internal, Postgres/MinIO unexposed). Do not reuse `docker-compose.yml` as-is.
6. Any existing Aalborg containers: inspect first. If they are still serving known data, do not destroy them. Rebuild only isolated dev app images. Never `docker system prune`, `compose down -v`, or delete a volume as cleanup.
7. Disable automatic pull/deploy to the POC stack; use explicit git SHA image tags for reproducibility. Keep a rollback image and backup.

**Gate:** Production container IDs/volumes unchanged; Aalborg still opens; baseline app health and current route flows pass.

## Stage 1 — catalogue storage and import

- Add an admin-authorized catalogue import endpoint for STEP, restricted to project/tenant or global engineering catalog according to established WFC permissions.
- Enforce content size, extension/signature/header checks, SHA-256, safe filename, upload streaming, timeouts, resource limits and idempotency. No code or untrusted external assets execute in the browser.
- Store original STEP in a dedicated MinIO prefix of the **existing approved bucket**, do not change buckets; metadata in PostgreSQL.
- Convert STEP to a *visualization-only mesh* using a separate isolated OCCT/CadQuery process with CPU/memory/time and filesystem restrictions. GLB is a useful portable intermediate; Scene API dynamic model format must be verified with this Viewer 7.130.0 runtime.
- Store tessellation units (mm), local origin, triangle count, bounding box, normals and geometry content hash. Preserve exact CAD source for STEP assembly export.
- Catalogue metadata: manufacturer, part number, catalogue revision, family, nominal dimensions, source filename/hash, approved origin, local CAD coordinate system, optional preview mesh and user-provided compatibility notes.
- Two initial catalogue items only; catalogue entries are reusable, instances are per-project.

**Gate:** Both STEP inputs import, source checksums survive round trip, preview geometry displays, re-import is idempotent, and no user can read another project's source.

## Stage 2 — secure Viewer bridge

- Existing `viewer-runtime` iframe is intentionally protected. **Do not expose raw Viewer global to parent React.**
- Extend `viewer-runtime/protocol.mjs`, its TS declarations, `ViewerController.ts`, bridge/runtime dispatch and both contract tests with strictly bounded commands:
  - `ADD_DESIGN_PREVIEW` {operationId, catalogueItemId, meshRef, transform, modelVersionId}
  - `UPDATE_DESIGN_PREVIEW` {operationId, instanceId, transform}
  - `REMOVE_DESIGN_PREVIEW` {operationId, instanceId}
  - `SET_DESIGN_SELECTION` {instanceId|null}
  - `PICK_DESIGN_POINT` {requestId, pickMode}
  - `DESIGN_PICK_RESULT` {requestId, point, normal?, objectId?, source, coordinateFrame}
  - `DESIGN_COMMAND_RESULT` {operationId, status, errorCode?}
- Names are **proposal**, adapt to existing protocol conventions after reading entire adapter and tests.
- Validate UUID ownership, exact project/model/session/generation, same-origin window, types, byte budgets, finite coordinates/rotation, limits and expiry; reject stale requests. No arbitrary URL fetch, script, untrusted file access or unrestricted material/text injection.
- Ensure mode-switch doesn't reload iframe or regress Manual routing/Cables, PathFinder rendering/opacity/fences or logout cleanup.
- Geometry placement via **Scene API feature detection**; if SDK 7.130.0 does not support required dynamic mesh lifecycle, use a *narrow, isolated* Viewer 7 overlay fallback with tests, not undocumented global shortcuts in React.

**Gate:** Two components appear in the same scene as client SVF; picking and transform commands work in a real browser and stay scoped to the current project/model.

## Stage 3 — editor interaction

- Add a third left-panel mode `Components` while preserving `Manual routing` and `Cables`. Rename only visible outer tab to **Routings builder**; retain URL identifier `routings-viewer` to avoid breaking bookmarks.
- Catalogue list with search, product metadata and STEP preview.
- `Place` enters a translucent ghost state; on canvas click pick support point; `Esc` cancels; initial placement never silently commits.
- `Move` along world/local X,Y,Z via gizmo. Exact numeric inputs in mm; relative delta controls; rotation inputs in degrees but store normalized quaternion.
- Keep state machine explicit: idle → preview → dirty → saving → saved/error. Undo/redo for unsaved transformations. Disable save while model identity changes and discard stale preview.
- Use immutable source CAD frame → model world mm → Viewer rendering frame conversion. Never store camera-relative pixels, raw matrix from one runtime or only a dbId.

**Gate:** Position placement error ≤1 mm and orientation error ≤0.1° for test objects (unless original SVF precision is worse; measure and report); changes persist after reload.

## Stage 4 — Object Snap

Two mechanisms, explicitly separated:

1. **Geometry Snap**: Viewer pick vertices/edges/faces on approved client SVF or proposed meshes, screen-distance threshold, face normal and projection; filter hidden/non-selectable; no promise that legacy Snapper supports dynamic Scene API objects without test.
2. **Connector Snap**: author manually verified local connector frames per catalogue item: `connectorId`, position mm, tangent/normal/up unit vectors, port gender/type, nominal compatible size, assembly offset/clearance and eligible mating types.

Geometry:
- Each placed item has rigid transform `T_world_component`.
- A local connector has transform `T_component_connector`.
- For target port A and source port B, compute candidate `T_world_B = T_world_A * T_A_connector * T_mate * inverse(T_B_connector)`.
- `T_mate` expresses mating orientation (typically opposing face normals, with agreed roll) and required gap. Quantize only display, not stored transform.
- Show preview and compatibility reason; never auto-join unrelated profiles. Record separate connection graph edge with both instance IDs and port IDs, preserving ability to disconnect.

**Gate:** Straight + bend snap at an explicitly validated connector pair, correct orientation and clearance; 3D separation ≤1 mm, reproducible after reload; reject incompatible geometry.

## Stage 5 — persistence / authorization / model revision

Suggested schema (adapt to existing conventions/migrations):
- `cad_catalog_items(id, manufacturer, part_number, family, source_sha256, step_object_key, mesh_object_key, source_units, bbox_json, metadata_json, created_by, ...)`.
- `cad_catalog_ports(id, catalog_item_id, name, local_translation_mm, local_quaternion, port_type, compatible_family, ...)`.
- `project_cad_designs(id, project_id, source_model_version_id, name, status, revision, created_by, ...)`.
- `project_cad_instances(id, design_id, catalog_item_id, translation_x_mm, translation_y_mm, translation_z_mm, rotation_quaternion, object_revision, ...)`.
- `project_cad_connections(id, design_id, source_instance_id, source_port_id, target_instance_id, target_port_id, ...)`.

- Server authorization at project scope for every write/read; no trusting client item IDs or transforms alone.
- Optimistic concurrency with ETag/revision, idempotency key, DB transaction on instance save + connection updates, rejection of stale model revision, audit trail. Use parameterized SQL and foreign keys with project-aware ownership.
- Don't modify original SVF package or canonical model selection. If the client model revision changes, mark the proposal **requires revalidation**, not silently transfer it to a different coordinate frame.
- Store authoritative WFC world coordinates in mm + unambiguous coordinate frame metadata. Retain model's unit/placement/globalOffset conversion and test with reference points.

**Gate:** Full browser reload restores exact placements/joins; user B cannot alter a project they don't own; stale writes fail predictably; rollback migration tested on dev copy.

## Stage 6 — client delivery

Package `Aalborg-Proposed-Cable-Tray-<revision>.zip`:
1. `assembly.step`: exact source B-Rep parts transformed via OCCT (rigid placements, source geometry not rewritten as a tessellated approximation). Preserve original CAD and part labels where supported.
2. `materials.xlsx` or `materials.csv`: part number, manufacturer, dimensions, qty, cut-length flags (if any), unit, design revision, assembly references. Don't count connectors/couplers unless actually modelled and recorded.
3. `placements.csv`: instance ID, catalogue source checksum, global XYZ mm, quaternion/rotations, joined ports, model revision and coordinate frame.
4. `manifest.json`: project, source model version, design revision, generation timestamp, file checksums, units, acceptance/disclaimer, tool version.
5. Optional model screenshots + PDF proposal; separate 2D DXF section/sheet only if a proven vector sectioning pipeline is implemented. **Do not label DXF as DWG.** DWG needs licensed conversion and verification.

Server-side async export job in isolated OCCT worker, bounded by project access and cost limits, no arbitrary paths. Verify exported STEP by re-importing with Open CASCADE and checking solid count, transforms, size, individual parts and nonempty shapes.

**Gate:** Exported STEP opens in independent CAD reader with both parts in requested positions; CSV/MTO match saved design counts; archive hashes, revision and units are correct. Client AVEVA acceptance is a separate external gate.

## Stage 7 — test/acceptance matrix

- **Unit:** mm↔Viewer units, globalOffset/placement, rigid/quaternion math, connector inversion, zero/negative/NaN/overflow, collision of ids, stale versions.
- **Protocol:** malformed JSON, forged origin/source, wrong session/uuid, payload over budgets, cancellation, logout, reload, model switch, replay, cross-project references.
- **Backend integration:** cross-project 403/404, unauthorized 401, stale optimistic lock 409, duplicate POST retries, file hash mismatch, corrupted/oversized STEP, transaction rollback, MinIO unavailable.
- **CAD:** both AP214 files, units and bounding boxes; open exported STEP and compare independent B-Rep geometry, zero mesh-only export fallback.
- **UI:** first/second part, direct coordinates and gizmo, snap to correct ports, undo, save, refresh, viewer reconnect, dark/light theme, keyboard accessibility.
- **Regression:** original `Routings builder` Manual routing/Cables and PathFinder unchanged. Run `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`, viewer-runtime Node tests and Docker health probes; capture actual results.
- **E2E:** run Aalborg test project end-to-end, verify no browser console errors/CSP violations, no external SDK requests, and no modifications to production data.

## Deployment, operational acceptance, rollback

- POC dev only; deploy a versioned image from new branch after passing tests, compare image IDs before/after. Explicit fresh dev containers and separate DB/MinIO or independently copied dev dataset. Never copy production secrets into Git.
- Verify `/health`, Viewer model load, both component previews, Save→reload, Connector Snap, STEP assembly export and MTO, and app logs. Record screenshots plus source SHA/image digest.
- Rollback = stop only POC app services, run previous image tag, restore dev DB/MinIO together from matching backup when migrations change data. Preserve originals and service identities; no global Docker restart.
- **STOP CONDITIONS**: uncertain container or volume ownership, missing backup, failed model identity check, unexpected cross-project access, changed original SVF asset, unexplained coordinate discrepancy, invalid STEP export.

## Work packages / implementation sequence

A. Baseline + safe environment inventory + dev backup (no writes to existing production).
B. UI rename (in the branch) and zero-regression tests.
C. Catalogue schema/upload and two-file OCCT import.
D. Protected Viewer scene preview + strict bridge contract.
E. Position UI, world/local transforms, Save/reload.
F. Verified connector coordinate frames + Snap.
G. Exact B-Rep assembly STEP export + material list and manifest.
H. Comprehensive browser, container, security, regression, rollback acceptance.

**PoC is only complete after A–H are tested on the real Aalborg dataset.** UI rename or branch creation alone does not constitute a working prototype.
