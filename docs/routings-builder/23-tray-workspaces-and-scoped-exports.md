# Tray selection, New tray and scoped exports

The Routings builder has an explicit New tray action. It opens the shared Materials STEP revision selector and the placement tools. Saved CAD meshes remain loaded while the controls open or close.

Selecting a saved complete tray shows only that tray's component list above its route properties. Selecting a component opens its placement editor. The list selection does not remove other trays from the 3D model. New tray starts a separate draft using unassigned components; newly saved placements are selected for that draft. Switching to another saved tray preserves placed components and their source revisions.

Four export actions distinguish the saved selected tray from all saved placements:

- Selected tray STEP assembly.
- Selected tray materials list (CSV).
- All placements STEP assembly.
- All placements materials list (CSV).

The selected-tray exports use authoritative saved membership, independent of visible meshes, temporary checkbox edits or request-supplied component identities. All-placement exports include unassigned saved components. Unsaved values are not fabricated into deliverables.

## API and source provenance

Existing design endpoints support optional routeId:

- GET /api/projects/:projectId/cad-design/designs/:designId/assembly.step?routeId=:routeId
- GET /api/projects/:projectId/cad-design/designs/:designId/materials.csv?routeId=:routeId

Omit routeId to export the complete saved proposal. Invalid or repeated route selectors are refused. An unknown or foreign route never falls back to the full proposal.

The server captures a coherent read-only snapshot of the scoped design, group, members, source files, revisions, cut lengths and transforms. CSV quantities are derived from those captured instances. STEP generation retains the isolated kernel and exact straight cutting, then checks saved source state again before delivering the output. Route names are sanitized only for download filenames. Snapshot revision and scope headers identify the actual export.

STEP retains the existing safety limit of 32 component placements per assembly and bounded source/output sizes. Exceeding it returns an explicit error without silently omitting parts. CSV remains available for larger saved scopes. Materials and source STEP files are not changed by export. Installation routing transitions contribute no invented STEP fitting or material SKU.

## Validation

Coverage includes two saved routes plus an unassigned component, correct scope isolation, all-placement completeness, malformed/foreign selectors, coherent revisions, cut-length and CAD revision retention, empty and oversized assemblies, and changes during conversion. UI checks cover New tray, filtered saved-tray lists, draft membership and all four export actions. Real exported files are independently inspected in an offline CAD container when local Docker is available.

## Deployed acceptance — 2026-11-11

Only the isolated 5181 API/web were updated. Actual browser checks confirmed the initially collapsed workspace, New tray opening the Materials/STEP/placement controls, cancellation preserving all five saved meshes, and BC182 selection showing its five members above the route controls. All four export buttons were present. The selected materials button downloaded BC182-materials.csv successfully through the browser.

Four actual server downloads were captured against design revision 134, with BC182 route revision 5. Full design, route-group and instance responses before/after were identical. Selected headers identified the saved route; whole-proposal headers identified proposal scope. The live proposal currently contains one five-member group, so the selected and all-placement scopes correctly contain the same five parts. Separation of multiple groups and unassigned parts is exercised by automated fixtures rather than by changing user data.

Independent offline CadQuery/OCCT readback validated both STEP files: five valid solids each, matching two 6000 mm straights, exact 3750 mm and 1000 mm cuts, and the supplied bend at their saved world transforms. All ten body comparisons had zero symmetric volume difference; maximum bounding/centre errors were below 7e-9 mm. Both CSVs had four inventory rows totaling five components, with the correct Materials CAD asset/revision, source hash, SKU, cut lengths and quantities. Straight-stock length totals were 16.75 m; the bend is a separate component, and logical routing transitions add no invented material part. Source copies and downloaded file hashes were unchanged.

Acceptance helpers, source copies and generated exports live under ignored .data/tray-export-acceptance. Uploaded/reference source files were not edited. The existing 5180 stack and main were not targeted.

Validation completed: 22 scoped export tests, 23 existing cut/length tests, 33 panel/workflow tests and 39 cut/viewer regression tests passed (117 total). Full frontend/server typecheck, repository lint and API/web Docker builds passed. A final draft-membership cleanup excludes deleted or already assigned automatic IDs and is covered by the panel suite. Its final web build was deployed to 5181; API export behavior and the independently verified artifacts were unchanged.
