# PF-B17 — complete original-triangle structural catalog

Status: **TECHNICAL SOURCE CHECKS PASS; RUNTIME WALL SUPPORT UNFINISHED**.
Baseline22932bebd6d96a1e975064385d9a3e1f0e39395a on
pf-b17-global-surface-catalog-local-20261022. Implementation follows plan96's
catalog prerequisite. Latest user steering now prioritizes finishing the cable
popup, including per-cable drilling and calculation feedback, then walls.

## Implemented and checked

The C# compiler consumes all four sealed inventories, exact original stored part
receipts and the final producer completion. It checks ordering, hashes, frame
projection, owner dbId/membership, every original source triangle range, totals,
all stream ends and final disposal before producing a completed catalog.
Selected parents must each have physical geometry. A part visitor validates its
entire owned byte snapshot before exposing immutable canonical triangles or
detached matrix copies. Binary64 operations retain the existing multiplication
and addition order, including signed-zero evidence.

The catalog stores bounded triangle pages, range provenance and compact indexes,
with actual coordinate-derived bounds. The cold reader authenticates all index
data, full range coverage and each complete page before callbacks. Generated data
is flushed and fully cold-read before the final manifest; final currentness is
checked immediately before rename. Late failure leaves no valid final manifest.
The exact binary format and refusal ceilings are in
`pathfinder-engine/src/PathFinder.BarrierVerifier/SURFACE-CATALOG.md`.

Protected server reads now export all original seals and original part receipts,
with current administrator/login/model/load/deadline and stored-byte checks.
The new internal async export streams are single-use, verify all EOFs and their
receipt chain, and require final currentness. No public route or schema is mounted.
The TypeScript async export and C# synchronous compiler remain source seams;
there is no automatic protected-repository-to-compiler runner yet.

Root executed27 surface tests on Windows and Linux: six visitor cases plus21
independent JavaScript fixtures, including seven valid inputs and14 refusals.
They check split wall-opening geometry, physical instances, original indices and
exact transformed bits, initial revision0, coherent missing-parent geometry and
scope-frame forgeries, missing/overlapping/altered parts, cold corruption,
deterministic output, late currentness and compiler budget/cancellation/disposal
failures. The original packed suite also passed31 local cases plus26 independent
fixtures on both systems (32 console tests including the aggregate golden case).
Each Linux run used512MiB process memory, readonly inputs, joined owned helpers,
source/artifact/fixture bookends and confirmed cleanup. Peak RSS and whole-model
capacity were not measured.

Server unit tests25 passed. Fresh isolated Linux PostgreSQL/cookie HTTP tests37
passed on the corrected repository source; helpers and network were removed.
Source checks found and corrected a TypeScript discriminant narrowing error and
a real PROFILE_BINDING false refusal caused by comparing canonical profile data
against a literal with a different key order. Initial failed logs are retained.
Full profile values remain pinned. Generic revision parsing now permits0 as the
existing scope contract requires; receipt ordering still demands positive progress.

## Limits and remaining work

This is structural surface data, not a collision-clearance, closed-volume,
publication, routing or independent SDK-source-byte certificate. Hierarchy and
source provenance remain protected-producer-reported. No holes were filled,
triangles simplified or walls replaced by bounding boxes. The existing v2
nontriangle refusal remains; whole RVM groups still need an explicit primitive
policy. Conservative contact queries, occupancy/own-terminal rules, atomic
publication/admission/write proofs, authoring integration and actual Aalborg
checks remain required before wall support is complete.

The current disk-headroom check uses the filesystem root. It does not establish
free space on a nested Linux mount. Destination-specific headroom testing is
NOT_RUN and must be corrected before claiming that guarantee; bounded output and
write-failure/no-final-manifest handling remain. No capacity claim follows from
small synthetic fixtures.

Current5191 remains B15 weba0e6972c with the same APIac0d16ab. No installation,
original service/database/model/cable/Apply mutations were performed for B17.
Actual Viewer/Aalborg verification remains blocked by the saved browser refusal;
the browser was not retried or bypassed. The later popup and publication-boundary
edits are tracked separately and are not acceptance of this catalog at runtime.
Private operation13328c95-c8fa-4221-9763-31686f3093d7 retains builds, fixtures,
all failures and bounded Linux/SQL evidence. Preparer remains after PathFinder.
