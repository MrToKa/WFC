# Constrained routing checks

This console suite references the actual `PathFinder.Core` and
`PathFinder.Barriers` libraries. It does not compile another copy of their sources,
change the frozen parity fixtures or use Viewer/native/database/runtime resources.
Its box and connected-tunnel fixtures must pass the independent closed-triangle
kernel's qualification before the constrained calculator receives their queries.

The suite covers actual material/opening/floor intersections; alternative
accessible tray projections; graph edges, measured and zero-ranked connectors;
verified opposing ports; final independent polyline and single-point checks;
direct SECONDARY fallback/bypass; deterministic ties; shared limits, uncertainty
and cancellation. Unobstructed first-pair checks compare every route field and
binary64 coordinate/length bit pattern, then every authoritative Core design
decimal output under three allowance settings. Expanded Adapter ledger transport
qualification remains in the separate existing ledger suite.

Run from the isolated worktree, with the root executor selecting its own build
artifact directory as required:

```powershell
dotnet run --project pathfinder-engine/tests/PathFinder.Constrained.Tests/PathFinder.Constrained.Tests.csproj --configuration Release
```

The final JSON and process exit code report the actual run. Synthetic PASS is not
converted-model coverage, physical cable-radius clearance, native parity or
engineering acceptance. No cable data is written.
