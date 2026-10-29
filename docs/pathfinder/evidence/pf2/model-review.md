# Model review and prepared-network boundary

This review used the local Model implementation and the byte-pinned Core source;
it did not inspect an invented successful native capture. Native activation is
externally blocked by the observed missing entitlement. Converted capture and
paired integration have separate evidence and must not be inferred from these
synthetic Model tests.

## Correctness findings resolved in this continuation

1. **Hierarchy owners became phantom routing geometry.** `PrepareInputs` used
   an inherited logical route label for every inventory object, including an
   owner with no mesh. A full inventory could therefore add an owner AABB
   fallback beside the actual physical leaf. The required `geometryRole`
   separates hierarchy, generic objects and explicitly eligible routing leaves.
   Only the latter enter fitting. A named-owner/physical-leaf regression now
   proves exactly one segment; equipment objects retain anchor evidence without
   becoming trays. Intentional empty-mesh routing leaves still report fallback.
2. **Depth validation depended on input order.** Previously a root-first
   inventory reused each cached parent and only counted the new short suffix.
   A chain longer than the declared maximum could pass. Memoized total linked
   depth now enforces the same boundary for root-first and deepest-first input;
   exact-limit and over-limit controls cover both orders.
3. **Queued cancellation waited for another fit.** A plain monitor acquisition
   could defer an already cancelled request until a long running fit released
   the gate. Bounded monitor attempts now check the token while queued. A held
   gate regression verifies cancellation before the other operation releases it.
4. **Exclusion validation had quadratic work.** For each exclusion the code
   rescanned the entire object array. Both counts can be large under the model
   resource limits. A single ordinal identity index plus cancellation-aware
   loops now validates all exclusions in O(objects + exclusions). Valid multiple
   exclusions and a late unknown identity have focused controls.

Fresh bounded validation: **82/82 synthetic Model checks PASS**. The original
68-check and intermediate 80-check timestamped receipts remain historical
records. `model-tests-latest.json` points to the current result. New caches are
owned under ignored `pathfinder-engine/.scratch/model-tests-*`; no cleanup of
either denied `.pf0-work` or `.pf2-work` child was attempted during this run.

## Why a cached final adjacency graph is not a safe drop-in

The unchanged `RouteCalculator.Calculate` inserts From/To projected stations
before `AddNeighbourConnections`. `ContactGraph` snapshots those initial nodes;
`AddParallelAttachmentContacts` then creates cross-tray contacts at those query
stations inside overlapping parallel rails. The graph itself is therefore
partly endpoint dependent. Simply building a graph once and splitting two
edges would omit valid attachment contacts.

Node/edge ordering also matters: `MinHeap.Before` resolves equal lexicographic
cost by node index. Moving endpoint insertion after base contacts can change
the selected equal-cost route even when the physical distance stays equal.
Node/connection/candidate budget failures have an observable priority tied to
the same insertion/traversal order.

## Minimal safe prepared boundary — proposal only

A companion partial Core file can leave all 11 original files byte-identical.
Its prepared artifact should retain category-filtered trays sorted by the
existing ordinal ID rule, immutable piece/abscissa arrays, the AABB search
structure, and a reproducibly ordered recipe of endpoint-independent contact
work and mesh proofs. Existing `TrayMeshClearance` objects already retain
bounded peer/station proof caches and should be shared deliberately.

For each query, recreate the exact legacy endpoint-first nodes and replay
contacts in legacy order, including endpoint-dependent parallel attachment
stations. Keep surface checks, limits and edge insertion order unchanged. An
AABB/contact preparation artifact is useful reusable work, but it must not be
reported as an immutable final adjacency graph. A truly reusable base graph
with a dynamic endpoint overlay requires an explicit proof of those semantics
and deterministic node-order reconstruction before replacing the reference.

No graph refactor or prepared-network API is implemented by this review.

### Acceptance gates for any future companion API

- Preserve all 105 current regression cases and the 43 frozen PF-0 golden
  outputs, plus PF-1 wire validation. Require exact flags, ordered segment/code
  identities, failure messages and decimal results; compare binary64 paths and
  lengths at the declared 1e-9m synthetic tolerance, retaining round-trip values.
- Compare legacy and prepared calculations for many From/To pairs on long
  overlapping rails, including stations strictly inside the overlap. Exercise
  vertical preference, same-point endpoints, bends, branches, loops,
  zero-length pieces and routes whose endpoint projection is an existing
  static contact.
- Exercise physical port-only contacts and forbidden interior crossings,
  tied mesh-clearance witnesses, exact 0.25m tolerance, one-micrometre gap rank,
  verified-port precision and strict SECONDARY equality/beyond-threshold cases.
- Permute source tray order and create equal-cost alternatives. Route identity
  must match the pinned implementation, including heap tie behavior, not only
  geometric length. Preserve category filtering and adapter Instrumentation
  mapping; unassigned production categories remain unresolved.
- Compare node/connection/candidate budget failures at the exact boundaries,
  including a case that exceeds more than one limit. Failed/cancelled
  preparation cannot publish a supposedly complete network.
- Run concurrent independent endpoint queries against one prepared artifact
  and repeat in different query orders. Results must match legacy and have no
  cross-query node mutation. Measure retained mesh/proof/cache bounds and
  invalidation for model, categories, exclusions, rules and engine versions.
- Benchmark preparation and repeated queries on an actual declared model
  scope. Synthetic speed or source inspection cannot clear the missing real
  native/converted parity gate or establish plant capacity.
