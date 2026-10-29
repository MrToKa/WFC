# Length-component observations

This executable checks the Adapter observer against the existing public Core and
SavedRouteDesign results, then exercises the actual ModelRunner one-shot and
framed-session transports. Its corpus is the existing synthetic test fixture;
no production source is compiled a second time, and no frozen PF-0 receipt or
expected data is regenerated. It does not establish native parity or engineering
acceptance.

Build this project with an owned artifact directory, for example:

```powershell
dotnet build pathfinder-engine/tests/PathFinder.LengthLedger.Tests/PathFinder.LengthLedger.Tests.csproj --artifacts-path <owned-absolute-build-directory>
dotnet <absolute-PathFinder.LengthLedger.Tests.dll> --runner <absolute-PathFinder.ModelRunner.dll> --work-root <new-absolute-owned-scratch-directory>
```

The work directory must not already exist. Generated synthetic snapshots/cache
remain there for root inspection and ownership-bounded cleanup. The executable
prints a bounded JSON check report and returns nonzero on failure.

The `includeLengthLedger` request boolean defaults to false. Absent/false retains
the old response shape; true is accepted only for calculate/design. Successful
opted-in responses contain top-level `lengthLedger` with schema
`wfc.pf.length-components.v1`, formula `pathfinder-45c24bf5`, and the frozen shared
field names. All decimal components are canonical fixed strings. Raw L/F/T remain
binary64 values. The ledger is at most 8192 UTF-8 bytes and does not contain path
arrays or a self-hash. Failed results have no ledger.

The Adapter's `LengthLedgerObserver.Calculate` calls CableDesignLength.Calculate
once. `CalculateRetained` calls SavedRouteDesign.Calculate once. It checks only
the observed pre-percentage decomposition; percentage and ceiling totals come
from the Core result. Unused approaches are not cast to decimal. Gap metrics stay
on the sealed route and are already included in raw geometry; retained design
does not receive invented gap values. Historical opaque settings revision text
is unchanged without the flag; opted-in ledgers require the current canonical
nonnegative Int64 Details revision.
