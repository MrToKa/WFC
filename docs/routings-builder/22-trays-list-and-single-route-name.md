# Route names and Add to trays list

The complete-route form has one Route name field. It is the route identifier and the name used in the ordinary project Trays list. New identifiers use letters, digits, dot, underscore or hyphen and are normalized to uppercase. The internal tag is derived automatically. Existing legacy records and old explicit-tag API clients remain compatible; reading or recoloring them does not rename their saved data.

After saving a connected route, **Add to trays list** creates its ordinary project tray row. A prepared Path Finder network is not required for this action. This is separate from publishing verified routing geometry into a prepared network.

The saved row uses:

- Name: the saved Route name.
- Type: the first placed straight component's part number; if there is no straight component, the first placed component's part number. Placement order is deterministic (creation time, then identity).
- Purpose: the route's selected Purpose.
- Width and height: the verified source profile.
- Length: the actual route centreline, including source-specific bend arcs and admitted installation-transition distances. No sum of catalogue stock lengths or stretched STEP geometry is used.

Length is stored as auto-calculated, with CAD source references and a centreline fingerprint. This stored proof cannot be submitted as a forged ordinary auto-length request. Editing other tray properties retains the saved proof; explicitly entering a manual length follows the existing manual-length behavior.

Repeat clicks reuse the same linked tray row. After changing a draft route, save it and use Add to trays list again to refresh that row. An unrelated tray with the same name is not overwritten. Manual edits to a linked tray row require review before export can replace its projection. The project Trays list refreshes after a successful export.

An exported row and a later routing publication share the same tray identity. Withdrawal removes the routing overlay while retaining an independently exported Trays list row. All source and prepared-network proof checks remain enforced.

The export endpoint remains inside the isolated CAD PoC permission boundary and validates the saved group revision, complete canonical membership and connected centreline. Existing application services on 5180 and main are outside this change.

## Local acceptance — 2026-11-11

The isolated API/web were rebuilt and deployed only to the PoC stack on 5181. Browser acceptance confirmed the single Route name field and used Add to trays list for BC182. The ordinary Trays tab showed:

- Name BC182; type KL 60.303 F.
- Purpose LV and I and C cable tray.
- Auto-calculated centreline length 18412.06154085574 mm (18.41206154085574 m), displayed as 18412.062 mm.

The complete component-instance and group responses were identical before/after. A second export reused the same tray identity, preserved the row exactly and created no duplicate. No Path Finder preparation was needed to add the ordinary row. This does not claim the route was published into a prepared network. Main and the existing 5180 stack/data were not targeted.

An export created after a network publication is retained on withdrawal; because that row was absent from the original prepared base, the old preparation then correctly becomes stale. An export that was already part of the prepared base remains in that base projection through publication and withdrawal. Base artifacts are never restamped to hide a catalog change.

Stored CAD lengths retain their exact numeric value when ordinary tray metadata is edited. Read-only CAD provenance is accepted by the public row mapper but rejected as a client-supplied capture/reference request.

Validation passed: full frontend/server typecheck and repository lint; Docker API/web builds; 13 export tests, 21 publication HTTP tests, 13 overlay tests, 26 group contract tests, 20 real PostgreSQL lifecycle tests, 75 length/form/panel/validator tests and 58 surrounding picker/placement/viewer/data-request regression tests. Existing approved centreline publication tests also passed.
