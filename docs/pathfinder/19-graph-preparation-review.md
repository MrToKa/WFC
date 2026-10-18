# Graph preparation and capacity boundary

Current acceptance note,18October2026: the user chose manual result review
instead of a mandatory native oracle; see
[the revised decision](20-manual-review-and-project-gap.md). Historical native
limitations below remain recorded facts, but are no longer a prerequisite for
this local manual-review workflow. This decision does not implement graph
reuse or prove whole-plant capacity.

Read-only independent review on 18 October 2026, against the current isolated
worktree inheriting `c95ad56ebbd6b020966fa0690c98c37516df1db1` and the unchanged
eleven canonical Routing source files. This is an implementation limitation,
not another successful native/converted validation.

`RouteCalculator.Calculate` creates its own nodes/pieces and endpoint projections
before adding connections (`Routing/RouteCalculator.cs`, lines 66–128).
`AddNeighbourConnections` creates the AABB tree inside that call (276–326).
`ContactGraph` captures the endpoint-containing initial nodes (629–637), and
parallel interior contacts depend on them (687–705). Equal-cost node-ID order
(900–903) and insertion-dependent resource boundaries (752–790) are observable
semantics. `CalculateLookup` constructs a separate graph in
`RouteLookupCalculator.cs` (47–125).

A new partial companion can access private helper types, but cannot intercept
these entry points or preserve their local graph. An unused prepared AABB API
would not improve the actual calculation. A second prepared orchestration path
would duplicate the algorithm; a refactor of the pinned source would break the
current exact-source extraction boundary. Neither has been performed.

The current `FittedModelCache` persists fitted geometry, ports and canonical mesh
with checksums; it reconstructs physical surface BVHs when loading from disk.
The one-shot ModelRunner loads a fresh cache object per request, so its in-memory
fitted objects and mesh-clearance proof caches are not shared across cable
processes. Jobs do run as durable batches, but do not share one prepared graph or
one in-memory fitted model across all batch items.

A bounded batch/persistent private worker could reuse one PreparedModel while
calling the unchanged Calculate for every cable. Exact-query memoization could
reuse identical model/rules/category/options/endpoint requests. Both preserve
the algorithm and may improve throughput; neither is a reusable graph API.
They need deliberate lifetime, memory, cancellation, crash recovery and bounded
output tests. They have not been added speculatively without a representative
capacity measurement.

Status: **fitted geometry cache implemented; reusable graph API NOT_IMPLEMENTED;
whole-plant geometry/category/visibility and capacity NOT_RUN**. Real-model
engineering parity remains separately BLOCKED by the missing licensed,
full-precision paired reference. The 52-object actual UI capture and synthetic
application tests do not close these gates. A future behavior-preserving graph
refactor needs an explicit updated source contract and tests for parallel
attachments, ties, exact limits, category filtering and query-order independence,
with the pinned implementation retained as the comparison reference.
