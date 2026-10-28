# Structural original-triangle catalog v1

`SurfaceCatalogCompiler.Compile` consumes one-pass raw canonical sealed pages,
four seals, exact original part receipts and producer completion, scope/profile
hash envelopes and the full frame. It independently validates their hash chains,
counts, ordered complete ranges, owner node ordinal/dbId/mask and selected-parent
coverage. Node lookup is 20 bytes per node. It does not prove SDK ancestry,
independent SDK source bytes, current authorization, solid occupancy, collision
clearance, registry publication or routing authority. Lines/points/unknown and
unavailable inventory remain refused under the existing v2 profile.

`PackedPartReader.VisitValidatedPart` snapshots at most one 32 MiB part and
validates every range, binary/descriptor EOF and expected-cursor disposal before
its first callback. Range transforms are detached 384-byte copies. Triangle
points and original source indices are immutable values; canonical coordinates
use the reader's existing separate binary64 Product/Add operations. Consumer
exceptions and cancellation cannot return success. The source enumerators and
callbacks must themselves be bounded and cancellable; synchronous caller code
cannot be preempted by this library.

Compiler limits are independently lowerable: 1,048,576 nodes/fragments/parts,
16,777,216 ranges, 65,536 pages, 4,096 triangles/page, 50,000,000 triangles,
8 GiB aggregate input/output, one billion work units, 15 minutes and a 64 MiB
free-space floor. Existing packed/v1 ceilings and the external 512 MiB process
guard are unchanged. These ceilings are refusal bounds, not measured capacity.

All integers are little-endian. Float values preserve binary64 bits including
signed zero. Hash fields below are raw 32-byte SHA256 values.

* `pages/00000000.bin` etc: magic `WFCPFTC1`; 80-byte header: U32 version1@8,
  U32 pageIndex@12, U64 firstGlobalTriangle@16, U32 count@24, U32 recordBytes96@28,
  six F64 coordinate-derived bounds@32. Each 96-byte triangle: U32 rangeOrdinal@0,
  fragmentOrdinal@4, original triangle ordinal@8, original vertex IDs@12/16/20,
  nine canonical F64 XYZ values for A/B/C@24.
* `index.bin`: magic `WFCPFTI1`; 64-byte header: U32 version1@8,
  recordBytes128@12, pageCount@16, U64 triangleTotal@24; remaining bytes zero.
  Each 128-byte record: U32 pageIndex@0/count@4, U64 firstTriangle@8/bytes@16,
  page SHA@24, six F64 bounds@56, 24 zero bytes@104.
* `ranges.bin`: magic `WFCPFRG1`; 64-byte header: U32 version1@8,
  recordBytes768@12, U64 rangeCount@16, remaining bytes zero. Each 768-byte record:
  U32 fragmentOrdinal@0/fragmentId@4/ownerNodeOrdinal@8/ownerDbId@12; mask16@16;
  U32 rangeOrdinal@32/partIndex@36/triangleStart@40/triangleCount@44/
  referencedVertices@48/sourceVertices@52/sourceTriangles@56; U32 zero@60;
  sourceGeometry SHA@64/transform SHA@96/sourceVertexIds SHA@128/
  sourceIndices SHA@160/range SHA@192/part payload SHA@224; original/world/
  canonical matrices, each 128 bytes, @256/384/512; descriptor SHA@640,
  original command SHA@672, canonical original receipt SHA@704;
  U64 firstGlobalTriangle@736; 24 zero bytes@744.
* `range-index.bin`: magic `WFCPFTR1`; 64-byte header: U32 version1@8,
  recordsPerPage256@12, U64 rangeCount@16, U32 pageCount@24, remaining bytes zero.
  Followed by ordered 32-byte SHA values for each contiguous up-to-256-record
  range data chunk (range-file header excluded).
* `catalog.json`: at most 64 KiB canonical sorted JSON, emitted last. It binds
  context/roots, completion/part-chain hashes, exact counts and all three index/
  range file hashes and sizes. OutputBytes includes this final manifest.

Files are created exclusively under a new absolute directory after rejecting
existing/reparse/symlink ancestors. Generated data is flushed and read back
through the cold reader, including all pages, before final manifest creation.
The optional currentness hook runs after validation and pending-file flush,
immediately before the final rename. Failure leaves no valid `catalog.json`;
own partial outputs remain for explicit diagnosis. This local artifact protocol
is not server publication or an independent directory-durability receipt.

`SurfaceCatalogReader.Open(directory, expectedManifestSha256)` owns compact
authenticated index bytes, hashes the complete range file and checks global
range/index/count/EOF continuity. Each range chunk is hash-checked into a private
bounded cache; exposed transform memory is copied. Each triangle page is fully
hashed and validated, including provenance/global ordinal and coordinate-derived
bounds, before callbacks. No query or collision API is implemented here.
