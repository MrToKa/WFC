# Independent captured-fragment geometry verifier

The pure `BarrierCaptureVerifier.Verify(captureUtf8, limits, token)` library API
and its stdin CLI reference `PathFinder.Barriers` as an assembly. They do not
reference or edit Core, Model, the existing runner or the original application.
No filesystem paths, URLs, database connections or credentials are inputs.

Input is exact UTF-8 `wfc.pf.barrier-capture.v1`, at most32MiB. Duplicate/unknown
members, malformed identities, partial observations, missing membership, invalid
indices, nonfinite data and quotas refuse. The digest binds the exact raw bytes;
the server must supply the exact immutable bytes it stored, rather than another
serialization. Oversized/unavailable inputs have a null digest, never an invented
hash of a truncated input. An optional stricter caller quota can only tighten the
published caps. A bounded private input copy prevents caller-owned byte-array
mutation from separating the hashed bytes from the parsed bytes. That copy can
add up to32MiB to peak memory; it is not a measured full-capacity RSS guarantee.
Before allocating typed DTO point/index arrays, a bounded JSON-document preflight
checks array arity and individual/aggregate count ceilings. Malformed captures
containing excessive tiny arrays refuse before DTO/kernel construction. Duplicate
scan and preflight charge work and check cancellation/cooperative time. The
bounded JSON document itself and private input still consume memory; process RSS
is not inferred from the count checks.

Original canonical vertices are never transformed again. Recorded source matrices
and unit evidence are structurally validated, not treated as independent proof
that a browser transformed or enumerated the source correctly. A trusted protected
capture producer/server must establish that separate evidence.

The verifier exactly welds coincident vertices across fragment boundaries,
constructs oriented shared-edge connectivity, and decomposes connected closed
shells. Original triangle indices are not replaced with boxes, simplified or
repaired. One source fragment belonging to multiple selected parents is processed
once and keeps every parent membership. Duplicate fragment IDs or duplicate
triangles refuse, rather than removing possibly significant geometry. Disconnected
solids become distinct computational meshes, each retaining triangle-to-fragment,
local-triangle and selected-parent provenance. Per-fragment summaries retain exact
source-subobject raw-JSON hashes and original counts.

Every shell invokes the unchanged B1 kernel's full qualification before success.
Open/inconsistent/ambiguous connectivity, unsupported numeric conditioning and
kernel refusal cannot produce an available result. The whole verifier shares a
40million-unit/60second cooperative budget, including B1 work. This is not a hard
RSS/process guarantee; the caller must retain its independent process limits.
Full declared capacity has not been established by small synthetic fixtures.

Nested shell bounds are conservatively refused as `NESTED_OR_AMBIGUOUS_SHELLS`:
an inner shell might describe a cavity, and must not be filled by union semantics.
This can also refuse a separate solid inside a frame's empty opening. The box is
used only to refuse ambiguous grouping; it never certifies a solid or free space.
General BRep/cavity Boolean reconstruction is unsupported. Non-contained separate
qualified shells have union semantics. Centreline-only B1 limitations remain.

## Receipt and authority

Stdout is one JSON receipt, at most64KiB:

`schemaVersion=wfc.pf.barrier-verification-result.v1`,
`producerVersion=wfc.pf.barrier-verifier.v1`, `status=geometry-qualified|refused`,
`captureSha256`, `evidence` or null, and explicit diagnostics. Evidence contains
capture/model scope, computational shell and source fragment/vertex/triangle
counts, decomposition and verification SHA256, qualified topology/self-intersection
labels and the effective numeric tolerance. It always says
`coverage=provided-fragments-only`, `sdkCoverageVerified=false`, and
`engineeringAccepted=false`. It never claims complete selected SDK enumeration,
administrator authorization, persisted publication, native parity or human review.
The root server wrapper must combine this geometry result with its current
protected intent/SDK closure evidence before publishing a B0 verified manifest.
Exit0 does not imply qualification: callers must inspect the closed status field.

The decomposition digest is a separate versioned binary format. Strings are
UTF-8 prefixed by signed64-bit little-endian byte length; counts/indices are
signed64-bit little-endian; coordinates use binary64 bits with zero normalized.
It binds a version tag, exact capture hash, ordered shell IDs, vertices, indices
and every triangle's source fragment/local index/sorted parent memberships. It
does not pretend to reproduce JavaScript canonical-JSON floating serialization.
The verifier hash binds producer/collision versions, raw capture hash,
decomposition hash, shell count and effective tolerance with a documented
newline-delimited UTF-8 sequence in `BarrierCaptureVerifier.cs`.

Tests reference this project and B1 through project references only; they use
synthetic complete connected openings, fragments forming a closed shell, shared
parent membership, refusals, cancellation and bounds. No real SDK coverage or
converted-model acceptance is implied.
