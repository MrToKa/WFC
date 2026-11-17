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

Routing preparation also supports these revisions. The KLT uses three nominal
terminal-center axes meeting at `(-795,30,0)` mm: each arm is 795 mm, total unique
tray geometry is 2385 mm, and a cable traversing two arms uses 1590 mm. This is a
nominal T-axis convention, not a cable bend-radius fillet. The source's R500
inner-wall rounding does not define a unique curved centerline. The measured
outer through wall and 909 clear-corridor samples per source revision are retained
in `shared/fixtures/cad-tee-corridors.json`.

KLBG uses its measured R900/R1200 coaxial walls to derive an R1050 quarter arc
with two 145 mm legs. The wall evidence is in
`shared/fixtures/cad-routing-curves.json`; the centerline length is
`290 + 1050*pi/2` mm. A bend is never replaced by its shorter terminal chord.

Branched routes emit ordinary native polyline segments sharing one route code.
Each tee arm retains only its measured outer connector; the common internal
junction has no invented physical port. Nonzero saved connector/installation
gaps become explicit bridge segments with opposing measured end frames and
their full length. Native routing selects only the traversed arms and applies
the existing purpose, capacity and obstacle rules. A route still owns one Trays
row, whose length sums each distinct arm/component/bridge once. Its version 2
source proof hashes the graph without flattening it into a fictitious chain.

One segment retains the route-group UUID; other segment IDs are derived stably from
the group, component and arm identity. Composite proof counts every segment,
not every route. The bounded overlay budget is 256 segments, with the existing
payload byte limit unchanged. Existing single-chain source proofs and segment
identities remain unchanged.
