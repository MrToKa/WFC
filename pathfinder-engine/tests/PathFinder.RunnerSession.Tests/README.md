# Runner session qualification

This additive console test project references the real ModelRunner assembly and
its Model/Adapter/Core ProjectReferences. It compiles no second copy of Core.
Publish with an explicitly owned `--artifacts-path` and output directory, then run:

```
dotnet PathFinder.RunnerSession.Tests.dll --runner <absolute ModelRunner.dll> --work-root <new absolute directory>
```

The output root retains `result.json`, a single synthetic corpus manifest and its
snapshots/cache. It never uses the original application or database. Failed
attempts remain inspectable. No expected fixture is regenerated.

`--emit-corpus <new absolute directory>` emits the same standalone corpus for
independent Node/Linux orchestration. Set PF_ROOT to the manifest's parent.
`manifest.json` has schema `pathfinder.runner.session.corpus.v1`, an honest scope,
and `cases` containing `label`, the unchanged runner `request`, nullable
`expectedStatus`, and nullable `expectedLengthMeters`. Requests retain their
snapshot UUIDs and actual byte hashes. No private paths or credentials are embedded.

The 31 cases cover endpoint A/B/A, reverse, four application categories,
small/large/small gap, SECONDARY approach, exact decimal Details, changed options,
lookup/design interleaving, rules reset, changed snapshot/category/model, parallel
ties and distinct attachments, explicit Core graph budget, dedicated lookup purpose
and recovery. Full comparison includes every response property except requestId
and `prepared.loadedFromDisk` (a construction diagnostic); route/design values,
point and code order, readiness/counts/diagnostics/fitted key remain exact.
Known simple mathematical lengths are checked independently within1e-12 metres;
the cross-mode complete semantic comparison has no numerical tolerance.

Protocol checks include BE32, EOF/partial/unsigned oversize/UTF8/duplicate/closed
ready, actual process malformed-input refusal, current immutable file hash after
memory reuse, project ownership, an independently supervised one-millisecond
deadline, pipelining refusal without a false result, and fresh-lane recovery.
Actual partial-prefix and partial-payload pipelining keep the parent input open:
the supervisor must join without waiting for the remainder and emit no A result.
An immediate legitimate B after receiving A must still succeed with memory reuse.
Three actual64-request sessions must retire cleanly. Private reference-hit
telemetry must prove memory reuse. These are host synthetic controls; they do not
prove whole-plant capacity, native parity, engineering acceptance, ten-minute age,
Linux memory enforcement or database publication fences. Those have separate
orchestration/isolated-target qualification scopes.
