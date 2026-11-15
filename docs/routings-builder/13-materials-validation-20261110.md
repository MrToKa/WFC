# Local Materials continuation validation — 2026-11-10

Branch: `feature/aalborg-step-routings-builder-poc-20261110`.
Starting remote commit: `9bd41fa`. Node 24.19.0, npm 11.17.0, Docker Engine 29.9.1.

## Verified locally

| Check | Evidence |
| --- | --- |
| TypeScript | Frontend/server `npm run typecheck` passed |
| Lint | Full `npm run lint` passed after concurrent edits finished |
| Backend build | `npm run server:build` passed, including deployed contract closure/copy checks |
| Frontend build | `npm run build` passed; repeated with `VITE_CAD_DESIGN_ENABLED=true` passed |
| API/UI/security/CAD regressions | 166 tests across 13 files covered; initial run 164 passed, two stale ProjectAccess fixtures failed; fixture correction followed by full ProjectAccess rerun: 56/56 passed |
| Materials navigation/flag | 3 passed, 14 unrelated table tests explicitly deselected |
| Viewer module deployment/protocol/scene | 10 Node tests passed; includes world-mm conversion and original SVF isolation |
| Compose | `docker compose -f compose.poc.yaml -p wfc-aalborg-poc config --quiet` passed with synthetic settings |
| PostgreSQL 18 | Dedicated disposable `wfc_material_cad_test`, random schema: migration/repeatability, old missing columns, asset backfill, material canaries, SKU separation, immutable pins and source revisions, manufacturer synchronization |
| CAD worker | Built isolated converter image; offline generated-box assembly/readback passed (two solids) |

New regression files cover administrator denial, strict metadata/SKU boundaries, missing
asset, historical revision listing, revision reuse, object cleanup after partial failure,
duplicate publication, independent fitting creation, file-size rejection, revision-history
race, stale builder submission after model closure, and startup isolation refusal.

The original ProjectAccess fixtures returned only `{trays:[]}` and used an invalid
`tray-id`. Current drawing APIs require coherent metrics and hash-verified snapshots.
Only those test fixtures changed; permission assertions and production policies remain.

One Windows build invocation generated its complete output then failed during Node
shutdown with `UV_HANDLE_CLOSING`. A repeated normal build and the CAD-enabled build
both exited successfully. Vite's existing large-chunk warning remains.

The full legacy Materials table/filter/return-state suite was attempted and cancelled
after several minutes of synchronous Fluent DOM queries. It is **not claimed passed**.
Its navigation/feature-gate subset and the new component tests passed. The entire WFC
test suite, application Docker images and real browser acceptance were not run here.

## Actual manufacturer sample checks

Read-only input files from the user's Downloads directory; no proprietary STEP files
were added to Git. Worker ran without network, with read-only root filesystem and
bounded memory/CPU/tmpfs. Converter image ID:
`sha256:3c713059046ef5b95777674f89d9c45c4e41dfbd9454eae145b21cbb10258e91`.

| Sample | Bytes | Solids | Mesh triangles | Bounds mm |
| --- | ---: | ---: | ---: | --- |
| NDX_KL_60-303_F_MED_214.step | 823845 | 1 | 1440 | (-150,0,0) to (150,60,6000) |
| NDX_KLBK_60-303_MED_214.step | 351893 | 1 | 1460 | (-645,0,-945) to (300,60,0) |

SHA-256 straight: `d381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd`.
SHA-256 bend: `7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014`.
Combined exported STEP: 1,863,635 bytes, reopened as two solids.
This validates conversion/export, not visual placement or mechanical fit.

## Isolation and remaining work

No application startup, restore or deployment was performed. The production-like
frontend still answered HTTP 200 on 5180. Its frontend/backend/PostgreSQL/MinIO containers
retained start times `2026-11-10T16:26:41Z`, restart count zero. The `main` checkout was
read only. No commands accessed its database records or storage objects.

The only new database container was dedicated to disposable tests, with tmpfs storage
and a randomly allocated loopback port. It is removed after verification. Existing
containers, networks and volumes are not stopped, restarted or removed.

Next execution plan: (1) observe the updated branch CI; (2) prepare and verify a coherent
Aalborg restore into dedicated PoC stores; (3) build/start isolated 5181 only after the
restore gate; (4) test authenticated catalogue persistence and real SVF scene placement,
refresh, connectors and STEP/MTO readback. No catalogue SKUs or connector frames are
invented to bypass missing manufacturer information. See the preceding architecture
document for API and migration limits.
