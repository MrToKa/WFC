# PF-R0 — contracts and implementation baseline

Status: **CONTRACT DELIVERY COMPLETE**; see [actual stage report](35-r0-stage-report.md).
The user authorized continuous implementation on
19 October 2026. This stage inherits `916256f0da14b8f21ca039b34bfae2de33b2bb0d`
on local branch `pf-r0-purpose-contracts-local-20261019`. This document defines
the next implementation, rather than claiming that proposed APIs already exist.

## Deliverables and authority

- [Catalog, source boundaries and capacity](r0/capacity-and-catalog.md).
- [Policy and drawing contracts](r0/policy-drawing-contracts.md) and
  [synthetic examples](r0/policy-drawing-examples.json).
- [Geometry and revision contracts](r0/geometry-revision-contracts.md) and
  [synthetic examples](r0/geometry-revision-examples.json).
- [Catalog examples](r0/catalog-examples.json), [validation matrix](r0/validation-matrix.md)
  and frozen [reference lock](r0/reference-lock.json).
- Actual [read-only local catalog counts](r0/evidence/catalog-counts.json).

The accepted [plan32](32-purpose-and-revision-plan.md) remains the product scope.
The earlier PF-0 contracts and receipts remain historical at their recorded
revisions. Where older documents describe a licence/native-oracle gate, the
later explicit user decision applies: converted-model comparison plus human
engineering review; no fabricated native-equivalence PASS. Connection gap uses
the current Project Details value, whose approved default is 1 metre.

Root is the sole runtime/SQL/HTTP executor. This stage performs only source
inspection, documentation/example validation and a guarded **read-only** count
query against the owned 5191 database. It starts no installation, alters no
schema, imports no model/catalog and changes no application business rows.

## Sources and bounded catalog contract

`Project → Trays` is the authority for names and project purposes. The immutable
model's historical purpose is separate evidence, not a replacement for this
project catalog. Report template mappings are a separate feature and must not
be reused as routing permissions or drawing policy storage.

The proposed **private lossless copy projection** is
`wfc.pf.catalog-copy-projection.v1`. It is not the public normalized catalog DTO
defined in the policy contract (`pathfinder.project-tray-catalog.v1`):

| Field | Meaning |
| --- | --- |
| `projectId`, `catalogRevision` | Server-owned project identity and monotonically increasing routing-catalog bigint revision encoded as an invariant string. |
| `source` | `project-trays`, private snapshot SHA256 and source projection version; no original secret/runtime URL in a client-owned payload. |
| `rows` | Server-generated local tray IDs, exact names/purposes/type, decimal strings for stored mm values and resolved local dependency IDs. |
| `diagnostics` | Missing purpose, unsupported route code, normalization collisions, missing type facts and unresolved dependencies. |
| `contentSha256` | Hash of a canonical, explicitly versioned business projection, excluding volatile capture time but including all routing/drawing inputs. |

The server derives the public normalized catalog from this private projection.
It preserves raw names/purposes, derives explicit normalized keys and exposes the
documented display dimensions. The public envelope carries
`sourceProjectionSha256` and `dependencyFactsSha256`, so grounding, trefoil,
cable-type/material/support facts remain bound even when not expanded into the
public row. The full public `contentSha256` records those facts, while its
separate `routingContentSha256` covers only the routing-relevant tray set, IDs,
names/purposes and normalized keys. `catalogRevision` advances for that routing
projection, not for dimensions, grounding/trefoil/material or layout-only edits.
Drawing fact changes advance `drawingInputRevision` and the full trace hash;
Left/Right policy changes advance `drawingPolicyRevision`. PF dependencies bind
only `catalogRevision` and `routingContentSha256`, not either drawing revision
or the complete source-copy hash. A new full catalog snapshot may therefore
retain the same routing revision/hash when only drawing facts changed.
No strict DTO silently accepts the other shape; all projections and hashes are
versioned and verified server-side.

The revision codec follows the existing `server/pathfinder/contracts.ts`:
`^(0|[1-9][0-9]{0,18})$`, maximum `9223372036854775807`. No JavaScript Number
conversion. Revision overflow fails rather than wrapping. Distinct catalog,
routing-policy, drawing-policy and model/geometry revisions prevent an A→B→A
edit from resurrecting an old result.

The catalog is bounded separately from Viewer capture. Initial proposed transport
ceilings are 100,000 rows, 4,096 distinct purposes and 64 MiB uncompressed UTF-8;
these are **new validation limits to implement and test**, not measured plant
capacity or an instruction to loosen the existing bridge. Count/byte overflow
refuses the entire import/plan; it never accepts a silently truncated catalog.
Actual counts and dependencies must be measured in R1 before R3 batch sizing.

Keep raw names and purposes. Name matching must distinguish the current SQL
`lower(name)` uniqueness rule from the PF parser's route-code normalization;
neither is proof of cross-version physical identity. A collision or invalid
PF code requires resolution, not first-match selection, punctuation removal or
automatic union of permissions. Null/blank purpose is `unconfigured`.

Source NUMERIC values are copied using PostgreSQL text/JSONB-text projections,
not the public DTO's binary64 Number conversion. Exact decimal strings preserve
the source values; null remains null and zero remains zero. Field ranges follow
the corresponding existing source schema. Finite display conversion is an
explicit later boundary and never rewrites the source audit value.

## R1 dependency closure and isolation

The fresh local count receipt proves 0 trays, 0 purpose report templates, 2,140
cables and 50 cable types; all 50 types have null purpose and diameter. These
are a copied input baseline, not complete facts for usable tray drawings.

R1 must copy the actual tray catalog **and required dependencies**:

1. Reuse the retained private source→local map for the existing 50 type IDs.
   Enrich only the verified minimal initial rows using expected-state/CAS;
   preserve cable IDs, routing, design/install length and cable write revisions.
2. Include referenced grounding cable types and preserve grounding/trefoil facts.
3. Reuse global material tray/support/curve records only on exact equality;
   otherwise insert clearly owned dependencies or report a naming conflict.
   Never overwrite a shared catalog entry used by another project.
4. Preserve report mappings as report mappings. Copy referenced file bytes to
   owned storage and verify hashes if needed for the copied drawing scope.
   A foreign storage key alone is not a valid copied dependency.
5. Store raw business rows, source identifiers, mappings and private provenance
   only in the owned ignored workspace. Public evidence contains counts, hashes,
   scope and results. No credential or business-row dump belongs in Git.

Use a bounded read-only consistent source snapshot and a separately owned target
transaction, with explicit source/target identities and no shared volumes.
The target transaction is idempotent for an exact plan, rejects partial/foreign
state and performs a post-write lossless readback. Enriching an existing minimal
type is an explicitly planned change with a precondition, not blanket permission
to overwrite later user edits. The old recovery audit's 27-table scope does not
cover trays/report mappings; R1 adds its own catalog/dependency coverage.

## Shared interfaces and rollout

The two module contracts are normative for PF-R implementation. They distinguish
existing v1 payloads from proposed v2 wrappers and sidecars. Unknown schema
versions fail explicitly. A version-aware projection into the unchanged C#
engine must preserve its mathematics, guards, tie behavior and decimal conversion.
No v2 member is silently injected into a strict v1 DTO.

Every new revision/dependency is introduced with its owning feature. A historical
proposal remains historical: adding policy/comparison provenance cannot make it
applicable without recalculation/review. New code must not silently fall back to
an older valid-looking proposal after a v2 validation error.

Drawing policy revision is intentionally absent from engineering dependencies:
changing only Left/Right or a divider invalidates drawings, not PF path/design
length. Existing ordinary drawing viewers obtain the same server-owned read-only
layout snapshot through project/tray view authorization. Only current admins
can author policy or access PF calculation/model APIs.

The precise default drawing contract includes a source-discovered exception:
grounding cables currently match the MV drawing category but are drawn on the
right as a separate family. `Use default layout` preserves that exception.
An explicit MV side override covers the matched MV category, including grounding,
with clear UI help; grounding never joins phase/trefoil bundles. This routine
choice must be tested and is not a new implemented behavior in R0.

## Mathematical and engineering boundary

All project S/E/P values and gap come from Details. SECONDARY replaces the actual
flagged approach. Add the end reserve once before the percentage, then use the
unchanged C# conversion/ceiling. `trays.length_mm` remains a comparison/audit value;
the legacy sum-of-trays display does not become the PF length calculator.

Frozen references are locked by content hashes. R0 does not regenerate expected
values or rerun PF-0 scripts that overwrite receipts. Drawing source assertions
are frozen as source assertions, **not** claimed to be new pixel golden images.
R2a must execute the retained old cases and record intentional new shared-packing
and divider outcomes before extending them.

Model revision preparation produces immutable geometry and comparison evidence.
Whole requested routing scope, shared equipment identities, transforms and
connectivity must be accounted for. A new shortcut can affect cables that never
used the edited tray, so conservative invalidation includes relevant components,
categories or the whole project. Previous-route membership alone is insufficient.

Actual old/new converted inputs exist, but identity/coordinate correspondence and
engineering changes are not yet verified. The old SVF package is independently
verified in [report33](33-older-model-preparation.md); do not repeat APS submission.
Its existence does not prove a prepared PF graph or accepted cable lengths.

## Completion and continuation

R0 technical completion requires coherent module contracts/examples, reference
integrity, an observable validation/capacity matrix and independent review. Future
implementation checks remain NOT_RUN. A technical contract PASS is not user
acceptance, a real route result or authority to Apply on behalf of the user.

After the local R0 commit, prepare a detailed PF-R1 assignment through
`prepare-stage-handoff`, including actual branch/commit and the discovered type
dependency gap, and execute it immediately under the user's current authorization.
No push, PR, merge or original-installation update follows any PF-R stage.
