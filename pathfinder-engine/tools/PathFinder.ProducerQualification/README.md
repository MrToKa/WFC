# Managed producer A/B diagnostic qualification

This isolated operator tool compares two independently hash-pinned aggregate
snapshots from the same project, model version and content fingerprint. It uses
ProjectReference to the production Model/Core/Adapter libraries. It does not copy or edit
the eleven pure routing source files, add a product API, issue a grant, author a
binding, review a proposal or apply a cable change.

Run the built tool with:

```text
PathFinder.ProducerQualification --manifest <absolute-input.json> --work-root <new-absent-absolute-directory>
```

The work directory's parent must exist. Inputs and their ancestors must be
regular paths without symlinks/reparse points. The tool creates its own ownership
marker, separate A/B fitted caches, bounded graph receipts and `result.json`.
Existing outputs, inputs and caches are never overwritten or deleted. Failed or
partial outputs remain for diagnosis. Run it only against separately copied,
authorized local inputs and retain business data outside Git.

Qualification mode requires distinct absolute A/B paths, distinct verified raw
snapshot SHA256 values, and distinct aggregate plan evidence hashes. An A=A
self-test cannot produce a converted A/B qualification PASS. Only captures marked
`sourceKind: "converted"` are admitted; synthetic captures are refusal controls,
not positive converted qualification evidence. These checks still cannot prove
independent capture origins: before issuing qualification authority, root must
retain separate evidence that A came from the protected user Viewer and B from
the actual managed producer for the same current context. Copying or altering an
input cannot replace that evidence.

## Input contract

The JSON parser rejects duplicate or unknown members. All fields below are
required; SECONDARY alone may be null. Settings are copied from Project Details,
not chosen by this tool. All six routing options must be explicit. Instrumentation
maps to Control. Query IDs are unique and there are 1–32 queries. The total
cancellation deadline is 100–120000 milliseconds.

```json
{
  "schemaVersion": "wfc.pf.producer-qualification-input.v1",
  "a": {
    "path": "<absolute-copied-A-snapshot.json>",
    "sha256": "<lowercase-64-hex>",
    "projectId": "<uuid>",
    "modelVersionId": "<uuid>",
    "contentSha256": "<same-model-fingerprint>"
  },
  "b": {
    "path": "<absolute-copied-B-snapshot.json>",
    "sha256": "<lowercase-64-hex>",
    "projectId": "<same-uuid>",
    "modelVersionId": "<same-uuid>",
    "contentSha256": "<same-model-fingerprint>"
  },
  "queries": [{
    "id": "explicit-controlled-query",
    "category": "Control",
    "from": [0, 0, 0],
    "to": [1, 0, 0],
    "options": {
      "connectionToleranceMeters": 1,
      "sampleSpacingMeters": 0.125,
      "secondaryDistanceMeters": 2,
      "preferVerticalApproach": true,
      "maxGraphNodes": 200000,
      "maxGraphConnections": 1000000
    },
    "projectDetails": {
      "revision": "0",
      "secondaryTrayLength": "0",
      "endConnectionLength": "0",
      "additionalBendingPercent": "0",
      "connectionGap": "1"
    }
  }],
  "timeoutMilliseconds": 120000
}
```

The sample coordinates/settings illustrate the contract only. They are not the
user's engineering values or an independently accepted length expectation.

Snapshot inputs are limited to 256 MiB each and pass the existing SnapshotReader
before fitting. They must be ordinary aggregate captures with one plan evidence
hash, no lookup/input-scope dialect and all native/completeness proof flags false.
Only `capture.evidenceSha256` is omitted for semantic A/B comparison because each
aggregate embeds its own session-specific plan hash. Exact raw SHA256 receipts
remain separate, and the original bytes are checked again at the end. Model,
coordinates, object order, hierarchy, bounds, vertices/triangles, transforms,
properties and assigned categories remain in the compared projection.

## What the graph evidence actually measures

Public `RouteCalculator.Calculate` does not expose its local graph. This tool
does **not** claim to inspect those locals. For each exact endpoint/category/options
tuple it builds a diagnostic initial seed with the same ordinal segment order,
vertices and endpoint projection nodes. Projection, contact graph construction,
mesh clearance, gap ranking and shortest path are invoked from the actual loaded
Core library using bounded private reflection. Real `PreparedModel.Segments`,
including retained connection surfaces, are used; exported fitted polylines alone
cannot represent those surfaces.

The tool inspects the actual replayed nodes and each edge in insertion order.
Binary64 coordinates/lengths use exact IEEE-754 bit strings; integer node/gap
values and BigInteger gap ranks are exact. It records start/end nodes, the chosen
path and path cost. The replay must cross-check the untouched public Calculate
result: route codes/IDs/order, points, endpoint distances, SECONDARY flags,
physical length and gap count/length. A reflection shape change, graph limit,
cross-check mismatch or unavailable measurement causes FAIL. Equal inputs alone
never grant graph PASS.

The normal public `CableDesignLength.Calculate` supplies allowances, preserving
the C# double-to-decimal conversion, SECONDARY replacement, one connection spare,
percentage and ceiling. Its three decimal outputs are compared as canonical
decimal strings. There must be at least one successful route witness; matching
refusals alone cannot qualify the producer. Only the supplied bounded queries
are covered, not all possible plant routes.

Decimal setting strings are parsed through the existing production Adapter's
exact decimal converter. Its integer coefficient/scale comparison rejects
precision rounding and underflow rather than silently changing an allowance.
The input tool's nonnegative plain-decimal string syntax remains explicit.

The result compares both actual replay graph receipts and public route/design
semantics exactly. It separately hashes loaded Core, Model, Adapter and harness assemblies.
Graphs plus the final receipt are capped at 32 MiB (with 1 MiB reserved for the
summary); fitting uses the existing model limits and queries retain their
explicit node/connection guards. Private cache files use the existing bounded
FittedModelCache and are not counted as graph/receipt output.

This is converted A/B compatibility evidence. Every receipt retains
`engineeringAccepted: false`, `nativeParity: "not-performed"` and
`humanReviewPerformed: false`. It cannot establish native correspondence, correct
engineering geometry, a qualified cross-revision project frame, or human
acceptance. Public binding readiness and manual Review → Apply gates still apply.
The operator must not turn these measurements into a qualification authority
record until all other required SDK/sandbox/closed-browser checks also pass.
