# STEP section properties and route hierarchy

STEP exports for a selected route and for the complete proposal include section metadata directly in the STEP file. Each placed section has its own identity even when multiple sections share the same catalogue source geometry. Route nodes group the corresponding section nodes; unassigned placements use an explicit Unassigned group.

The required values are the section name, actual length in millimetres, local profile width and height in millimetres, catalogue part number, manufacturer and the containing route's Purpose. The generated name includes the route name and stable instance UUID, because placements currently have no independently authored section-name field. Source CAD asset/revision and instance/route IDs provide additional provenance.

Dimensions come from canonical Materials component fields with the linked tray dimensions as fallback. They are local product dimensions and do not change when the placement rotates. Approved straight lengths use the exact saved cut length or verified 6000 mm stock length; the supplied bend uses its verified R650 centreline with 145 mm end legs. Unsupported or missing values are explicitly unknown and are never replaced by zero or a world-space bounding-box guess.

The export snapshot captures the source geometry, placements, canonical dimensions, route roster, route names, Purpose and memberships in one repeatable read. These values enter the final export fingerprint, so changes during CAD generation refuse stale output. CSV remains compatible.

## STEP persistence and compatibility

Properties belong to unique section nodes, separate from shared geometry definitions. This preserves per-instance values and the existing 128-placement/resource budgets. The intended STEP property representation follows the [CAx-IF User Defined Attributes recommended practices](https://www.mbx-if.org/home/wp-content/uploads/2024/05/rec_prac_user_def_attributes_v18.pdf). Actual serialization and readback are verified with the pinned CAD kernel. External CAD property-panel display depends on that application's support for STEP user-defined attributes.

No independent project catalogue or metadata sidecar replaces these embedded properties. Source STEP files, Materials records and saved placements are not rewritten by export. The feature is confined to the isolated PoC branch and stack; main and 5180 are outside its deployment scope.

The converter is pinned to CadQuery 2.8.0 and cadquery-ocp 7.9.3.1.1. Because its normal writer drops arbitrary NamedData, the exporter adds standard GENERAL_PROPERTY / PROPERTY_DEFINITION / PROPERTY_DEFINITION_REPRESENTATION entities to the native STEP model after transfer. Dimensions are typed length measures with SI millimetre units. The unique section product wrappers own the attributes; route wrappers retain route identity, while repeated solids can still share B-Rep definitions.

The pinned OCCT 7.9 native UDA reader has a UTF-8-to-ExtendedString conversion quirk. Independent acceptance normalizes that reader's display strings; the actual file retains the correct standard STEP X2 Unicode encoding. Property persistence is additionally checked through the actual STEP entity graph. This does not guarantee identical property-panel display in every external CAD application.

## Offline validation

### Autodesk Online Viewer observation — 2026-11-13

The user's `BC182.step` (SHA-256 `08422fb060a100c170b98f8722360d56fbef87f3df583dcb4ad5f289e6288d2b`, 3,039,334 bytes) is already the metadata-enabled AP242 export. Independent inspection found all seven attributes on each of its five unique section product definitions, and native readback recovered the values. The user's screenshots cover the file root, assembly, route, section, geometry and mesh nodes: Autodesk Online Viewer exposes none of the seven custom attributes at those levels. Regenerating the same format or selecting a different tree level is therefore not an established remedy.

WFC's Properties panel reads canonical application metadata. Its successful display does not establish what an independent STEP translator imports. Embedded CAx-IF user-defined attributes are not a native PDMS database or a promise of Autodesk Online Viewer compatibility. Autodesk's public [SVF2 advanced input schema](https://github.com/autodesk-platform-services/aps-sdk-node/blob/main/modelderivative/source/model/jobPayloadFormatSVF2Advanced.ts) offers no STEP-specific user-attribute extraction switch; its [STEP advanced settings](https://github.com/autodesk-platform-services/aps-sdk-node/blob/main/modelderivative/source/model/jobPayloadFormatAdvancedSTEP.ts) describe STEP output protocol and tolerance instead.

An actual follow-up Online Viewer import verified the conventional-field correction: `Part Number` now reads `KL 60.303 F`, the route node reads `BC182`, and section names include the route, SKU and actual length. `PRODUCT.id` holds the SKU, and readable NAUO identifiers replace UUID-dominated browser labels. Generated labels use ` - ` because the observed translator reduced slash-delimited component names to their last segment. Stable instance and route UUIDs remain embedded attributes. Duplicate legacy route names receive a collision-only occurrence suffix; normal names remain unchanged.

The seven custom attributes are also attached to each unique section occurrence and its geometry occurrence, using valid product-definition-relationship targets; shared geometry definitions retain no per-instance attributes. Independent readback verified identical values across all three owners, and exact shape comparisons remained zero for all five sections. Nevertheless, the tested Autodesk Online Viewer Properties panel still exposes only conventional fields. This interoperability limit remains explicit; no all-seven-properties display or native PDMS compatibility is claimed. The user accepted this boundary and directed work to the WFC Model tree.

Independent native readback confirmed all seven properties on two routes with shared geometry and distinct per-instance Purpose, including quotes and Cyrillic. Actual source verification covered repeated 1500 mm cuts in different routes, a rotated 2500 mm cut and the supplied bend. All four exact B-Rep comparisons returned zero symmetric volume difference, while each section retained its own property set.

A 128-placement metadata assembly also passed under the unchanged 64 MiB temporary storage, 1 GiB memory and two-CPU limits: 128 valid bodies, all bounds/centres/volumes matched independent reconstructions and 15 representative exact shape comparisons returned zero difference. Output was 3395629 bytes with peak process memory below 558 MB. The source STEP copies and application data were unchanged.

## Deployed acceptance — 2026-11-13

Only the isolated PoC data services, converter, API and existing web on 5181 were started/updated. Fresh selected-route and complete-proposal STEP downloads identify AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF in FILE_SCHEMA. Independent native NamedData plus standard STEP entity-graph inspection verified all seven properties against every one of the five BC182 instance UUIDs: 6000 mm twice, 3750 mm, 1000 mm and the 1311.01761241668 mm bend centreline; local dimensions 300 × 60 mm; correct catalogue numbers, manufacturer and Purpose. Four shared geometry definitions retain five independent metadata sections. All ten independent exact shape comparisons returned zero symmetric volume difference. CSV output stayed unchanged. Design revision 134, route revision 5, all instance data and original sources remained unchanged.

Validation passed: 67 focused TypeScript tests, full frontend/server typecheck, repository lint, compatible Docker builds, expanded offline legacy/mesh/cut/128-part/129-rejection smoke, and independent native property plus geometry readbacks. The stored STEP properties persist without a JSON/CSV companion. New exports contain the properties; historical exported files must be regenerated to gain them.
