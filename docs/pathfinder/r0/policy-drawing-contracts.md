# PF-R0: project catalog, routing permissions and drawing policy contracts

Status: **PROPOSED CONTRACTS / IMPLEMENTATION NOT_RUN**. These names, shapes,
limits and error codes define the intended implementation; they do not describe
new endpoints or database fields already present in WFC. The accompanying
[examples](policy-drawing-examples.json) are synthetic contract expectations,
not runtime receipts or engineering acceptance of either Aalborg revision.
Objects labelled `request` are proposed wire examples; deliberately invalid
requests are marked by their expected rejection. `input`/`expected` are fixture
descriptions, not additional production request fields. Short cable/profile
aliases in fixtures stand for synthetic objects and are not accepted UUIDs at a
production boundary. No request with fixture-only fields may bypass validation.

## 1. Source observations and scope

The [accepted plan](../32-purpose-and-revision-plan.md) and
[R0 assignment](../handoffs/PF-R0-purpose-revisions.md) are authoritative.
Only tray drawings gain Left/Right positioning. The 3D selected route, yellow
line, Filled Ghost, protected bridge and all PF calculations remain unchanged.

Source anchors, read without executing application code:

- `server/validators.ts`: tray name is trimmed and bounded to 200 UTF-16 units;
  optional tray strings to 500; numeric dimensions/lengths allow zero and null.
- `server/models/tray.ts`: source purpose is nullable; current public numeric
  mapping uses JavaScript Number. New catalog evidence must retain decimal text
  before that conversion, rather than claim lossless fidelity from PublicTray.
- `src/constants/trayPurposeOptions.ts`: five UI suggestions are not a closed
  enumeration of project purposes. Existing custom purposes remain valid inputs.
- `src/pages/ProjectDetails.tsx` around 1637: existing Details `isAdmin={canEdit}`
  also includes project engineers. This is not the new policy authoring gate.
- `server/middleware.ts`: `requireAdmin` reads current `users.is_admin`; existing
  project/tray view permissions and exact section allowlists govern ordinary
  drawing access. A new drawing read path needs an exact allowlist entry.
- `server/pathfinder/auth.ts`: `principalTransaction` holds current admin/login
  authority across the transaction. Preserve that boundary for PF policy writes.
- `src/pages/TrayDetails/TrayDetails.utils.ts:160`: drawing classification uses
  cable purpose, including grounding → `mv`. PF MTO classification is separate.
- `src/pages/TrayDetails.tsx` around 1248 and `trayDrawingService.ts:67`: drawing
  groups currently split by category and default/custom diameter range.
- `trayDrawingService.ts:332`: trefoil membership uses existing ordered endpoint
  guards; phase rotation has separate guards. Do not replace them with guessed
  phase labels, global endpoint normalization, or arbitrary triples.
- `trayDrawingService.ts` around 734 and 1050: grounding within MV uses a separate
  packing family and draws from the **right** in the default mode.
- `trayDrawingService.ts:2460`: ordinary MV starts left; with MV, other categories
  start right. Without MV, Power starts left; without Power, VFD starts left;
  Control starts right.
- `trayDrawingService.ts:2731/2762/2825`: current separator logic counts cable
  categories, warns at three, skips MV, and draws a 2 px stroke at the midpoint
  of the actual left/right edge gap. No physical divider thickness setting is
  established by that code. New behavior uses occupied **sides**, not type count.

These are source observations, not new test results. Existing source fallbacks,
custom bundle ranges, per-bundle row overrides, phase handling, spacing, clamp
footprints and category layout settings require retained regression fixtures.

## 2. Common strict boundary

All proposed objects have exactly the required keys declared below; unknown,
duplicate and discriminator-incompatible keys are rejected. There is no generic
JSON extension bag. Unknown schemaVersion returns `UNSUPPORTED_CONTRACT_VERSION`.
Inputs are UTF-8 JSON; duplicate JSON member names are invalid before parsing.

| Scalar | Contract |
| --- | --- |
| UUID | Lowercase canonical UUID; real identities are server-owned. |
| Revision | Exactly `0` or a string matching `[1-9][0-9]{0,18}`, value ≤ 9223372036854775807; never a JSON Number. |
| SHA256 | Exactly 64 lowercase hexadecimal characters. |
| Timestamp | UTC ISO timestamp with explicit `Z`; server clock for persisted events. |
| Decimal | Canonical nonnegative decimal string matching `(?:0\|[1-9][0-9]*)(?:\.[0-9]+)?`, at most 100 characters, no exponent/sign/NaN/Infinity; null is distinct from `"0"`. |
| PurposeKey | Nonempty normalized string ≤ 500 UTF-16 units, no control characters. It is a case-sensitive value, not an enum. |
| RoutingCategory | Exactly `MV`, `LV`, `Control`, in that canonical order in arrays; no duplicates. |
| DrawingCategory | Exactly `mv`, `power`, `vfd`, `control`. |
| SideMode | Exactly `use-default`, `left`, `right`. UI labels: Use default layout, Left, Right. |

The Decimal expression uses regex alternation; a Markdown table escape is not
part of the validator. Numeric conversion is allowed only at an
explicit bounded drawing/engine boundary; audit records retain decimal text.
Hashing uses a versioned canonical JSON function with sorted object keys and
unchanged array order, compatible with existing PF canonical JSON semantics.

Initial request ceilings are **proposed resource bounds, not measured capacity**:
1 MiB UTF-8 for policy writes; 4096 purpose rows/changes; 1000 catalog rows per
page; 100000 catalog rows per immutable snapshot; 500 UTF-16 units per purpose;
200 per tray name. R0 capacity assessment/R1 actual input can tighten or justify
versioned changes. Exceeding a bound returns an explicit limit diagnostic; never
truncate data or silently omit rows. Later capture budgets remain separate.

## 3. Authoritative catalog and exact purpose semantics

Proposed catalog schema: `pathfinder.project-tray-catalog.v1`.

The server reads the project Trays table in a consistent snapshot. A catalog row
has exactly `projectTrayId, rawName, nameKey, rawPurpose, purposeKey, dimensionsMm`.
`dimensionsMm` has exactly `width, height, declaredLength`, each Decimal or null.
`rawName`/`rawPurpose` preserve stored source text. Null purpose stays null.

Normalization version `nfc-trim-case-sensitive-v1`:

1. Preserve raw text; derive `nameKey`/`purposeKey` with Unicode NFC then the
   ECMAScript String.trim whitespace set, pinned identically in server/client
   adapters. Do not case-fold, apply NFKC, collapse internal whitespace, infer
   presets, or substitute model purpose.
2. Empty normalized purpose → null/Missing purpose. It is not the string
   `"null"`, an empty policy key, or a synthetic default purpose.
3. Repeated **identical raw purpose** across many trays is one normal policy
   group. Distinct raw spellings collapsing to the same key produce
   `PURPOSE_NORMALIZATION_COLLISION`; exact duplicate normalized tray names produce
   `TRAY_NAME_COLLISION`. Do not merge permissions or select the first row.
4. Case-distinct purpose keys remain distinct; the UI must display their exact
   values. A case-insensitive model search may produce candidates but cannot
   collapse these authoritative records or resolve an ambiguity.
5. Resolve a collision through an explicit audited correction of the isolated
   project catalog, then create a new catalogRevision. Never rewrite source
   checkouts, historical snapshots or the original project's records implicitly.
6. Invalid controls/overlength values remain visible as catalog diagnostics and
   retain their source evidence. They do not become valid by truncation.

Catalog envelope keys: `schemaVersion, projectId, catalogRevision,
normalizationVersion, snapshotId, sourceProjectionSha256, dependencyFactsSha256,
routingContentSha256, contentSha256, recordedAt, rowCount, rows, diagnostics`. Each diagnostic has
`code, projectTrayIds, message`; message is English. Paginated reads bind every
page to the same snapshotId/contentSha256 and require an explicit final row
count/manifest before promotion.

The normalized public catalog is distinct from the **private lossless** source/
copy projection `wfc.pf.catalog-copy-projection.v1`, owned by the R0 source-copy
contract. That private projection preserves source/local ID correspondence,
tray type, grounding, trefoil, material references and other retained source
facts. Public normalized rows do not replace it and do not claim to contain all
lossless source fields. `sourceProjectionSha256` binds the exact retained
projection bytes; `dependencyFactsSha256` binds a versioned canonical projection
of all authoritative routing/drawing dependency facts, including grounding/type/
trefoil/material references. ID mapping and the canonical dependency projection
format are recorded with the private copy proof. Digests expose no private rows,
credentials or storage capability.

`routingContentSha256` covers only a versioned canonical **routing projection**:
the complete tray set, projectTrayId, rawName, nameKey, rawPurpose and purposeKey,
including routing-relevant identity/collision diagnostics. It excludes project
dimensions/declared length, type, material, grounding, trefoil and layout facts.
The model geometry remains a separately versioned engineering input. PF
preparation/jobs bind **catalogRevision + routingContentSha256**, not the full
catalog hash, source/copy hash, drawing facts or drawingInputRevision.

`contentSha256` covers the versioned complete normalized catalog content,
sourceProjectionSha256, dependencyFactsSha256 and routingContentSha256. It
excludes its own hash and volatile recordedAt/snapshotId; each canonical hash
input is retained in the snapshot proof. It is full-copy/drawing trace evidence,
not a PF dependency. Drawing-only source-fact changes can produce a new full
contentSha256 and snapshotId with the **same catalogRevision and
routingContentSha256**. drawingInputRevision advances for the changed drawing
facts. This preserves lossless source → display traceability without causing
spurious route/design recalculation or publishing private source/copy records.

`catalogRevision` is a server-owned project BIGINT incremented atomically only
when the routing projection changes: add/delete of a tray, or a routing identity,
raw name/purpose or normalized key change. A project dimension, declared length,
type, material, grounding, trefoil or layout-only edit does not bump it. Import
paths and direct database writes need the same domain split; client timestamps
are not substitutes. Several routing changes committed in one transaction can
share one increment. Routing A→B→A in separate commits has distinct revisions
even if the final routingContentSha256 equals the initial hash.

Left/Right authoring changes only drawingPolicyRevision. It does not alter the
copied source rows, sourceProjectionSha256, catalogRevision or routingContentSha256.

Declared length is an audit comparison value. It neither overwrites model
geometry nor replaces partial centreline travel in PF design calculations.
Per-version model-observed purpose is separate historical evidence; current WFC
catalog purpose is authoritative for current rules. A discrepancy is visible,
not an automatic catalog overwrite or proof of historical catalog purpose.

## 4. Routing permission policy

Proposed admin read/write path:
`/api/projects/:projectId/pathfinder/routing-permissions`. This path is not
implemented by this document. Current `user.isAdmin` controls UI authoring;
server `requireAdmin` and current-login transaction checks control every request.

Policy schema `pathfinder.routing-purpose-policy.v1` has exactly `schemaVersion,
projectId, catalogRevision, routingPolicyRevision, rules`. Each persisted rule is
exactly `{purposeKey, allowedCategories}`. Absence is meaningful:

| Catalog/policy state | Effective behavior |
| --- | --- |
| Missing purpose | `unconfigured`; no admitted routing categories. |
| Purpose present, no rule | `unconfigured`; no admitted routing categories. |
| Rule with `allowedCategories: []` | `excluded`; deliberately no admitted categories. |
| Nonempty rule | `configured`; exactly that subset. |
| Collision/unknown key | Not ready; cannot author/promote through the unresolved row. |

Cable MTO mapping stays MV→MV, LV→LV, Control→Control,
Instrumentation→Control; an unknown category requires resolution. Instrumentation
is not a fourth checkbox. Power/VFD are not extra routing categories. Existing
cable MTO/purpose data is never rewritten by changing these rules.

Strict write schema `pathfinder.routing-purpose-policy.write.v1`:
`schemaVersion, expectedCatalogRevision, expectedRevision, idempotencyKey, changes`.
Each change is one of two exact shapes:

- `{purposeKey, operation:"set", allowedCategories}`.
- `{purposeKey, operation:"reset"}` → remove the active rule, yielding unconfigured.

Changes is nonempty, bounded and unique by purposeKey. Set with zero categories
is valid excluded state. Unknown/detached purpose keys are rejected. Reset never
means allow all. Saved historical rules remain in the append-only audit trail;
renaming a purpose does not implicitly transfer its permissions to the new key.

The transaction order is normative:

1. Verify current authenticated actor/login/admin/project authority. A replay
   cannot bypass revoked authority or resurrect a deleted project.
2. Resolve the actor/project/domain/idempotency key under a uniqueness/locking
   guard. An **exact same-key/request replay** returns the original historical
   receipt before performing a new catalog/policy CAS, without incrementing or
   writing another audit event. This remains true after intervening catalog or
   policy changes. A different request with that key is `IDEMPOTENCY_CONFLICT`;
   changed expectedRevision is also a different request.
3. Only for a **new command/key**, verify expectedCatalogRevision and the current
   routingPolicyRevision under locks. An old expectation returns 409; there is no
   last-write-wins behavior. A new key cannot replay an old revision.
4. A successful new logical save increments routingPolicyRevision exactly once,
   even if it saves the same explicit values; persist the audit and receipt in
   the same transaction. Concurrent duplicate requests cannot double-increment
   or double-audit.

A replayed receipt does not prove that its revision is still current. The UI
refreshes current policy rather than replacing it with historical content. The
same precedence applies to the drawing-policy domain and its own revision.

Write response keys: `schemaVersion:"pathfinder.policy-save.v1", projectId,
domain:"routing", catalogRevision, previousRevision, revision, auditId, duplicate`.
Actor identity/time comes from current server authentication, never request body.
Audit has `auditId, projectId, domain, actorId, loginId, occurredAt,
catalogRevision, previousRevision, revision, idempotencyKey, requestSha256,
beforeRules, afterRules`; no bearer, cookie or client secret.

## 5. Drawing positioning policy and shared read snapshot

Proposed admin authoring path:
`/api/projects/:projectId/pathfinder/drawing-positioning`.
Schema `pathfinder.drawing-purpose-policy.v1`: exactly `schemaVersion, projectId,
catalogRevision, drawingPolicyRevision, rules`. A rule is exactly
`{purposeKey, categoryModes}`. `categoryModes` always has all four keys
`mv,power,vfd,control`, each one SideMode. Omitted rule means all use-default.
There is no pair of booleans which can simultaneously assert Left and Right.

Strict write schema `pathfinder.drawing-purpose-policy.write.v1` has
`schemaVersion, expectedCatalogRevision, expectedRevision, idempotencyKey, changes`.
A change is exactly `{purposeKey, categoryModes}`; setting all modes to
use-default explicitly resets the behavior. The same collision, key, limit,
revision, concurrency, idempotency and audit rules apply with domain `drawing`.
Drawing and routing saves never bump one another's revision.

Missing tray purpose has no authored purpose row and uses the legacy drawing
sides, with a visible missing-purpose diagnostic. This does not grant PF routing
permission. `drawingPolicyRevision` affects drawings/exports only and is excluded
from PF geometry/dependency hashes, proposals and design-length staleness.

Ordinary users already authorized to view this project's tray drawings must see
the same selected layout. Proposed exact read path:
`GET /api/projects/:projectId/trays/:trayId/drawing-snapshot`.
It uses current project/tray **view** rights and an exact middleware allowlist,
not the admin-only PF router. No broad PF/model/capture/results access is added.

Read schema `pathfinder.tray-drawing-snapshot.v1` has exactly `schemaVersion,
projectId, projectTrayId, snapshotId, catalogRevision, drawingPolicyRevision,
drawingInputRevision, layoutAlgorithmVersion, contentSha256, purposeKey,
categoryModes, legacySidePolicyVersion, settingsSha256, inputSha256,
orderedCableIds, state, diagnostics`.
`state` is `ready|diagnostic|blocked`; each diagnostic has `code,cableIds,message`.
`drawingInputRevision` is a proposed server-owned monotonic revision over all
relevant cable membership/properties, tray dimensions, custom bundle ranges,
layout/trefoil/clamp/spacing settings and material clamp choices. It is separate
from cableWriteRevision and changes when layout dependencies change.

The snapshot is server-owned, read-only policy plus frozen input identity; the
existing authorized drawing input must match its inputSha256/settingsSha256.
Persist snapshotId as an immutable identity for this exact revision/input tuple;
the same authorized admin/nonadmin drawing reads reuse that snapshot identity.
Alternatively the same service can return a separately versioned computed
layout DTO, but it cannot trust client-supplied modes as authoritative. Snapshot
and inputs must be collected consistently; mismatch is stale, not a mixed image.
Exports recheck permission/revisions and render that same snapshot. Conditional
cache keys include project/tray/snapshot/permission context; never share a cached
snapshot across projects or bypass revoked rights through an old signed URL.
Responses are private/no-store until a bounded validated cache is implemented.

A nonadmin can neither mutate a policy nor read policy audit/history/PF APIs.
401/403, a missing snapshot, unknown contract version or stale inputs produce an
English layout error/refresh state; never silently draw an incorrect Legacy
fallback. Genuine **use-default in a valid snapshot** is not such a fallback.

## 6. Deterministic rendering contract

The order is normative:

1. Collect the complete authorized cable input for the tray, using current
   routing membership semantics. Preserve original cable order and source IDs.
2. Classify drawing purpose using the retained version of matchCableCategory;
   never derive it solely from MTO. Unknown drawing purpose remains diagnostic,
   not silently Control. Grounding is classified mv with a grounding subfamily.
3. Compute all legacy default sides from the **full** input before applying any
   override. Do not remove overridden types and recompute defaults on the rest.
4. Apply per-purpose/per-drawing-category SideMode. Explicit mv mode also applies
   to its grounding subfamily; UI help must state **"MV positioning includes
   grounding cables."** Grounding keeps its separate packing/phase constraints.
   This is a proposed explicit routine decision; use-default retains the legacy
   grounding exception. cable.purpose is not rewritten.
5. Aggregate the complete final Left pool and complete final Right pool first.
   No type/purpose-only blocks may survive merely because two compatible types
   used different categories before this change.
6. Build compatibility groups, then jointly distribute each side. Effective
   profile includes actual diameter-range bounds/custom range, per-bundle row
   override, max rows/columns, cable/bundle spacing, trefoil/phase-rotation rules,
   endpoint grouping semantics, grounding/normal family and clamp eligibility.
   Identical effective profiles can share bundles across drawing categories.
   Different profiles are handled as distinct compatibility subgroups within one
   side packer, without inventing a permissive merged profile or dropping
   existing per-category settings. Grouping solely by purpose is forbidden.
7. Retain existing phase/trefoil guards and complete group boundaries; a clamp
   cannot enclose an incomplete phase group. Grounding never joins phase/trefoil
   groups. Diameter comparisons use existing actual boundaries, not text labels
   interpreted as numeric gaps. Existing diagnostic display fallbacks stay
   explicitly marked; they are not verified diameters or capacity evidence.
8. Stable order is descending actual diameter group maximum, then source-order
   first occurrence of the compatibility group; within a group use retained
   diameter/order/phase rules with original index as the stable tie. Array/input
   order is frozen in inputSha256. Do not reorder the C# route engine inputs.
9. Place Left from the left tray edge and Right from the right edge using actual
   bundle and clamp footprints, preserved margins and spacing. Recompute shared
   occupied/free-space metrics and exports from these same positions, not the
   old purpose-block approximation. Unknown dimensions/diameters or overflow
   cannot be reported as verified positive free capacity.
10. Determine separator by actual occupied **sides**, including grounding and
    clamp footprints, not by category count. Both sides occupied → one divider;
    one/zero sides occupied → no automatic divider. This includes MV and three
    categories. Remove only the spurious type-count warning; retain real
    compatibility, incomplete-phase, clamp and capacity diagnostics.
11. Draw current 2 px stroke at `(leftRightEdgePx + rightLeftEdgePx)/2` in the
    actual gap. px is a visual unit, not a physical thickness in mm. If the
    stroke or footprints overlap, report `DRAWING_CAPACITY_CONFLICT` rather than
    shrink cables, hide them, claim free capacity or silently skip the divider.
    No physical thickness/reserve is invented. A future physical reserve needs
    its own explicit validated setting. If a separate existing explicit divider
    setting is discovered, qualify its precedence before implementing it;
    none is established by the observed current code.

Legacy side table, evaluated before overrides:

| Full input | Default side |
| --- | --- |
| Ordinary mv | Left. |
| Grounding classified mv | Right, separate grounding packing family. |
| Any mv-classified input present, including grounding | power/vfd/control Right. |
| No mv, power present | power Left; vfd/control Right. |
| No mv or power, vfd present | vfd Left; control Right. |
| control alone | Right. |

The existing outer `hasMv` test also sees grounding-classified mv: preserve that
full-input presence decision for other categories until a separately accepted
change. Unknown/omitted cable inputs cannot produce a claimed complete layout.
Defaults preserve **sides and existing compatibility algorithms**, not an
identical image when required joint bundling/divider intentionally changes the
layout. With identical effective input, bundling and divider, positions remain
deterministic. A new route after Apply may legitimately change tray membership.

## 7. Invalidation, errors and acceptance gates

| Change | Routing effect | Drawing effect |
| --- | --- | --- |
| Routing catalog tray set/identity/name/purpose | New catalogRevision/routingContentSha256; affected calculations become stale and preparation must match the routing projection. | New full catalog/input scope; refresh. |
| Project dimension/declared length/type/material/grounding/trefoil only | No PF invalidation; same catalogRevision/routingContentSha256. Model geometry and other genuine PF dependencies remain independently guarded. | New sourceProjectionSha256/dependencyFactsSha256/contentSha256/snapshotId and drawingInputRevision; refresh. |
| Routing mask/reset | New routingPolicyRevision; new route search, not just a new percentage. | No invented side override; existing applied routes remain until explicit Apply. |
| Drawing mode only | No PF graph/search/design change and no source-copy/catalog routing hash change. | New drawingPolicyRevision; refresh preview/export. |
| Category layout/clamp/cable input change | Existing PF-relevant fields keep their existing engineering dependency semantics. | New drawingInputRevision; refresh. |
| Membership changes after Apply | Existing cableWriteRevision/Apply semantics. | Rebuild tray input and layout from the updated membership. |

All policy errors use exact shape `schemaVersion:"pathfinder.policy-error.v1",
code, message, currentRevisions`, with currentRevisions null for unauthorized
requests and otherwise exactly `catalogRevision,routingPolicyRevision,
drawingPolicyRevision`. This admin policy error is not the ordinary drawing read
error. The latter has exact shape `schemaVersion:"pathfinder.drawing-error.v1",
code,message,currentDrawingScope`; its currentDrawingScope is null when access
is denied, otherwise exactly `projectId,projectTrayId,catalogRevision,
drawingPolicyRevision,drawingInputRevision`. It exposes no routing permissions,
model identifiers, PF geometry or policy audit. Error bodies do not expose
another project's catalog.
400: invalid schema/unknown category/duplicate purpose/mode/limit; 401:
unauthenticated/revoked; 403: current nonadmin authoring or unauthorized project
read; 404: unavailable authorized project/tray; 409: revision/idempotency/collision/
stale snapshot; 413: transport budget. Exact middleware status semantics must be
kept consistent with existing auth, without revealing project existence.

Implementation gates (all **NOT_RUN** here): normalization/collision and zero-mask
controls; concurrent save and A→B→A; all old default-side cases plus grounding;
domain-separated catalog hash/revision changes without spurious PF invalidation;
full-input defaults with mixed overrides; compatible two-type Left and Right
joint bundles; incompatible profiles remaining safe; MV/three-type divider;
single-side/no-divider; overlap/unknown capacity; admin edit versus normal viewer
same snapshot; revoked/cross-project/old export rejection; unchanged 3D and PF
math; backup/restore of all revisions, snapshots and audit history.

No existing PF-0 expected results or receipts are regenerated by this contract.
