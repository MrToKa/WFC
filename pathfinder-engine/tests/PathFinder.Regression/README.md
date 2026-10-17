# Extracted core regression harness

The eight original C# test sources are unchanged copies from PathFinder commit
`45c24bf5f433f13e102600b36f20327c77961d0a`. Their hashes and the extracted core
source hashes are recorded in `../../source-provenance.json`.

The project references `PathFinder.Core.csproj`; it does not compile copies of
the routing implementation. `EntryPoint.cs` verifies the separate assembly and
its dependency references, then invokes the original harness entry point.
This assembly audit is separate from the original 105 regression checks.

Run with .NET 9 SDK from this isolated worktree:

```powershell
$env:DOTNET_CLI_HOME = Join-Path (Resolve-Path .) 'pathfinder-engine/.dotnet-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
dotnet run --configuration Release --project pathfinder-engine/tests/PathFinder.Regression/PathFinder.Regression.csproj
```

The optional final argument remains supported:

```powershell
dotnet run --configuration Release --project pathfinder-engine/tests/PathFinder.Regression/PathFinder.Regression.csproj -- <absolute-private-fixture-json>
```

Only supply a real, authorized private fixture. It is not included in this
repository and was not used in PF-1 validation. The default run has 105 checks;
the optional private Excel-name group would be an additional check.

These are synthetic detached-core tests. They do not establish native versus
converted geometry parity, web integration, model identity or runtime security.
