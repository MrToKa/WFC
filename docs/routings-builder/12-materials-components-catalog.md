# Materials components and pinned STEP revisions

Continuation on `feature/aalborg-step-routings-builder-poc-20261110`, 2026-11-10.
Supersedes the tray-attachment design in commits 8ea4d92–9bd41fa.

## Completed stages

1. Reviewed previous startup/mount/schema changes. Fixed the existing-table migration
   gap: install reference columns before indexes, including databases predating Materials CAD.
2. Implemented global `material_product_families` → `material_components` →
   `material_component_cad_assets`. Each component has an independent kind and SKU.
   Trimmed, case-insensitive SKU identity is unique within a manufacturer across families.
   Different SKUs may intentionally share identical CAD geometry.
3. Added feature-gated Materials → Components: family/component creation, part number,
   kind, name, optional millimetre dimensions, search/filter, STEP upload/history/download.
4. Replaced project STEP uploads with the shared Materials picker. Project catalogue
   rows are immutable revision references/snapshots, rather than another product master.
   New placements require a linked revision and an editable proposed design on the active
   healthy model. Existing instances never follow a newly uploaded active revision.
5. Added PostgreSQL/API/UI/isolation regressions to the existing PoC workflow. Fixed
   the preceding implementation's missing `cad-scene.mjs` deployment inventory entry,
   which prevented frontend compilation.

## Migration and preservation

Materials migration is transactional, advisory-lock protected and repeatable. Existing
tray prices, curves and images remain untouched. `material_trays.tray_type` is the
available straight-product identifier; this schema has no separate straight SKU field.
Each existing tray becomes a linked `straight` component retaining its UUID, in a
labelled `Imported tray: …` family. Missing manufacturer becomes `Unspecified`.
These are import labels, not inferred manufacturer families. Administrators can add
real fitting SKUs to the corresponding family; no fitting catalogue numbers are invented.

Only straight components can link a tray record. Legacy CAD attachments with another
SKU become separate components, preserving asset UUIDs, revisions, hashes and storage
keys. Ambiguous kind/normalized-SKU conflicts fail the transaction for review instead
of merging products. Existing tray edits synchronize their straight component.

The old attachment table remains compatibility data: old downloads work; old list/upload
endpoint returns 410 and the canonical API path. Existing unlinked project uploads remain
readable for old instances but cannot create new placements. Old Materials references
are backfilled to the canonical revision FK. No source objects are copied or deleted.

CAD revisions cannot be deleted or edited; only active state may change. New STEP bytes
publish a new revision under the component row lock. Uploading the active hash again
reuses its UUID. Partial upload failures attempt cleanup of both generated object keys.
This increment exposes no product/revision deletion or general metadata reassignment API.

## API and permissions

Materials inherits authentication, existing catalogue permissions and audit actor context.
Admins write; permitted catalogue readers inspect/download. Project selection requires
project edit permission. The server derives all reference metadata and storage keys.

| Method | Path | Payload/result |
| --- | --- | --- |
| GET/POST | `/api/materials/components/families` | `{families}` / `{manufacturer,name}` |
| GET/POST | `/api/materials/components` | `{components}` / `{familyId,partNumber,componentKind,name,widthMm?,heightMm?,lengthMm?}` |
| GET | `/api/materials/components/:componentId/cad-assets` | All revisions, including inactive history |
| POST | same | Single multipart `file`, without product metadata |
| GET | `/api/materials/components/:componentId/cad-assets/:assetId/download` | Authenticated STEP bytes |
| POST | `/api/projects/:projectId/cad-design/catalog` | Strict JSON `{assetId}`, active revision only |

Component filters: `familyId`, `componentKind`. Kinds: straight, bend, tee, reducer,
connector, accessory, other. MTO identifies kind, CAD asset and revision. Historical
project references remain usable at their pinned revision; retired revisions cannot be
newly selected into another project.

STEP input is limited to 8 MiB and validated before isolated conversion. Mesh output
remains bounded to 20,000 triangles, verified millimetre units and finite coordinates.
Unknown geometry may be placed but gets no invented ports. Connector snap remains
restricted to the two SHA-verified samples. Physical fit, capacity and clearances are
not certified by CAD conversion.

## Isolation and verification

CAD remains disabled by default. Enabled startup checks isolation before ordinary WFC
database/storage initialization: `WFC_CAD_ISOLATED_STACK=true`, Compose PostgreSQL
host/role/database `postgres` / `wfc_poc` / `wfc_poc`, MinIO `minio:9000`, and buckets
`wfc-poc-project-files`, `wfc-poc-template-files`, `wfc-poc-models`. Compose supplies
these settings. A prior PoC restore using older bucket names requires a reviewed restore
into these isolated buckets; never point this branch at the existing 5180 stores.

`WFC_MATERIAL_CAD_TEST_DATABASE_URL` enables the real migration test and must name
`/wfc_material_cad_test`. It creates/drops only a random owned schema, and never falls
back to `DATABASE_URL`. CI supplies an independent PostgreSQL 18 service. Local
`validate-poc.ps1` skips this test unless that URL is supplied; skipped is not validated.

`scripts/poc/validate-sample-step.py` reads two read-only-mounted sample paths inside
the converter image, checks meshes, exports an assembly and reopens it. Proprietary
samples are not committed or fetched by CI.

## Next acceptance stages

After static/database/worker checks, restore Aalborg coherently into independent PoC
stores using the model-aware backup procedure. Do not hot-copy live storage or migrate
the existing WFC database. Then start only isolated Compose on 5181 and verify catalogue
persistence, real Viewer placement/scale/orientation, refresh, connectors and STEP/MTO
against its restored active SVF. No `main` merge or 5180 deployment is included here.
Arbitrary connector definitions, mechanical validation and 2D DWG section export remain
outstanding work.
