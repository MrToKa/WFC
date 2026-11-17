# Niedax fitting connector placement

`shared/cadFittingSources.ts` registers the measured terminals of the KLT
60-303 tee and KLBG 60-303 bend, including their F revisions. Catalogue display
names may use KSLT/KSLBG; registration matches the original STEP filename and
SHA-256 together, never the editable product name or component kind.

Terminal evidence is in `shared/fixtures/cad-fitting-terminals.json`. It was
extracted from the four original Niedax STEP files using the application's
CadQuery/OCC converter on 2026-11-17. Each file has one valid solid. For each
terminal, two coplanar cut faces have combined area 301.5 mm² and a 300 × 60 mm
envelope. The connector lies at the envelope midpoint, with local +Z pointing
along the outward face normal and local +Y preserving the tray's up direction.
The geometry test compares the registered positions and rotations with these
independent face measurements.

The tee has `start`, `end`, and `branch` connectors; the bend has `start` and
`end`. Existing project catalogue references receive missing ports at schema
initialization. Backfill preserves existing port IDs and saved connections,
including products imported with an inaccurate `straight` component kind.
Fittings remain ineligible for straight cutting.

To continue a saved draft, select it, choose **New section**, select the new
component, and use **Snap to placed component**, **Existing component connector**,
and **New component connector**. **Snap to connector** calculates placement;
**Save new component** stores the part, physical connection and route membership.

These frames support physical placement. They do not enable automatic routing
publication for these fittings: that feature still requires a separately verified
routing centerline and, for a tee, branched network topology.
