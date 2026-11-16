# Niedax straight length support — 2026-11-16

All 30 original STEP files supplied in the user's `Downloads/Niedax step` folder
are supported for per-instance cut lengths from 1 to 6000 mm. This includes
KL 60-high profiles, widths 200/300/400/500/600, in plain/F/E3/E5 variants, and
KL 100-high profiles at those widths in plain/F variants. The shared registry
matches both original filename and SHA-256; arbitrary renamed or modified
geometry does not inherit cutting support.

Every source was independently imported with CadQuery/OCCT: one valid solid,
local Z extent 0–6000 mm, X centered at zero, Y extent 0–60 or 0–100 mm.
All 30 passed actual 1500 mm B-Rep cuts and mesh conversion. Five initially
supplied samples additionally passed 1, 1000 and 5999.5 mm cuts. The cutter
intersects the original geometry and preserves profile and rung pitch.

The browser and API recognize all sources. Startup replaces the database guard
using the same source registry and adds missing connector anchors to existing
straight catalog references. Existing port IDs, saved lengths and connections
are preserved. Physical mating, publication centerlines, Materials validation
and tray exports use the measured profile dimensions. Connected instances still
require disconnection before resizing.

## Evidence and reproduction

[`evidence/niedax-straights-20261116`](evidence/niedax-straights-20261116)
contains the independent measured registry and JSONL results for all 30 sources.
`measure-all.py` reads a JSON array of `{filename,data}` on standard input, where
`data` is base64 of the original file. It runs in the CAD worker environment and
imports `/app/converter.py`. No original STEP files are distributed in this report.

Measured worker image: `sha256:3793ecf7d080c65b3718a803d75a7a9245db3b89cf6873ab68badc3ab7ec1061`.
Worker source SHA-256: `abeab9ae55b60d42c5bc648fee58798f6abc4373e306a95a68a39e2714489519`.

The isolated PostgreSQL tests exercise all 30 allowed sources, 60 measured ports,
repeated startup, preserved port IDs and connections, and rejected crossed
filename/hash identities and mislabeled fittings. Run explicitly with
`WFC_CAD_STRAIGHT_POSTGRES_TESTS=1` and
`npx vitest run server/cadDesign/straightSourcesSchema.test.ts` using a locally
available `postgres:16-alpine` image; the test creates and removes its own
disposable container with no application volumes.

Validation completed: 221 backend/shared tests, 16 placement UI tests, 3 isolated
source-migration database tests, and 20 existing database migration/lifecycle
tests passed. Frontend/server typechecks and changed-file lint passed. Browser
production build and compiled backend runtime packaging passed; an obsolete
generated verifier cache was quarantined and rebuilt from the pinned source.
UI tests used a 15-second per-test limit on this workstation after a five-second
timeout during the concurrent first run. No running application was deployed
or modified as part of these checks.

## Release

Both browser and backend must be updated together. The backend startup installs
the expanded database guard and backfills existing catalog references. No
re-upload of unchanged original files is necessary. This source change alone
does not update the separate installation shown at `192.168.5.55:5173`.
