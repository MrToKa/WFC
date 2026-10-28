# PF-B13d — packed original geometry and independent local validation

Status: **TECHNICAL SOURCE PASS**. Branch
`pf-b13d-packed-geometry-local-20261022`, parent
`b896cef828d8bf6c8b79abe5ee9a2e2c7cef381c`. The sanitized receipt
`evidence/barriers/b13d-packed-geometry.json` pins all 21 implementation,
contract and plan files. No installation on 5191, published barrier head or
real cable write was performed. The reported whole-Aalborg extraction failure
is still an unfinished end-to-end task.

## Implemented

Format100 specifies fixed little-endian headers, canonical bounded descriptors,
binary64 local coordinates and all three transforms, ordered original vertex
IDs and remapped original triangle order. Parts retain physical instances,
rendered group gaps, baseVertex, signed zero and range/part boundaries. They do
not simplify triangles, fill openings or replace geometry with bounding boxes.

The native producer continues the same bounded scene after sealed planning,
reacquires original geometry and transform identities, detaches bounded arrays,
encodes each part and waits for its exact acknowledgement. Final hierarchy and
frame bookends run after the last upload. Metadata remains within the original
20 MiB lookup plus 5 MiB other budget; a separate fragment witness bitset fixes
the destructive high-bit owner marking without increasing that budget.

The runtime requires the exact planned contiguous part count and all four seals,
including a currentness check after producer EOF. These remain staging-only
observations. The internal repository readPart seam validates current protected
ownership/context, durable stored allocation and raw bytes before returning one
bounded part. It adds no general HTTP file reader or lease renewal.

The separate C# PackedPartReader validates exact bytes against an independently
supplied stored receipt, bounded frame and tuple cursor. It verifies descriptor,
source index chains, minimal remapping, bounds, transform relationships and exact
EOF. V1 readers and collision kernels are unchanged. Shared, native and C# reports
remain STRUCTURAL_ONLY / NOT_MEASURED / authority none.

## Actual checks

Root executed all checks; agents authored or reviewed source only.

| Check | Result | Scope |
| --- | --- | --- |
| Final native suite | PASS 52, zero skips | Codec11, simulated SDK producer26, lifecycle11, copy closure4 |
| Shared contracts | PASS 11 | Exact shape, limits, descriptor and authority boundaries |
| Fresh Linux/PostgreSQL | PASS 14 | Opaque stored-part read/currentness, 35 source bookends; no codec or real-model proof |
| C# Windows | PASS 31 local cases plus all 26 JS→C# goldens | Console32 includes one aggregate golden runner; do not count it again |
| C# Linux | PASS 31 local cases plus all 26 goldens | Same source-linked portable DLLs, .NET9.0.21, one 512 MiB test helper |
| Source/artifact/golden bookends | PASS | Actual copied source and build→artifact→Linux hash link independently checked |
| Helpers and processes | PASS | Each new runtime-probe/test helper joined with PID0, no OOM, removed; no host ports/network |
| Types, scoped lint, server/frontend builds | PASS | No lint warnings; frontend retains its existing large-chunk advisory |
| Independent reviews | CLEAR | Native, C# and stored-read/lifecycle contracts |

The 26 goldens include sparse IDs, signed zero and four-product matrix sums,
transformed physical instances, one fragment split into two parts with 120000
source IDs per part, uint32 hash-chain segment boundaries, fixed-receipt tamper,
rehashed malformed data, wrong context/roots/frame/source bounds and missing or
extra expected rows. Six are structurally valid controls and twenty must refuse.

The final browser runtime inventory is 236 files / 83410576 bytes; unchanged
SDK7.130.0 is 206 files / 82552768 bytes. These are build inventories, not actual
SDK execution or full-model capacity results. The Linux helper has a hard
512 MiB limit; actual peak RSS and whole-parent capacity remain NOT_MEASURED.

Retained failures: the first new C# build lacked generated restore assets
(NETSDK1004); offline BCL-only restore and subsequent builds passed. Linux
attempt9ca1809a passed the console but failed the final source-copy comparison
because two file inventories used different sort orders. The correction uses
one ordinal ordering without weakening identity/hash/length checks. Fresh
attempt8cde7976 passed every guard. Both attempts positively removed their own
two helpers. Earlier native pre-review results remain historical; final52 is
the current full cohort after numerical and input-closure fixes.

All logs, fixture inputs, snapshots, build receipts and failed attempts remain
private under operation61f194f1-40dd-4af4-9d23-9187c5f8224a. No credentials or
business rows are included in the public receipt.

## Required subsequent gates

The full SDK sourceGeometrySha256 covers original buffer/group bytes absent
from remapped ranges. Its provenance is explicitly protected-producer-reported;
sdkSourceBytesVerified remains false. A changed finite coordinate with the old
receipt refuses; a newly matching receipt can pass structural checks without
authenticating original SDK correspondence. The goldens demonstrate this limit.

Four seals and all part receipts also do not prove the producer's final bookends
succeeded. A regression now demonstrates failure after the last acknowledged
part. The next stage must retain a separate protected producer completion receipt
bound to exact context/roots/ordered parts/currentness after those bookends.
That receipt is producer-reported completion, not independent SDK attestation.
Future publication must require it together with independent global validation.

Global cross-part coverage and surface/solid policy, bounded catalogs/queries,
own-endpoint first exit/final entry, atomic publication, write-proof and UI wiring
remain required by plan96. Actual SDK/Aalborg capture, openings and the reported
cable remain BLOCKED by the saved browser refusal; no retry or alternate access
path was used. Do not install incomplete multipart source or call it a real-model
fix. Current 5191 web814475f9/APIac0d16ab remain unchanged.

Fresh read-only origin/main is96e63f13 and matches the clean original WFC.
At this parent the local checkout is182ahead/3behind cached origin/main; this is
not remote parity. GitHub branch search returned an empty matching branch list;
PR and CI state were not established. No push/PR/merge occurred. Separate
Preparer checkpointa3461c69 is clean and preserved; its main5180 backup/restore,
update and Autodesk flow remain separate unfinished work.

Apply prepare-stage-handoff for the durable completion prerequisite and execute
it immediately on a new inherited local branch under the user's authorization.
