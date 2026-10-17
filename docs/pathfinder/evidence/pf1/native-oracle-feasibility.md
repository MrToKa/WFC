# Native oracle feasibility — read-only PF-1 investigation

Observed on 2026-10-17. This records prerequisites and a possible PF-2 approach;
it is not a native run, new fixture or native/converted parity result. No native
application was launched, no model data was captured and no model was saved.

## Available local prerequisites

- Explicitly named input exists:
  `D:/OneDrive - ACS/R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC/3D/Aalborg_ACS_CABLETRAY_30_03_26.nwd`.
  Observed size: **155,285,346 bytes**; modification time:
  `2026-10-07T09:04:11.9727663Z`. Its content hash and equality to the converted
  model revision were not established by this investigation.
- `D:/Programs/Navisworks Manage 2027` contains `Roamer.exe`,
  `Autodesk.Navisworks.Api.dll`, `Autodesk.Navisworks.Automation.dll`,
  `Autodesk.Navisworks.ComApi.dll` and `Autodesk.Navisworks.Interop.ComApi.dll`,
  all reporting file version **24.0.1453.24**.
- Visual Studio 2022 Community MSBuild and Roslyn are installed under
  `C:/Program Files/Microsoft Visual Studio/2022/Community/MSBuild/Current/Bin/`.
  The .NET Framework 4.8 reference directory and its `mscorlib.dll` exist under
  `C:/Program Files (x86)/Reference Assemblies/Microsoft/Framework/.NETFramework/v4.8/`.
- Installed files do not establish successful activation, licence availability
  or a successful native export. These require an actual isolated run later.

## Pinned source evidence

All anchors below are relative to the read-only PathFinder checkout
`C:/Users/todor.chankov/.codex/.chatgpt-projects/g-p-6ad0a317833c8191bf8e4e8c824a1056/work/review-pathfinder`,
commit `45c24bf5f433f13e102600b36f20327c77961d0a`.

- `tests/PathFinder.Navisworks.Smoke/Runner.cs:10,55–63` demonstrates an
  STA, package-free .NET Framework 4.8/x64 runner: fresh invisible
  `NavisworksApplication`, `OpenFile`, `AddPluginAssembly`,
  `ExecuteAddInPlugin`, then disposal. It need not change startup configuration.
- `tests/PathFinder.Navisworks.Smoke/SmokePlugin.cs:93–131` exposes the
  existing `extract-model` limitation: at most 5,000 named-leaf AABB rows,
  with explicit truncation. It does not export triangle meshes or full paths.
- `tests/PathFinder.Navisworks.Smoke/RequestedLookupSmoke.cs:115` records
  route length but only the **count** of path points. Detached segment
  diagnostics are written only on failure. This is insufficient as a complete
  replay oracle even though the historical document reports successful routes.
- `AddinRibbon/Services/RoutingSession.Lookup.cs:20` provides
  `CaptureLookupSegmentsAsync`: visible logical-name resolution, ambiguity
  rejection and native capture for the supplied codes.
- `AddinRibbon/Services/RoutingSession.cs:35,233–299` holds private
  `fittedInputs` after capture. These are detached `TrayGeometryInput` values:
  IDs, names, categories, shape labels, world AABBs, face extents and mesh data.
  A test-only reflection exporter can read them without editing the source.
- `AddinRibbon/Services/RoutingSession.cs:199–221` defines effective visibility
  through ancestors and From/To anchors as the bottom centre of the visible
  world AABB, converted from document units to metres.
- `AddinRibbon/Services/TrayMeshReader.cs:16–17,39–64,103–123` captures native
  COM triangle fragments, applies each local-to-world matrix and then the
  document unit scale. Limits are 50,000 primitives and 64 fragments per leaf.
  `RoutingSession.cs:38,272` adds a 128 MiB retained mesh budget. Limits/fallbacks
  must remain explicit in the exported evidence.
- `tests/PathFinder.Navisworks.Smoke/SmokePlugin.cs:2339` demonstrates pumping
  Windows Forms events while the asynchronous capture returns to its API
  thread. A new helper requires STA and a Windows Forms synchronization context.
- `scripts/Test-Navisworks.ps1` builds the original checkout and requires the
  installed AddinRibbon assembly to match its Release build. Running this
  script in the original checkout would violate the isolated-development rule.

## Feasible isolated PF-2 approach

Build a uniquely named net48/x64 native oracle plugin and runner in new owned
isolated source. Compile unchanged copies of the 11 pure core files plus
`RoutingSession.cs`, `RoutingSession.Lookup.cs` and `TrayMeshReader.cs`; the
three capture services have no UI/visualization dependency. Reference the
installed Autodesk libraries without copying or redistributing them. The
net9 `PathFinder.Core.dll` is not the binary loaded into this net48 host.

Give the oracle a unique assembly/plugin identity and load it dynamically into
a fresh disposable automation host. Do not replace or register an AddinRibbon
installation, edit startup configuration or alter existing Navisworks sessions.
The new runner needs bounded execution and cleanup limited to its own process.

Export complete detached geometry inputs and outputs, native item identity and
hierarchy, document units and scale, visibility, rule ordering/categories,
source model identity/checksum, full route points, gap metrics, fallback
diagnostics and explicit From/To/design inputs. Preserve binary64 precision;
round-trip `R` strings can accompany all numerical coordinates and lengths.
Keep exact decimal project settings separately. Temporary capture IDs alone
are insufficient to identify corresponding converted leaves.

The available source and installation make a new capture plausible. Acceptance
still requires running it successfully and pairing the **same** model revision
with converted geometry, verifying identities/transforms/units, and replaying
full-precision native outputs. The historical rounded lookup lengths do not
cover From/To approaches, SECONDARY replacement or design allowances.
