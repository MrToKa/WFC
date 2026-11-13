# Section properties in the 3D viewer

Placed CAD sections use the viewer's standard Properties panel. The seven delivery properties are Name, Actual length (mm), Width (mm), Height (mm), Part number, Manufacturer and Purpose. Route identity and the pinned CAD revision provide context. The generated section name remains the route name followed by the stable placement UUID, matching STEP export.

The instance-list API reads catalogue dimensions, current saved length and current route membership/name/Purpose in one scoped statement. It calls the same `cadSectionProperties` helper as STEP delivery; it does not infer local dimensions from a rotated bounding box. Unknown dimensions and unsupported centreline lengths remain explicitly unknown. Reading Properties does not change catalogue products, source STEP files, saved geometry or route revisions.

Dynamic CAD sections retain the SDK Scene fragment/object identities of their own dynamic model. These are not original SVF database IDs. The pinned SDK omits index zero from aggregate-selection events while its public `getAggregateSelection()` retains that selection. The Properties panel recovers only owned CAD selections from that public getter, including the first fragment, without changing global selection events or remapping native object identities. Focus, visibility and section commands retain their existing identity semantics. No fake source IDs, dummy geometry, source property database modifications or independent property catalogue are introduced.

The pinned SDK 7.130 exports the native panel as `Autodesk.Viewing.Extensions.ViewerPropertyPanel`. PropertiesManager owns the normal toolbar, dock and panel lifecycle. Selection generations guard delayed source reads and native internal-reference expansion, so an old request cannot overwrite a newer section or source selection. Missing/deleted owned instance IDs do not fall through to the dynamic model's absent property database. Model teardown restores the default panel.

Panel layout uses the native content and viewer bounds, including its 75-pixel bottom reservation. On a short viewer, the CAD panel moves upward as needed before native content sizing, rather than remaining at the stock 180-pixel offset with a 100-pixel height. Source-only layout stays native. The normal Properties auto-open preference is respected, and manually closing the panel does not reopen it during metadata refresh. Removal clears only the released owned selection before its SDK ID can be reused; replacement of the same saved section restores selection after its geometry and metadata are rebound.

Saved-route membership also has a synchronous selection identity and epoch guard. A pending draft updater cannot erase a newer saved-route selection during initial loading or Purpose editing. The regression selects the route immediately after metadata delivery and asserts that the saved member UUID is retained in the Purpose update; its HTTP mocks return independent response snapshots.

The isolated feature branch and 5181 PoC stack are the deployment targets. The original WFC on 5180 and its data are outside this change.

## Usage

Select a saved section in 3D and open Properties using the viewer toolbar. The panel shows the saved section values, including its containing route and Purpose. Dimensions use millimetres. Selection of an original-model object continues to show that object's original properties. Editing controls keep their own unsaved values until Save; Properties describes the saved section.

After updating this version, refresh the Routings builder page to load the new viewer integration. Existing exported STEP files do not need to be imported back into the viewer to obtain these properties.

## Validation

Focused checks passed: 72 backend metadata/export/length tests, 222 React/controller tests and 186 native runtime/adapter/protocol/scene tests. They include execution of the pinned SDK's actual public selection getter and event-builder methods for index zero, native manager-before-panel event ordering, mixed source/CAD selections, delayed source results, closed-panel refresh, deleted-ID reuse and replacement. Frontend/server type checking, lint and both isolated application images passed. These suites are included in the PoC validation workflow.

Deployed acceptance on 2026-11-13 used the existing BC182 proposal on 5181. Direct selection of its first stock section (SDK fragment zero) displayed all seven properties and 6000 mm; the saved vertical cut displayed 3750 mm and its pinned CAD revision 3. Native Isolate retained the correct first straight section, direct geometry clicking restored its properties, and Show all objects restored the complete model. Selecting an original model object returned its original FBX Item properties. The native panel expanded within the short viewer bounds and displayed all seven rows. API acceptance independently matched canonical dimensions, Purpose and lengths for all five placements against an unchanged baseline: design revision 134, route revision 5, membership and full saved instance data unchanged. No catalogue or source geometry writes were required.

After the membership guard, the immediate-selection regression passed eight repeated runs without a readiness delay. The full local Materials command passed 199 tests, with only its opt-in disposable PostgreSQL migration test skipped; the CI workflow provides that database separately. Full typecheck and scoped lint passed. The updated web on 5181 retained all five saved member checkboxes after initial route selection and showed all seven properties for the 3750 mm section. Only the isolated web service required the guard update.
