# Isolated native reference oracle

This test-only helper reads a copied NWD through installed Navisworks Manage
2027. It is not part of the web runtime and is never needed by the eventual
offline routing workflow. It changes no installed plugin or startup settings.

`Pinned/` contains byte-preserved copies of the eleven reference calculation
files and three native capture service files from PathFinder
`45c24bf5f433f13e102600b36f20327c77961d0a`.
`source-provenance.json` records their hashes. The oracle uses a unique
`Wfc.PathFinder.NativeOracle.Plugin` assembly and `PathFinderNativeOracle.PF2L`
plugin identity. It loads into its own disposable automation host.

## Build and run

Use installed Visual Studio MSBuild, .NET Framework 4.8 references and the
installed Manage 2027 API DLLs. No NuGet packages are required. Autodesk DLLs
are referenced from the installation and are not copied into this repository.

```powershell
$pfMsbuild = 'C:/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Current/Bin/MSBuild.exe'
& $pfMsbuild pathfinder-engine/tools/PathFinder.NativeOracle/NativeOracle.Plugin.csproj /t:Build /p:Configuration=Release /v:minimal /nologo
& $pfMsbuild pathfinder-engine/tools/PathFinder.NativeOracle/NativeOracle.Runner.csproj /t:Build /p:Configuration=Release /v:minimal /nologo
& ./pathfinder-engine/tools/PathFinder.NativeOracle/Run-NativeOracle.ps1
```

The supervisor first hashes and copies the explicitly supplied source NWD into
owned ignored `.scratch/pf2-native/input/`; the native host opens only this
copy. It refuses to overlap an existing Manage session. Each run gets a fresh
directory, stdout/stderr logs, progress JSON, specification and capture. The
supervisor records source/copy hashes again after completion and writes a
compact receipt under `docs/pathfinder/evidence/pf2/native-*.json`.

The hard supervisor limit is 300 seconds; the native capture token allows
240 seconds. Native calls are synchronous and may not stop mid-operation.
Timeout cleanup verifies the owned runner/new hidden automation host by
process identity, creation time, executable path and `-Embedding` command line.
Existing or visible user processes are preserved. The helper never saves the
model. Licence or account prompts must not be automated.

## Capture contract

`capture.json` has schema `native-oracle.capture.v1`. It retains host/source
identity, unit conversion, modification state, elapsed times and native limits.
Each `requests[]` item contains:

- `caseId`, entered `routeText`, parsed order, explicit `options` and category
  policy (`All`, matching native ordered capture).
- `inputs`: complete detached `TrayGeometryInput` fields, native fragment
  boundaries, canonical world-metre vertices and triangle indices. Every
  coordinate/metric has invariant binary64 round-trip `R` string companions.
- `leafEvidence`: capture ID mapping, leaf-to-root names/classes/instance GUIDs,
  sibling indices, original hidden flags, effective visibility, all node
  properties (or explicit failure if the cap is exceeded), native AABBs,
  active transforms and per-fragment COM local-to-world matrices.
- `fittedSegments`, measured ports, clearance surface counts, complete ordered
  lookup `pathPoints`, route/segment order, geometric/approach/gap metrics.
- `automaticCases`: two fixture calculations using the real captured network.
  One uses actual native visible-leaf bottom AABB anchors. The second uses an
  explicitly manual from-point 4.25 m above that native anchor to exercise
  SECONDARY. Neither claims automatic equipment identification.
- `diagnostics`: measured/fallback counts and messages, missing mesh IDs,
  selected/used leaf counts, timings and explicit scope/truncation indicators.

The automatic fixture allowances are explicitly **synthetic 5 m SECONDARY,
6 m reserve and 5% increase**. They exercise the unchanged C# double-to-decimal
conversion and design formula; they are not production Project Details values.
The complete decimal breakdown and cast values are serialized as strings.

Native fragment world matrices operate in document units; the native unit
scale is applied once afterward, exactly as the pinned `TrayMeshReader` does.
No Viewer global offset or second root transform is applied here. Native
counter IDs and names alone do not establish cross-conversion identity.

The selected networks are bounded reference cases, not a truncated whole-model
inventory. Real native/converted parity requires separate deliberate pairing
and comparison. A successful capture alone makes no parity or readiness claim.
