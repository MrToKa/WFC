# Additive PF-2 capacity baseline

This CLI measures copied, explicitly scoped computational snapshots through the
existing Model library and unchanged Core. It does not change the web runtime,
production runner, algorithms, resource limits, fixtures or engineering acceptance.

Build/publish with a new `--artifacts-path` outside the source tree's usual build
folders. It references Model and Adapter (and their single Core assembly) by
ProjectReference; no calculation source is compiled a second time.

```text
dotnet PathFinder.CapacityBench.dll --manifest /input/manifest.json --work-root /work/bench
dotnet PathFinder.CapacityBench.dll --self-test --work-root /work/self-test
```

The work root must be absent, absolute and free of symlinks/reparse ancestors.
The CLI never removes or overwrites files. It retains generated synthetic snapshots,
cache artifacts and `result.json` under this owned root. Standard output contains
exactly one JSON result. The caller owns outer process/container limits and cleanup.

The strict `pathfinder.capacity.input.v1` manifest is:

```json
{
  "schemaVersion": "pathfinder.capacity.input.v1",
  "label": "Copied selected-network diagnostic baseline",
  "snapshot": {
    "path": "/input/snapshots/copied.json",
    "sha256": "<raw snapshot SHA256>",
    "projectId": "<UUID>",
    "modelVersionId": "<UUID>",
    "contentSha256": "<model content fingerprint>"
  },
  "request": {
    "category": "Control",
    "from": [0, 0, 0],
    "to": [1, 0, 0],
    "options": {
      "connectionToleranceMeters": 1,
      "sampleSpacingMeters": 0.125,
      "secondaryDistanceMeters": 2,
      "preferVerticalApproach": true,
      "maxGraphNodes": 200000,
      "maxGraphConnections": 1000000
    },
    "projectSettings": {
      "revision": "1",
      "secondaryTrayLength": "5",
      "endConnectionLength": "6",
      "additionalBendingPercent": "10"
    },
    "connectionGap": "1"
  },
  "repeatQueries": 8,
  "caseTimeoutMilliseconds": 30000,
  "totalTimeoutMilliseconds": 180000,
  "syntheticSizes": [8, 64, 256, 1024]
}
```

The copied snapshot path must be contained below the manifest's input directory.
SHA is checked before parsing; project/model/content identities must match.
Duplicate/unknown JSON members, invalid finite values and missing or exactly
unrepresentable decimal tokens are rejected. Project allowance tokens are strings, with null allowed
only for SECONDARY. The existing Adapter exact decimal reader is reused.
The tool cannot detect whether an upstream user already rounded a valid decimal string.

Repeat count is 1–64; each measured phase is 100–60000ms; total is at least the
phase timeout and at most 300000ms. Sizes form a nonempty distinct subset of
8/64/256/1024. The accepted full baseline uses all four with the displayed 30s/180s
defaults. The self-test uses 8 and 64 only and makes no real-model claim.

`pathfinder.capacity.result.v1` reports per-dataset `input` descriptors with
`label/kind/snapshot/request/expected`, suitable for the separately measured
production ModelRunner. Synthetic chains have N straight 2m segments, known total
2*N, all N used segments, zero approaches/SECONDARY/gaps and independently expected
design `ceil((2*N + frozen end connection) * (1 + frozen percent/100))`. They are
labelled mathematical synthetic data, never full-plant/native evidence.
Chains with more than 100 route codes exercise the Core only; they do not establish
compatibility with the existing WFC Viewer/Apply route-size limits.

Each dataset has `prepared` diagnostics and `phases`: `cold-fit`, `cold-query`,
`warm-disk-fit`, `warm-disk-query`, `memory-fit-hit` and repeated `memory-query`.
Each phase contains its actual status, wall/CPU time, process-wide allocated-byte
delta, current working set, lifetime peak working set and private memory. Cold
means an absent fitted cache only: input prevalidation/parsing has already run,
and JIT/OS caches are shared across datasets. Query timings include Calculate,
design calculation, independent expectations and canonical semantic serialization.
They are not isolated graph-search or fresh-process timings.
Repetitions use identical endpoints/category/options for a dataset. They do not
prove query-order, changed-endpoint or changed-category independence for a future
persistent worker. Phase/total deadlines are cooperative; the orchestrator supplies
the separate hard process/container deadline.

The full cold-query semantic object retains every route point/field, effective
category and three canonical decimal design strings. Recursive ordinal key order
is used for internal phase hashes. Warm/repeated phases compare those exact full
semantics and omit duplicate full objects to keep the receipt below 2MiB. The
separate orchestration validator canonicalizes the complete direct/production
objects in Node; .NET/JS exponent spelling alone is not a numeric difference.

Controls exercise pre-cancellation, deterministic cancellation while Core enumerates
the second eligible segment, and an explicitly lowered two-node graph budget.
Cancellation scope does not claim deepest-search latency. Real deadline/limit/
geometry failures retain failing statuses. No cancelled fit can yield a passing
dataset. Incomplete work is never labelled whole-plant capacity or reusable graph.

Exit 0 means the recorded scope passed. Exit 1 means execution/self-test failed.
Invalid inputs yield a bounded `status: "FAIL"`, `error.code: "INVALID_INPUT"`
JSON and exit 2, normally before any work root is created. Input paths/identities
are checked before creating output. No credentials, original application data,
Navisworks invocation, cloud calls or production Apply are involved.
