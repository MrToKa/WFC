# LV cable tray report

The supplied `Template files/ReportMacroTemplate_LV.docx` uses the Variables API row IDs defined in `src/pages/TrayDetails/trayReportVariables.ts`. The exporter resolves its standard placeholders automatically, even when a project has no saved mappings. Existing project-specific mappings remain usable alongside the standard tokens. In Project details → Variables API, select Edit → Use tray report placeholders → Save to populate missing mappings without replacing existing ones.

Upload the updated Word template to the project's Word files and assign it to the LV tray purpose in Project details. Generate report on Tray details downloads the populated document and saves it to the project files. Updating the repository file does not replace templates already uploaded to a project.

## Report structure

The template follows the previous report's explanatory order: cover with tray and support dimensions; routed cable schedule; support, tray, cable and combined weight calculations; numerical tray loading and manufacturer curve; tray geometry and free-space calculations. Each calculation is introduced in prose and followed by its numerical formula. Individual cable unit masses are summed in schedule order, including the selected grounding cable once.

All load and free-space assessment conclusions, utilization and reserve calculations are collected in the Assessment results section. This section is immediately before the final cable laying concept, which starts on its own page. The reference customer and ACS logos, page frame and identification footer are retained; the footer uses current Variables API values rather than old release/revision approvals. Branding assets are in `Template files/report-assets`.

## Calculation basis

- Inventory totals retain cables, tray and support masses.
- The load used for the manufacturer's tray curve is `(cable mass per metre + tray own mass per metre) × 9.80665 / 1000`, in kN/m. Supports are excluded from this span load.
- The project safety allowance is applied as `1 + allowance percentage / 100`.
- Allowable load comes from a published point or linear interpolation between adjacent span points. No capacity is extrapolated outside the supplied span range.
- Utilization is design load divided by allowable load, in percent. Reserve is allowable load minus design load; a negative reserve records an overload.
- A PASS uses unrounded numbers at the selected span. Missing cable weights, a missing selected grounding cable weight, invalid curve points or spans outside the documented range cannot yield a PASS.
- Grounding mass is counted once when selected. It is excluded from the bundle width calculation.
- When **Use Trefoild clamps** is enabled, the actual rendered trefoil groups select from all 23 Vulcan+ trefoil models in `Template files/vulcan-data-sheet-ds03v9e.pdf`. The range must fit all three cable diameters; overlapping ranges use the closest midpoint to the largest diameter. For example, 35 mm selects VRT+04 (33-38 mm, 284 g), and 40 mm selects VRT+05 (36-42 mm, 319 g).
- Clamp spacing is saved per tray and defaults to 600 mm. Each group uses `ceil(tray length / clamp spacing) + 1` clamps, including both ends. The resulting total mass divided by tray length is included once in cable load, combined inventory, span load and report formulas. Missing dimensions or an unsupported group prevents a complete clamp/load assessment. Clamped cables touch, and the concept drawing includes the selected clamp's width and height.
- Across the tray, clamped trefoil groups leave 5 mm between the visible clamp outlines when **Space between trefoil bundles** is disabled or bundle spacing is zero. When enabled, they follow the selected bundle spacing. 1D/2D is measured between cable edges, using the largest diameter in the adjacent groups; clamps follow those cable positions. This applies to phase rotation, both drawing directions and adjacent diameter bundles. The catalog envelope remains reserved in tray occupancy.
- Width calculations use the actual bundle layout from Tray details, including its cable and bundle spacing options. Free width is not cable cross-sectional area or volume.
- Support counts retain the existing application rule: `n = floor(route length / support spacing)`, then `max(2, n + 1)`, with one extra support if n is at least one and the remaining length exceeds 20% of the spacing.

The curve check verifies the distributed tray load only; it does not establish the capacity of brackets, anchors or concentrated-load conditions. Cable inventory assumes that each routed cable occupies the full reported route length.

## Additional Variables API values

The report includes generated date, tray mass excluding supports, span mass, unfactored and design load calculations, capacity interpolation, utilization and its formula, signed reserve and its formula, reserve percentage, maximum allowable span within the supplied curve, documented span range, load conclusion, free-width percentage and its conclusion, individual cable mass summation and occupied-width calculation. Definitions and standard placeholder tokens are shared by the editor and exporter in `trayReportVariables.ts`.

Word text replacements support placeholders split across multiple runs, XML-special characters and overlapping old/new token names. Cable table headers repeat across pages, and image content types are added to the Word package.

## Template maintenance and validation

Rebuild the template with `scripts/build-tray-report-template.py` using Python with python-docx. Run the focused calculation, Word export and Variables API tests. Setting `REPORT_QA=1` during the Word export tests writes a populated example into `.data/report-qa/filled-example.docx` for local inspection; this example uses test data and small image fixtures.

Automated checks validate numeric results and Word package structure. Visual pagination still requires Word or a compatible DOCX renderer. The Windows workspace used for this change has no available LibreOffice renderer, so page-image verification has not been completed.
