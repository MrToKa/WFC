# Packed barrier part format v1

Frozen PF-B13d local codec contract, based on B13c product efef59ed90a2552d110824dab2149f3c2bc5413b.
This document specifies uploaded original-mesh ranges and independent local
validation. It does not qualify global coverage, occupancy, collision clearance,
capacity, a ready registry, drilling, publication or cable writes. Existing B13a
v2 pages/seals and B13b staging receipts are unchanged. A stored part remains
NOT_VALIDATED until a separate validator actually examines its bytes.

## 1. Fixed layout

All integers and binary64 values use little-endian byte order. There is no
compression, alignment padding, optional section or trailing data. The complete
file is at most33554432 bytes. The first32 bytes are:

| Offset | Bytes | Value |
| --- | --- | --- |
| 0 | 8 | ASCII `WFCPFBP1` |
| 8 | 4 | uint32 version1 |
| 12 | 4 | uint32 descriptorBytes |
| 16 | 4 | uint32 totalBytes, exactly the complete file length |
| 20 | 4 | uint32 rangeCount,1..8192 |
| 24 | 8 | All zero; not an extension field |

Exactly descriptorBytes bytes of canonical ASCII JSON follow the header. Then
one binary range follows for each descriptor row, in that same order. All
lengths, additions and multiplications must be checked before allocating or
reading. Header counts must equal the descriptor and measured layout; no
prefix-only, concatenated-file or trailing-byte acceptance is permitted.

## 2. Descriptor and trusted expectations

The descriptor has exactly these fields:

```text
{
  schemaVersion: 'wfc.pf.barrier-packed-part.v1',
  codecVersion: 'wfc.pf.barrier-packed-mesh.v1',
  intentId, contextSha256, scopeSha256, profileSha256, frameSha256,
  producerProfile: <the exact five-field B13c producer profile>,
  roots: {nodes, fragments, 'geometry-ranges', plan},
  partIndex,
  sourceGeometryProvenance: 'protected-producer-reported',
  sdkSourceBytesVerified: false,
  ranges: [<range descriptors>]
}
```

All roots are non-null lowercase SHA256; intentId is the exact server session
UUID. contextSha256 is the immutable B13c context root, including its exact
Viewer/frame/producer profile and original deadline. frameSha256 is that frame
observation's contentSha256. The profile is exactly:

```text
{schemaVersion:'wfc.pf.barrier-multipart-producer.v2',sdkVersion:'7.130.0',
 triangleOrder:'sdk7130-rendered-triangle-order-v1',
 geometryDigest:'sha256-bounded-chunk-chain-v1',
 visibility:'selected-scope-includes-hidden-geometry-v1'}
```

Each range descriptor is exactly the B13a geometry-range row plus rangeOrdinal
and rangeSha256. The latter is the existing B13a domain hash of the original
row, excluding those two added fields. No owner names, coordinates or matrices
appear in JSON. Source ownership and counts are independently supplied by an
externally trusted cursor of `{placement, range, fragment}` from the exact sealed
plan, geometry-range and fragment pages. A self-consistent payload descriptor
cannot supply its own expected roots or source bounds.

ExpectedPart is the small `{context, rangeCount, plannedEncodedBytesUpperBound}`;
context is the descriptor without ranges. Consume expected tuples in lockstep,
with explicit exhaustion at the end. At most the current bounded part may be
retained; do not build a whole-model expected catalog. Shared DTO parsing alone
grants no trusted status to an expected value.

For independent validation of a stored part, the trusted caller additionally
supplies the exact raw stored-file SHA256 and byte length from its durable
receipt/allocation proof. This is a validator input wrapper outside pre-encoding
ExpectedPart and outside the binary format. Compare those expected values before
accepting a report. A changed finite xyz bit under a fixed receipt must refuse;
a newly self-asserted coordinate payload with a newly matching raw hash still
does not prove correspondence to the full SDK source bytes.

Every descriptor row must match its trusted range, its B13a range hash and exact
plan placement. Source geometry/transform/membership and referenced count must
match the trusted fragment. Original IDs must be below its sourceVertexCount;
triangleStart+triangleCount must not exceed sourceTriangleCount. Range ordinals
are contiguous; within one fragment triangle ranges are contiguous, and the next
fragment starts at triangle0. A first range may continue a fragment from the
preceding part. Missing, duplicate, foreign or reordered expected rows refuse.

## 3. Binary range order and original remapping

For V=referencedVertexCount and T=triangleCount, each range contains exactly:

| Section | Values | Bytes |
| --- | --- | --- |
| Original matrix | 16 source Float64 | 128 |
| World matrix | 16 world Float64 | 128 |
| Canonical matrix | 16 canonical-world-metres Float64 | 128 |
| Original vertex IDs | V uint32, strictly ascending | 4V |
| Source-local coordinates | V xyz triples, Float64 | 24V |
| Remapped triangle indices | 3T uint32 in original rendered order | 12T |

Thus rangeBinaryBytes=384+28V+12T. The xyz tuple at local index i belongs to
originalVertexIds[i]. Each remapped index must be below V, and expanding it
through that map must reproduce the exact B13c rendered original-index chain.
Every map entry must be referenced at least once; no invented or unused vertex,
welding, simplification, clipping, reordered winding or hole filling is allowed.
Each triangle has three distinct indices; this is not a manifold or nondegeneracy
qualification. Physical occurrences and shared original geometry remain distinct.

Float64 payload bits preserve signed zero. Reject NaN/infinity. Source-local
coordinates retain the B13c absolute bound1e12; transformed canonical coordinates
retain1e9. Matrices are column-major, finite, absolute entries at most1e9,
affine bottom row0,0,0,1 and nonsingular, as in B13c. Recompute the exact transform
chain root below. With the trusted observed frame, require world=model*original
(or original when modelTransform is null), and canonical=displayToWorld*world.
Matrix products use the B13c left-to-right sum of four binary64 products, rounding
each operation; no fused multiply-add or tolerance-based repair. Compare matrix
bits, including signed zero. Placement is not applied a second time.

The trusted frame input is the bounded canonical B13c frame-hash-input UTF8 bytes
(contentSha256 excluded), plus the externally expected frame hash. Hash these
exact bytes, strict-parse the frame, and use its bound matrices. Do not accept
unrelated caller matrices beside an unchecked claimed frame hash.

## 4. Canonical bytes and hashes

Descriptor JSON uses ASCII only, sorted object keys, compact JSON with no
whitespace, duplicate members, escaping alternatives or optional members. Arrays
retain order. Integers are unsigned decimal without exponent, leading zeros or
signed zero. The sole boolean is literal false. All strings are fixed ASCII
versions, UUIDs, masks or hashes; there are no floating JSON values. A decoder
must compare exact canonical bytes with the externally expected metadata rather
than normalizing malformed input into an accepted value.

descriptorSha256 hashes canonical UTF8/ASCII JSON of:
`{domain:'wfc.pf.barrier-packed-mesh.v1/descriptor',value:descriptor}`.
payloadSha256 is ordinary SHA256 of every raw file byte, including header.
They are separate identities. Existing scope/profile/page/seal/range domains and
B13c chunk-chain roots must not be replaced by either hash.

B13c chunk-chain algorithm is unchanged. Canonical JSON here means sorted compact
JSON of the following integer/string metadata. For domain D and manifest M:

1. prefix=`{schemaVersion:'sha256-bounded-chunk-chain-v1',domain:D,manifest:M}`.
   Set previous=SHA256(UTF8(canonical(prefix))), totalBytes=chunks=segmentCount=0.
2. Iterate segments in order. For each, assign segmentOrdinal=segmentCount++;
   split it into chunks of at most262144 bytes. For each chunk at its offset,
   compute sha256=SHA256(raw chunk), add its length to totalBytes, then replace
   previous with SHA256 of canonical UTF8 JSON
   `{schemaVersion:prefix.schemaVersion,domain:D,previous,segmentOrdinal,offset,
     bytes:chunkLength,sha256,chunkOrdinal:chunks++}`.
3. Result=SHA256(UTF8(canonical(
   `{...prefix,previous,totalBytes,chunks,segmentCount}`))).

For original vertex IDs, D=`sdk7130-ordered-original-vertex-ids-v1`,
M=`{encoding:'uint32-little-endian',values:V}`. For reconstructed original
indices, D=`sdk7130-rendered-original-indices-v1`, same M with values=3T.
In BOTH cases B13c supplies each consecutive at-most262144-byte uint32LE slice
as a SEPARATE segment. Consequently offset is0 for each slice and
segmentOrdinal equals chunkOrdinal. Treating the entire array as one segment
with growing offsets would create a different root.

For transforms, D=`sdk7130-canonical-transform-v1`,
M=`{scopeSha256,frameSha256,encoding:'binary64-little-endian-preserve-signed-zero',
segments:['original','world','canonical']}`. There are exactly three128-byte
segments, in that order, each with one chunk at offset0.

sourceGeometrySha256 is the B13c digest of full raw SDK buffers/group metadata,
including unused bytes absent from a remapped range. It is retained explicitly
as protected-producer-reported provenance; sdkSourceBytesVerified is false.
Local payload/remap/transform validation does not independently reconstruct
that full root or prove real SDK/Aalborg capture. Stronger source witnesses need
a new additive contract rather than reinterpreting this digest.

## 5. Bounds and result

The header plus canonical descriptor with ranges=[] must be at most8192 bytes.
Each serialized range row plus one possible comma must be at most4096 bytes.
There are at most8192 rows/references,500000 referenced vertices and250000
triangles in one part. Counts and exact actual bytes must fit the unchanged
32MiB part cap and the B13a bound:
`8192 + sum(4096 + 128V + 48T)`.
Actual descriptor/binary bytes, not count estimates, determine the raw file size.
Source array count/ordinal arithmetic stays within B13a uint32 and safe-integer
limits. No allocation from an unchecked header or descriptor is permitted.

A successful independent local report is exactly:

```text
{schemaVersion:'wfc.pf.barrier-packed-validation.v1',context,
 descriptorSha256,payloadSha256,
 counts:{ranges,fragmentRefs,vertices,triangles,bytes},
 geometryValidation:'STRUCTURAL_ONLY',qualification:'NOT_MEASURED',authority:'none',
 sourceGeometryProvenance:'protected-producer-reported',sdkSourceBytesVerified:false}
```

This is a separate report; shape parsing does not prove execution. B13b receipts
remain unchanged/unvalidated. No local report means global complete coverage,
closed solid/topology, free space, a ready barrier head or publication. Exact
stored-part receipts, final current owner/login/load/head, original deadline and
unknown-command reconciliation remain mandatory in the surrounding pipeline.

Shared exports are BARRIER_PACKED_GEOMETRY_FORMAT;
barrierPackedRangeDescriptorSchema, barrierPackedPartContextSchema,
barrierPackedPartDescriptorSchema, barrierPackedExpectedRangeSchema,
barrierPackedExpectedPartSchema, barrierPackedPartValidationReportSchema and
their BarrierPacked* inferred types; barrierPackedDescriptorBytes,
barrierPackedDescriptorHashInput, barrierPackedRangeBinaryBytes and
barrierPackedMeasureDescriptor. Runtime-native and C# implementations consume
this same layout without importing TypeScript into the protected frame.
