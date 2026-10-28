# ModelCheck — isolated converted-model diagnostic

This CLI reads a strict normalized PF-2 snapshot, fits it through the unchanged
Core, tests memory/disk cache consistency and performs **ordered route lookup**.
It returns exact core path/segment order, full binary64 metrics and `R` string
companions, fitting counters, readiness, proof flags and measured runtime/memory.

Lookup has no equipment From/To approaches or project design allowance result.
Unknown production category assignments stay unknown; the tool does not invent
categories or read Project Details/database values. A successful diagnostic
route is not native parity, engineering acceptance or permission to apply data.
Partial selected captures retain their `needs_review` status.

Build from the isolated WFC worktree with the private .NET home configured:

```powershell
dotnet build pathfinder-engine/tools/PathFinder.ModelCheck/PathFinder.ModelCheck.csproj --configuration Release
dotnet pathfinder-engine/tools/PathFinder.ModelCheck/bin/Release/net9.0/PathFinder.ModelCheck.dll `
  --snapshot pathfinder-engine/.scratch/normalised-case.snapshot.json `
  --cache pathfinder-engine/.scratch/modelcheck-case-cache `
  --route /C135/C134/C133 `
  --output docs/pathfinder/evidence/pf2/model-actual-case-unique.json `
  --max-ms 120000 --tolerance-metres 0.25
```

Every result path must be new; an existing receipt is never overwritten. Use
an empty uniquely owned cache directory to measure a cold fit. The report states
whether the first read was already a disk hit. A second cache instance restores
the same fit in the worker and compares the exact path/counters/diagnostics.

The parent CLI supervises a hidden worker process and terminates its entire
process tree at the declared budget, capped at 120 seconds. The Model/Core
worker additionally receives a cooperative cancellation token. Exit codes:
0 completed successful route; 1 cache consistency failure; 2 invalid input;
3 completed controlled no-path; 4 hard/cooperative deadline exceeded.

The fixed node/connection budgets and sample/secondary/vertical values are
recorded explicitly as **diagnostic options**. They are not authoritative
project settings; lookup ignores equipment approach/SECONDARY design semantics.
Original application containers, storage and cable/project rows are never used.

The `test-smoke.ps1` script exercises only this new CLI with an explicitly
synthetic fixture in a fresh ignored scratch directory. It does not rerun
unrelated Model/PF-1 suites or claim actual converted/native parity.
