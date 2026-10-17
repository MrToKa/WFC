# PF-2 model preparation checkpoint

`PathFinder.Model` is a .NET 9 library referencing the unchanged independent Core
DLL. It is not a WFC endpoint, native exporter or browser capture implementation.
The snapshot contract is documented in `docs/pathfinder/contracts/pf2/README.md`.

`SnapshotReader.Read(utf8, limits, token)` validates a strict canonical snapshot.
`FittedModelCache(ownedDirectory, limits).GetOrBuild(utf8, rules, token)` fits it
through `TrayGeometryBuilder.Build`, or restores a matching fitted cache.
`AffineTransform` provides binary64 column-major composition/inversion and the
explicit world/display offset conversion. The model boundary admits vertices
already in canonical right-handed Z-up metres and never reapplies their recorded
source/fragment transforms.

The cache retains fitted centreline points, ports, counts and diagnostics. It
shares fitted objects within a bounded in-process cache. After a process restart,
it restores centreline/port data and reconstructs physical surface BVHs through
the unchanged public Core factory. It **does not cache RouteCalculator's graph**:
that graph is built for each calculation. Raw snapshot bytes, rules, exclusions,
resource limits and the pinned Core version participate in the cache key.

Payload SHA256, manifest identities, bounded reads and atomic individual-file
publication detect corruption/stale/incomplete entries. Incomplete/corrupt
entries fail explicitly and remain available for inspection. SHA256 is integrity
checking for a trusted owned cache, not authorization against a malicious actor
who can replace both files. Concurrent workers/processes should use separate
owned directories until shared cache publication/locking is implemented.

Readiness remains `needs_review` for partial inventory/mesh, unknown native
visibility/units/transforms/source correspondence, ambiguous external identities,
unassigned categories or core fallbacks. A fitted snapshot is never itself an
engineering-write authorization: `ReadyForEngineeringWrites` is always false.
Native visibility includes ancestors; Ghost, camera occlusion and isolation are
deliberately absent from the planning input. Unknown visibility is reported and
fitted provisionally; it does not silently disappear from the route map.

For a visible equipment object the stored reference is the centre of the bottom
face of its canonical world AABB. Hidden/unknown objects retain their visibility
state; consumers must resolve that state before accepting a location binding.

Default limits are explicit implementation ceilings, not measured proof that
the plant fits: 256 MiB JSON, 1,000,000 objects, 100,000 fragments, 5,000,000
vertices/triangles, hierarchy depth 512 and two in-memory fitted models. Real
capture integration/performance and a process-level preparation deadline remain
pending. Parsing is bounded; cancellation is checked between validation/fitting
operations and follows the unchanged Core's cooperative cancellation behavior.

Run the isolated synthetic tests from the WFC worktree root:

```powershell
$env:DOTNET_CLI_HOME = Join-Path (Get-Location) 'pathfinder-engine/.dotnet-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
dotnet run --project pathfinder-engine/tests/PathFinder.Model.Tests/PathFinder.Model.Tests.csproj --configuration Release -- .
```

Tests write owned caches under ignored `pathfinder-engine/.scratch/model-tests-<unique-id>` and compact
new evidence under `docs/pathfinder/evidence/pf2/model-*`. They do not modify
PF-0/PF-1 receipts, source fixtures or any original installation.
