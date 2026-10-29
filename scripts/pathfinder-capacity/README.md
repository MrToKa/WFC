# Bounded PathFinder capacity measurements

These additive tools measure the copied 52-object network and explicitly synthetic
8/64/256/1024-segment chains. They do not change production code, graph limits,
the local demonstration database, or running application containers.

The existing API image supplies the actual one-shot ModelRunner. A separately
published `PathFinder.CapacityBench` uses the unchanged Model/Core libraries to
measure empty fitted-cache preparation, a fresh disk-cache instance and repeated
queries on one PreparedModel. The original core still builds its endpoint graph
for every query. PreparedModel reuse is a benchmark scenario, not a deployed
worker change.

Run the Node guards first:

```powershell
node --test scripts/pathfinder-capacity/capacity.test.mjs
```

The C# malformed-input controls are a separate parent-owned tool:

```powershell
node scripts/pathfinder-capacity/bench-input-controls.mjs --dll <absolute-published-DLL> --manifest <absolute-copied-manifest> --work-root <fresh-absolute-owned-scratch>
```

After the input extraction and C# publish have frozen, run from the isolated
worktree with their exact paths:

```powershell
node scripts/pathfinder-capacity/run.mjs --manifest <absolute-copied-input/manifest.json> --reference <absolute-reference.private.json> --bench <absolute-published-directory>
```

The orchestrator validates the original manifest, reference dependencies, snapshot
hash and source image ownership before creating an exclusive
`pathfinder-engine/.scratch/capacity-run-<UUID>` directory. It copies only that
snapshot, the comparison result and these sampling tools. The new container gets
four exact mounts: input, published bench and tools read-only; its own work folder
writable. It has no network, no published ports, a read-only root filesystem,
4 GiB memory, 256 PIDs and two CPUs. The source API's live 4 GiB/256-PID limits are
checked before this run. No existing volume is mounted. No image is built or
pulled.

The shared v1 manifest permits phase deadlines 100–60000 ms and a total C# bench
deadline between that phase deadline and 300000 ms. The actual baseline uses
30000/180000 ms, eight memory queries and all four synthetic sizes. A separate
600000 ms container sampler deadline includes its loops; each child has a hard
deadline and owned process-group cleanup. A host-side 660000 ms deadline and
SIGINT/SIGTERM handling retire only the exact labelled test container. It creates
no volumes or networks. Its final receipt records targeted container retirement;
the immutable input, raw responses and metrics remain for review.

Every successful output is parsed fully with duplicate-key, UTF-8, finite-number,
schema and required-result checks. Raw stdout hashes are retained. Full route and
design objects are hashed with recursively sorted keys; no point or length is
rounded. Real direct and production results must match the separately copied
existing forward result. Each synthetic production result must match its direct
benchmark result, whose C# checks use independent exact chain mathematics.

The Linux sampler reads `/proc` nominally every 20 ms. Tree RSS is an estimate from
sequential, non-atomic reads and may miss short peaks; it does not prove an exact
coincident peak or a strict lower bound. Supervisor and descendant maxima are
reported separately and must not be added. C# current/lifetime working-set values
belong to the complete benchmark process, not isolated per-phase peaks. An
optional cgroup peak belongs to the entire test container. Query wall time
includes the harness's sampling overhead; throughput includes one-shot process
startup and supervision. The raw C# receipt documents its separate JIT, OS-cache
and semantic-hashing overhead.

Complete C# exit-1 failure JSON is retained and remains a benchmark failure;
timeouts, graph limits and mathematical failures keep their actual phase labels.
Unexpected process/output/cleanup or semantic failures are hard failures.
Explicit production time/resource interruptions can produce a partial result.
Nothing is labelled a successful query without complete validated output and
full-result equality. A successful baseline establishes this selected network
and these chain sizes only; whole-plant capacity, lookup timing and native parity
remain unproved.

The output location printed by `run.mjs` contains `orchestration.json` and
`work/result.json`; the latter references `work/bench.stdout.json`, full retained
production request/response files and observed process controls. Do not delete
denied scratch directories or run a global Docker prune. This tool removes only
its own verified test container and retains the measurement files.
