# Computational model snapshot v1 — PF-2 checkpoint

Implemented transport: `pathfinder.model.snapshot.v1`, represented by
`pathfinder-engine/src/PathFinder.Model/Contracts.cs`. This is distinct from
PF-0's permissive synthetic replay schema, PF-1's calculation wire envelope,
the native oracle transport and the browser's raw capture artifacts.

Unknown JSON members, duplicate JSON keys, absent required fields, invalid
identities/hierarchy, nonfinite coordinates, incompatible frames, bad triangle
indices and exceeded budgets fail explicitly. Numbers remain binary64; JSON
serialization preserves their round-trip precision. This artifact carries no
administrator permissions, accepted parity proof or cable write capability.

| Section | Fields and meaning |
| --- | --- |
| `model` | Project/version-local identity; lowercase `contentSha256`; optional `sourceContentSha256`. A package content fingerprint and original NWD SHA256 are different evidence and must be named honestly in capture provenance. |
| `capture` | Source kind (`converted`, `native`, `synthetic`), adapter version, evidence hashes and explicit completeness/unit/transform/native-visibility/source-correspondence flags. These flags are evidence declarations, not trust or acceptance tokens. |
| `coordinates` | `vertexFrame=canonical-world-metres`; original units and optional scale; optional full source/root matrix; canonical offset; declared display-to-world matrix. All matrices are invertible binary64, 16-value column-major affine transforms. |
| `objects[]` | Version-local `id`, optional parent/external/dbId; names/hierarchy/properties; nullable own `nativeHidden`; explicit planning exclusion; optional route/shape labels; category assignment source and allowed categories; canonical world bounds; fragments/optional face evidence. |
| `fragments[]` | Version-local fragment identity, canonical XYZ vertices, indexed triangles, recorded optional source-fragment-to-world matrix and `transformAlreadyApplied=true`. Matrices record provenance and are never applied again inside Model. |
| `faceExtents[]` | Optional canonical min/max and sample counts for the six named world AABB faces. |

Every category assignment must identify `explicit-planning`,
`native-reference-selection`, `synthetic` or `unassigned`. Native PathFinder
categories originate from user selection assignment, not an assumed object
property. `unassigned` requires an empty category array and remains unresolved;
Instrumentation maps to Control. All/MV/LV/Control test selection is represented
as the explicit array `['MV','LV','Control']`, never silently inferred.

Version-local IDs/dbIds/fragment IDs must be unique within the snapshot.
External identity collisions remain separate candidates and produce ambiguity
diagnostics. A complete inventory cannot reference absent parents; a partial
selection can, but its effective visibility becomes unknown. Ancestor cycles
and excessive depth fail. A hidden ancestor excludes its descendants. Unknown
native visibility produces provisional fitting and `needs_review`; transient
Viewer visibility is never substituted for native planning evidence.

Canonical transform equations are:

```text
pWorldMetres = sourceToWorldMetres * pSource
pDisplayLocalMetres = pWorldMetres - globalOffsetMetres
pWorldMetres = pDisplayLocalMetres + globalOffsetMetres
```

Adapters must perform the first operation exactly once before creating the
snapshot. A renderer with an additional display axis/root convention must
declare its complete display-to-world matrix and verify it with actual SDK
data; it must not guess. A canonical snapshot cannot accept fragment-local
vertices with a pending transform. Verified-transform declarations require the
source and fragment matrices; unverified canonical candidates remain reviewable
evidence and cannot establish real-model equivalence.

## Agreed capture boundary and pending integration

The converted capture worker owns raw `converted-inventory.v1` and
`converted-fragment-mesh.v1` artifacts. Their normalizer maps dbId/externalId,
hierarchy/properties, fragment transforms and canonical meshes into this format.
Native planning visibility remains `null` unless the conversion preserves
explicit evidence; SDK Ghost/isolation flags cannot prove it. Actual units and
root/global-offset composition must come from the capture audit.

The native oracle worker owns `native-oracle.capture.v1`: document units/scale,
original NWD SHA256, detached canonical inputs, full-precision/R-format
companions, leaf/native transform evidence, fitted segments and exact route
outputs. It is an independent comparison transport. Core-native categories
remain explicit reference selection inputs. It is not imported blindly as an
accepted production snapshot.

The workers agreed these mappings before the Model DTO was defined. Browser
capture and native activation have not produced a usable actual paired snapshot
at this checkpoint. Integrating/validating those inputs, proving native endpoint
bounds and conversion/source correspondence, and measuring real-model capacity
are required before PF-2 can be called complete.

Fitted cache keys cover raw snapshot SHA256, explicit rules/exclusions/resource
limits and the pinned Core version. Fitted geometry is reusable; the graph is
still constructed by RouteCalculator for each cable. See the Model library
README for restoration/integrity/cancellation limits and test instructions.
