# Ordinary application CAD activation — 2026-11-15

## Accepted goal
User explicitly requests tray drawing inside the existing 3D model in the ordinary application, with both local ports5180 and5181 running all recent main functionality. Baseline main e788284 contains merged routing controls, Preparer and CAD design. Prototype startup requires wfc_poc DB/storage and flags; remove those prototype restrictions while retaining authentication, project edit/admin checks, STEP/mesh limits and private converter boundary. No new model or database clone is required.

## Execution stages
1. Inventory both actual app/DB/storage bindings; pin old images and take valid custom PostgreSQL dumps. Compare existing business columns/rows before and after additive migration.
2. Make CAD ordinary/default-on with explicit-off support; central private converter configuration; retain validated geometry/connector authority. Keep Manual routing/Cables, add Draw trays in the same persistent viewer, preserve draft/mesh state across mode switches and revoke on model/account/permission changes.
3. Configure private nonroot read-only constrained converter service on each existing network, no exposed converter ports. Preserve JWT, DB/storage credentials/origins/volumes. Add5180persistent Pathfinder volume only after checking no prior files are hidden.
4. Build current main once, deploy5181 and verify source-data retention, then deploy identical app images5180. No volume deletion or DB restore/clone. Test actual STEP conversion, cut and assembly readback.
5. Use real existing Niedax KL60.303F material and approved manufacturer STEP files (source hashes checked), ordinary authenticated Materials/catalog APIs. Do not fabricate profiles or bypass qualified geometry guards. Test actual placement/movement/named draftroute/STEP export in the selected model; do not publish validation routes to project Trays/routingnetwork. Remove only owned validation groups/instances after checking IDs and revisions; retain useful Materials assets/catalog/workspaces.
6. Verify both applications in the built-in browser, existing cable-list execution columns, saved-location display and stored route Show. Fix any real integration regression with scoped evidence/tests; no renewed automatic calculation/write authorization merely for viewing an old result.
7. Final source/type/build/scoped regression checks, restart/idempotence/current source-data comparison, exact image/commit/evidence report. Existing local data differences remain; functional version is common. No push or public deployment.

## Ownership
Root: deployment/compose, credentials kept private, actual browser and overall acceptance. Frontend worker: ordinary UI and saved-result display integration; backend worker: configuration/converter/startup and updater rollback; ops worker: backup/business baseline, normal authenticated Materials bootstrap and owned API acceptance/cleanup. Separate non-overlapping writers; coordinate shared contracts.

## Evidence and completion
D:/WFC-Test/validation/ordinary-cad-20261115 contains private runtime environment files (not commit material), backup-manifest.json, baseline-before.json, reusable snapshot-runtime.mjs and comparison snapshots. Before:5180wfc_app4projects2600cables412trays;5181wfc_restored_20261113 5projects3825cables503trays. Old images pinned wfc-rollback/{api,web}-{5180,5181}:before-ordinary-cad-20261115. Completion requires both ports healthy, real same-model CAD placement/export proven, validation geometry removed, original business data preserved, existing routing viewer functions retained and accurate remaining limitations reported.
