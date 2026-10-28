# Raw capture normalization and selected native comparison

The two tools work on files and do not operate a browser, native application, WFC API, original database or storage.
They write fresh receipts and snapshots under owned ignored `pathfinder-engine/.scratch/pf2-converted/` directories.
Synthetic tests retain compact evidence under `docs/pathfinder/evidence/pf2/converted-*`.

## Normalize a completed selected converted capture

```powershell
node pathfinder-engine/tools/model-capture/normalize.mjs <mesh-capture-receipt.json> <project-id> <model-version-id> [complete-inventory-receipt.json]
```

The tool verifies each named raw part's exact byte count and SHA256, case/capture identity, counts, parent chain,
finite canonical coordinates, bounds, triangle indices, recorded matrix composition and sample mapping. Duplicate
JSON members are rejected before parsing can lose them. A complete hierarchy inventory, when supplied, is verified
separately for identity/count/parent/cycle integrity and checked against selected object/fragment associations.

The output is strict `pathfinder.model.snapshot.v1`: selected physical route-owner candidates use
`geometryRole: routing-leaf`, preserve version-local identities and parent references, full leaf-to-root names,
properties, world bounds and triangle fragments. Already-canonical vertices are copied without applying recorded
transforms a second time. External identity collisions remain explicit and do not choose a candidate.

Native inherited visibility, production category assignments, source linkage and independent unit/transform
proofs remain unresolved. The normalizer does not promote supplied metadata booleans into proof: `nativeHidden`
stays null, categories remain unassigned/empty, and all readiness-proof flags stay false. Its provenance receipt
retains raw display flags, metadata, matrices, owner candidates and discarded unsupported assignments. A selected
mesh snapshot remains partial even when a separate full hierarchy inventory was successfully verified.

No ancestor AABB or mesh is fabricated to fill missing physical data. Partial snapshots retain parent IDs whose
objects are outside the selected scope; the Model reader marks their inherited visibility unknown. Original capture
diagnostics and completeness claims are retained at their actual scope.

## Compare independently captured references

```powershell
node pathfinder-engine/tools/model-capture/compare.mjs <native-capture.json> <converted-mesh-receipt.json> [reviewed-pairs.json] [converted-engine-evaluation.json]
```

Without a reviewed pair map the output is BLOCKED, with exact full-hierarchy candidates for review. Matching names
are never automatically accepted. The map is `pathfinder.converted.native-pairs.v1` with exact native/converted
capture hashes, caseId and unique pairs containing nativeId, convertedId, nativeIdentitySha256,
convertedIdentitySha256 and an explicit decision/provenance string. Candidate identity hashes include native
instance GUIDs/classes/sibling indices and converted external IDs/dbIds/hierarchy. They bind a review decision;
they are not account authorization or cryptographic proof of the cloud translation source.

The optional computed evaluation is `pathfinder.converted.engine-evaluation.v1`, bound to the converted raw capture
receipt hash and caseId, with fittedSegments, options, lookup and automaticCases. It must come from a separate actual
engine execution. Without it fitted ports/routes remain NOT_RUN and the comparison stays BLOCKED.

Comparisons retain field-specific results for world AABBs, bottom centres, full hierarchy, shape/route labels,
fragment and vertex counts, ordered triangle topology/vertices, fitted points/ports/surfaces, exact route order/IDs,
path points, gap metrics, SECONDARY flags and exact decimal design strings. Native round-trip `R` companions are
preferred over the legacy serializer's decimal rendering. Numeric coordinate/length comparison uses a fixed strict
1e-9 m **diagnostic** threshold; discrete values and decimal strings are exact. This synthetic PF math threshold
does not establish an accepted tolerance for actual native/converted tessellation or engineering use. Real-model
engineering tolerance and acceptance remain explicitly `NOT_ESTABLISHED`, even when diagnostic comparisons pass.
Differing mesh tessellation/order is reported rather than silently
equated; no geometric remapping or altered engineering threshold is used to obtain a pass.

The comparison scope is the selected captured case. It never authorizes engineering writes or claims whole-model
coverage. Unknown native planning visibility and production category eligibility remain separate NOT_RUN checks.
Synthetic fixtures are explicitly labeled `synthetic-comparator-controls` and cannot establish native parity.

## Reproducible tests

```powershell
node --test pathfinder-engine/tools/model-capture/test/normalization.test.mjs
```

The tests create small synthetic raw files and exercise the real hash-loading/CLI path, canonical transforms with
nontrivial rotation/unit scaling/large offsets, missing proofs, ambiguous identities, corruption/path rejection,
geometry validation and comparison negative controls. They print an owned snapshot path for strict .NET interop:

```powershell
$env:DOTNET_CLI_HOME = Join-Path (Get-Location) 'pathfinder-engine/.dotnet-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
dotnet run --project pathfinder-engine/tools/model-capture/test/SnapshotInterop.csproj -c Release -- <owned-snapshot.json>
```

Each raw part is capped at 32 MiB, receipts at 16 MiB and the complete raw read at 512 MiB. Selected scope is capped
at 4,096 objects, 8,192 fragments, five million vertices/triangles and 512 hierarchy levels. The tools use no network
and do not offer a host hard deadline; they are bounded local file operations. The engine runner's separate hard
deadline remains the appropriate boundary for calculation work.

Actual native/converted comparison remains blocked until Navisworks produces an authorized complete native oracle
capture. The native host currently reports Manage2027 entitlement unavailable; no account or licence changes are
attempted here. Successful actual browser capture is tracked separately from that native prerequisite.
