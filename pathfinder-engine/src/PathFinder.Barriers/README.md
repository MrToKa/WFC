# Independent closed-solid centreline collision kernel

`PathFinder.Barriers` is a pure .NET 9 library. It references no Core sources,
Viewer SDK, Navisworks, network, filesystem or database. This stage does not change
route planning, project data, UI, jobs, Review/Apply or the eleven Core files.

`BarrierCollisionKernel.Build(meshes, limits, cancellationToken)` defensively
copies a bounded set of selected triangle solids. It returns `Ready` and an
immutable kernel only after all qualification completes. `Refused` contains
explicit diagnostics and no kernel. An empty input refuses: a server-owned
explicit no-barrier declaration is a separate planning operation, and must never
be confused with a successful walls-checked result.

`kernel.CheckSegment(from, to, token)` returns `Clear`, `Blocked`, or
`Indeterminate`, with deterministic primitive-work accounting. A point segment is
an occupancy query: an inside/on-surface point blocks, an outside point clears.
Cancellation throws `OperationCanceledException`; exhausted query work or invalid
query coordinates never produce `Clear`.

## Supported geometry

Each mesh is one connected, complete, consistently oriented, exactly welded,
closed two-manifold triangle shell. Qualification checks every triangle/index,
duplicate triangle, shared-edge multiplicity/orientation, face connectivity,
vertex-link connectivity, nonzero signed volume, and all BVH candidate pairs for
self-intersection/nonadjacent near-contact. All tests are bounded and a failed or
exhausted qualification refuses the complete build; no triangles are dropped or
holes filled. Reversing an entire shell is supported. Several independently
qualified solids may overlap or touch: collision is against their union.

Exact coordinate welding allows ordinary triangle-local duplicated vertices.
Near-coincident vertices are not repaired. Open surfaces, disconnected/nested
shells inside a single mesh, inconsistent winding, pinched vertices,
self-intersections, repeated triangles and features below numerical resolution
refuse. Separate connected shells must be submitted separately. Completeness is
an upstream extraction responsibility; the kernel cannot establish that a caller
captured every model object or that the converted model agrees with the source.
Separate supplied solids have union semantics, so an inner nested shell is not a
subtractive enclosed cavity. General BRep/cavity Booleans are unsupported; a
disconnected outer/inner-shell input refuses rather than inferring a cavity.

Actual openings are retained as triangle voids. A connected watertight rectangular
frame/tunnel and a floor with the same opening are regression fixtures. Bounding
boxes only reduce candidate work; they are never treated as filled solids.
Closed-shell winding uses a compensated full solid-angle sum for endpoint
containment, not a few sample rays. Ambiguous winding refuses a clear result.
Whole-mesh narrow-phase checks include coplanar overlap and edge/vertex contact.

This is **centreline collision only**. Physical cable radius, installation
clearance, bend radius, penetration/fire-seal suitability, structural drilling
permission, and free-space detour generation are not implemented or certified.

## Numeric and resource policy

Input coordinates are finite canonical world metres, bounded to absolute 1e9 by
default. Requested numerical tolerance defaults to 1e-7 m and must be within
[1e-9, 1e-3]. To guard binary64 world-coordinate resolution, qualification and
queries use the greater of that tolerance and `64 * machine epsilon * maximum
absolute coordinate`. This can conservatively reject a near-contact or very thin
feature. It is not a physical cable clearance. `Summary.NumericToleranceMeters`
records the build's effective tolerance; a query with more remote endpoints can
raise the conservative guard further. Calculations do not claim exact arithmetic
or support arbitrarily small features at arbitrarily large world coordinates.
Triangle qualification additionally requires the conservative scale/conditioning
guard `256 * machine epsilon * longest edge / (normal length / longest edge²)`
to fit that tolerance. Queries apply the same guard at their endpoint-distance
scale; an excessive/nonfinite bound is `Indeterminate`, never a miss. A very long
thin or remote segment can therefore refuse even when all coordinates are finite.
Projection plus oriented-edge cross products avoid the known cancellation in
dot-product-product closest-triangle formulas. Nonfinite intermediates refuse.
The pair-distance guard also applies during complete self-intersection
qualification, not just route queries. As a concrete supportedness boundary,
the synthetic 0.1 mm thick wall with a 4 m span must qualify and block; the original
10 µm thick wall with a 4 m span may refuse because its pair-distance roundoff guard
exceeds 1e-7 m. Its regression still forbids `Clear`. No tolerance was increased
to admit an unsupported shape. These examples are algorithm qualification cases,
not claims about usable physical cable clearances.

Defaults: 256 computational solids, 500,000 input vertices, 250,000 triangles,
500,000 BVH nodes, 40,000,000 build work units, 2,000,000 query units, leaf size 8,
and a conservative 128 MiB estimated allocation budget. Work units count bounded
geometric primitives/tree visits, not clock ticks. Cooperative elapsed limits
default to 60 s for builds and 10 s for queries. Work loops check cancellation/time
every 256 work units and at result publication; these are not hard process
deadlines against a blocking caller-owned enumerable or runtime suspension.
Bounds can be tightened by
the caller; a cap is not evidence of actual capacity. BVH-sort work/cancellation
exceptions preserve the closed refusal/cancellation boundary. Memory estimates
include input/weld/topology/BVH accounting and are not an OS resident-set
measurement. A production runner still needs its independent time/memory guards.
`PolicyVersion` identifies the registered-barrier workflow contract, separately
from `CollisionVersion`, which identifies this collision algorithm. Exporting
these identifiers does not implement server authorization, drilling bypass or a
complete workflow collision certificate.

## Checks

`tests/PathFinder.Barriers.Tests` references this project as a library and writes
only a JSON result to stdout. It covers real connected openings, solid walls,
floor holes, coplanar/edge/vertex contacts, point containment, thin/transformed
solids, whole-shell reversed winding, strict qualification, resource refusal,
immutable copies, repeat determinism and cancellation. Synthetic results are not
actual converted-model validation, native parity or engineering acceptance.
