# Automatic route connections and installation transitions

The complete-route panel detects free component ends and existing network attachment points automatically. It no longer asks users to choose from four manual endpoint selectors. Reading suggestions does not change a saved design. **Auto-select connection points** saves inferred internal connections using the current group revision.

## Two kinds of connection

- Physical CAD connections retain the existing coincident-port and opposing-frame checks.
- Installation routing transitions connect nearby verified component ends even when their orientations differ. These are routing topology, stored separately from physical CAD mating and Materials products. They do not invent a fitting, reuse a straight SKU as a fitting, or move/rotate the placed components.

For the verified 300 × 60 mm sample profiles, the maximum automatic transition gap is 300 mm. Only unambiguous nearby free endpoints in different connected components can be joined. Reused endpoints, loops, branching, stale revisions and unsupported source geometry are refused. Equal nearest candidates require review instead of arbitrary selection.

Transition geometry is derived from the actual world-space component endpoints. Its straight connector distance is included in the route centreline and routing length. This represents an installation connection; it does not introduce a manufactured bend radius or a STEP fitting. The approved STEP bend continues to use its source-specific R650 centreline and 145 mm legs.

## Persistence and publication

Logical transition links belong to a single project, proposed design and route group. Their endpoints belong to that group. Published groups freeze their links together with the pinned component placements and CAD assets. Publication validates the complete open chain and captures the transition topology and resulting geometry in the publication proof. Whole-group alignment preserves topology and derives the new world coordinates from the saved placements.

Network suggestions use real retained geometry ports from the prepared Path Finder network. Aliases for the same physical point are deduplicated. No prepared network means an explicit preparation message and disabled publication; automatic selection never manufactures network identities. Alignment and publication remain explicit actions.

## Validation

Focused coverage exercises automatic physical matches, bounded installation transitions, ambiguous candidates, loops, preserved placements, network-port selection and the panel state. Existing route publication, alignment, overlay and schema regression checks remain part of the PoC workflow. Deployment and acceptance results are recorded after verification.

## Local acceptance — 2026-11-11

Deployed only the isolated PoC API and web containers on 5181. Applied automatic connection to the existing five-member BC182 group: one new physical join and two installation transitions (180.2776 mm and 170.7680 mm) were saved. The result is one open chain with two free endpoints. The complete instances response before/after was identical: placements, component revisions, lengths and CAD asset references were preserved. Repeating the operation created zero links and did not advance the group revision.

The current PoC project has no prepared Path Finder network. The response correctly reports network-required; BC182 has not been published into an invented network. Existing 5180 services and data were not targeted.

Validation passed: 28 automatic connection tests, 20 centreline/publication unit tests, 17 publication HTTP tests, 20 group HTTP tests, 19 alignment tests, 14 route-panel tests, 13 real PostgreSQL migration/lifecycle tests, 11 overlay tests and 36 placement/viewer regression tests. Docker API/web builds passed. The PostgreSQL suite creates a new container with no host ports, no network and no persistent mount, then removes it. It exercises initializer reruns, scoped membership, port occupancy, published topology freeze, draft cleanup and parent-project teardown.

The proposed-instance catalogue reference now checks at transaction commit, allowing whole-project cascade ordering while still refusing standalone deletion of pinned catalogues. A real autocommit deletion test verifies the reference cannot be lost. Metadata updates retain unchanged group-membership rows and their transition links.

A central membership-count check refuses any operation whose joined Materials-backed instances omit a stored member; mixed legacy/canonical groups cannot publish or align a partial source proof.

Full frontend/server typecheck and repository lint passed. Browser acceptance confirmed BC182 with five displayed components, both saved transition distances, no manual endpoint selectors, and an idempotent Auto-select action reporting a connected route.
