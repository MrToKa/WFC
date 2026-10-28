# Protected selected-network computational capture

`viewer-runtime/model-capture.mjs` exports a protected-runtime async generator
and a pure parent-side assembler. Importing the module does not access the SDK.
The adapter supplies the current trusted project/model/content identity; the
parent supplies only a capture UUID, explicit network codes, explicitly allowed
MV/LV/Control categories, and exact equipment names from its cable endpoints.
The existing bridge owner remains responsible for authorization, session/model
generation fences, cancellation and closed command transport.

The event sequence is `metadata`, `object-part` messages, `summary-part` messages,
then `complete`. Each event is at most24KiB of UTF-8 JSON. The capture is limited
to64MiB of event data and3000 events, beneath the unchanged4096-request lifetime
limit of a fresh bridge. Object/summary JSON uses adaptive text chunks and exact
canonical reassembly, including Unicode/surrogate pairs and escaped text. The
assembler refuses missing/out-of-order/duplicate/cross-capture parts, unexpected
schema members, nonfinite geometry, unsupported proof flags and inconsistent
counts/hierarchy. It returns no snapshot before completion. Overruns cause an
explicit error; no geometry or candidate list is silently truncated.

The generator indexes at most one million hierarchy objects, scans equipment
properties in bounded batches and retains every exact NFC/trim/case match of
the object name or supported Name/Tag/Equipment Tag/Equipment Name/Location
property. Punctuation and leading zeroes remain significant. Missing and
ambiguous endpoint candidates are retained for user resolution. SDK substring
search cannot establish exact absence and is not used. The full scan is a name/
property discovery operation; the emitted snapshot remains selected in scope.

Only actual physical leaf meshes under the explicit route owners receive
`geometryRole: routing-leaf` and the explicit category assignment. Hierarchy
stubs have no fragments and cannot become fitted trays. Their bounds are the
union of selected descendants only, not a claim about the full plant extent.
Equipment candidates retain properties, version-local dbIds, unique external
IDs, hierarchy and actual SDK bounds while carrying no routing mesh. Ambiguous
external IDs are retained in diagnostics. An equipment item without triangle
geometry can use its actual SDK object bound; missing/nonfinite bounds fail
instead of producing an invented origin anchor.

Mesh vertices and original triangle indices come from the pinned SDK7.130.0
`enumMeshVertices` / `enumMeshTriangles`. All computational matrices use the
SDK's binary64 `LmvMatrix4(true)`. The exact composition is display-to-world-metres
times the SDK fragment world matrix times the decoded local vertex. Global
offset and unit scale are applied once, without a second root/placement
transform. Raw display/source values may remain finite up to1e12; canonical
metre points/bounds are limited to±1e9, matching engine and picking contracts.
The summary retains actual units/up/root/placement/global-offset observations
and per-fragment original/display/canonical matrices.

The capture keeps `inventoryComplete`, `geometryComplete`, `unitsVerified`,
`transformsVerified`, `planningVisibilityKnown` and `sourceLinkVerified` false.
Every native visibility is unknown; SDK display/Ghost state cannot promote it
to native engineering evidence. The output is a real computational input only
after an actual SDK capture; it is not a parity acceptance token or permission
to Apply. Full plant capacity, native/converted equivalence and the historical
route-length discrepancy remain separate gates.

The module never calls visibility, isolation, selection, color, navigation or
Ghost APIs. Cancelling/replacing a model invalidates its capture; callback waits
have45-second bounds and the entire capture has a300-second deadline. The
adapter transports bounded progress independently of pull requests.

Fifteen fresh synthetic SDK-shaped checks passed, including exact-transform,
physical/hierarchy, equipment ambiguity/NFC, empty-mesh endpoint, cancellation,
NaN/index/cycle, coordinate-bound, Unicode pagination, canonical JSON and strict
C# `SnapshotReader` / `ModelRunner` interop controls. These fixtures are explicitly
synthetic and are distinct from real-model evidence.

The subsequent [actual protected-browser capture receipt](../evidence/pf7/actual-capture-1792289114650.json)
records a real52-object /2,502,826-byte capture from the copied Aalborg model,
uploaded as a private artifact through the protected capability. Strict C#
reading/fitting produced26 routing segments and ordered lookup succeeded with
the explicitly diagnostic1.0m tolerance. The recorded length is
35.30345579516123m, including four reported connection gaps. Its readiness is
`needs_review`; partial geometry, unverified transforms/units/source linkage,
unknown native visibility and four fitting fallbacks remain. This is a selected
converted-model interop PASS, not native parity, engineering Apply acceptance,
full plant capacity or a claim that the historical discrepancy is resolved.

Run the affected suite with:

```powershell
node --test viewer-runtime/test/model-capture.node-test.mjs
```

The interop check uses the previously built local Release ModelRunner, writes
only a fresh ignored engine-scratch fixture and records no original data.
