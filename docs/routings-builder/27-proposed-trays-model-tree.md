# Proposed trays in Model tree

The standard Viewer Model tree contains an independent `Proposed trays` model. Its first level groups the saved sections by Route name; individual sections show a readable section number, catalogue part number and actual length in millimetres. Ungrouped placements appear under `Unassigned components`. Identical route names still represent separate route identities.

Select a route to select its sections, or select a section to inspect its saved metadata in the standard Properties panel. The original imported model keeps its own tree and property source. The proposed hierarchy uses the shared Materials products and pinned CAD revisions already used by the builder; it creates no second catalogue or database migration.

## Native integration

The dynamic Scene model receives a genuine tree through the pinned SDK's public `ObjectTreeBuilder` and `Model.setObjectTree`. Nonzero object IDs identify owned root, route and section nodes; `instances.setDbId` maps each actual Scene fragment to its section node. The first Scene fragment may be zero, but its section object ID is nonzero. Native tree selection, focus and visibility can therefore enumerate the correct geometry through a real tree instead of treating an object ID as a fragment ID.

Section object IDs remain stable during geometry replacement and metadata refresh. Route IDs group sections independently of display names. Metadata updates refresh labels and membership; removing a section removes its node and any empty group. Teardown cancels pending tree work and unloads only the owned dynamic model. Original SVF IDs and property databases are not modified.

Expanded owned root/route nodes survive native tree refresh; intentionally collapsed routes remain collapsed. Existing hidden sections retain their state, and new or reparented sections inherit a hidden route. Retired owned visibility/isolation references are cleared before removal. These operations never read or modify the source model's tree delegate or visibility state.

Properties resolves an owned route or root selection to its actual member sections, deduplicating overlapping group and leaf selections. Original-model and mixed selections retain the native source property providers. Missing or deleted owned nodes cannot fall through to an absent dynamic property database.

## Deployment boundary

Only the isolated feature branch and PoC web on `127.0.0.1:5181` are targets. Refresh the Routings builder page after updating the web image. The original WFC on 5180 and its data are outside this change.

The WFC tree and Properties panel describe saved application sections. They are independent of what Autodesk Online Viewer extracts from a separately uploaded STEP file; see [STEP persistence and compatibility](25-step-section-properties.md).

## Validation

The focused runtime suite passes 198 checks, including ten tree tests that execute the pinned SDK's actual builder, storage, tree, model setter, native selector, visibility manager and bounds calculation. Cases include fragment zero, route selection, focus/isolation/hide/show, hidden new/reparented sections, retired isolation, rename/membership, stable instance identity, preserved expansion and manual Properties close. Thirteen Properties tests include group/root aggregation; the twelve Scene checks use the real native tree fixture. Existing bridge, protocol, adapter and module-closure checks remain included in the PoC workflow.

Full frontend/server type checking and repository lint passed, as did 72 backend metadata/export/length checks. The isolated web build passed. Live 5181 verification displayed `Proposed trays`, `BC182 (5)` and all five sections; choosing the 3750 mm section displayed its seven saved properties and CAD revision 3, while route selection displayed native `Properties (5)` with correct common values and varying lengths/SKUs. API acceptance matched all five canonical property sets and confirmed unchanged design revision 134, route revision 5 and complete saved instance data.
