# Private computational model worker

`dotnet PathFinder.ModelRunner.dll` accepts exactly one bounded UTF-8 stdin JSON
request, supervises a separate hidden worker and emits one JSON result. It has
no HTTP listener, Autodesk dependency, database access or browser API.
`PF_ROOT` must be an explicitly configured owned absolute directory. Input
snapshots are immutable `PF_ROOT/snapshots/<snapshotId>.json`; fitted caches are
reproducible files below `PF_ROOT/cache`. IDs are canonical UUIDs; hashes and
project/model identity are rechecked before fitting. Callers cannot pass paths.

Requests use `pathfinder.model.runner.v1`: requestId, operation, projectId,
modelVersionId, snapshotId, snapshotSha256 and timeoutMilliseconds (1–120000).
Operations are `prepare`, `calculate`, `design`, `lookup`. Calculate additionally needs
from/to `{x,y,z}` canonical points, category, explicit PF-1 options and Project
Details settings. Instrumentation maps to Control. Unassigned routing categories
require resolution. Project settings use exact decimal strings; missing
SECONDARY remains null. Duplicate/unknown members and nonfinite numbers fail.

Lookup accepts `routeText` (at most 8000 characters and 100 parsed codes) and
explicit options. It invokes the unchanged native ordered lookup: SECONDARY is
ignored, adjacent repeated names coalesce, nonadjacent repeats and continuity
rules remain intact. It neither invents equipment approaches nor calculates
full cable design allowances. Its effective category and design are null.
`reverse:true` on calculate/lookup invokes the original `RouteResult.Reverse`;
it reverses exact points/segments and swaps endpoint metrics consistently.
The server must preserve cable endpoint identity when exposing reverse results;
a diagnostic preview does not authorize applying an inconsistent cable route.

Design uses only server-retained successful route metrics (`success`,
lengthMeters/fromDistanceMeters/toDistanceMeters/fromRequiresSecondary/
toRequiresSecondary) and current authoritative settings. `SavedRouteDesign`
is a narrow new Core support API invoking the original `CableDesignLength`
implementation and conversion/guards. It does not modify any of the eleven
pinned routing source files or make their constructors public. There is no
second JavaScript implementation of the formula.

Responses use `pathfinder.model.response.v1`. Controlled failures are JSON
statuses even when process exit is zero; WFC must inspect `status`. Output is
bounded to 32MiB; request transport to 1MiB; snapshot to 256MiB. The supervisor
kills and awaits its owned process on timeout. The WFC job owner must also kill
its child on explicit cancellation or lost lease. Diagnostic lists have explicit
total/truncated fields; geometry/path outputs are never silently truncated.
Decimal output uses canonical invariant fixed strings with up to 28 fractional
digits, without exponent notation, rounding or a change to arithmetic.

Every response has `engineeringAccepted:false`: this worker does not authorize
Apply or turn metadata booleans into native parity. WFC owns current admin,
project/model selection, proof, input/dependency revisions and Apply transaction
checks. The current fitted cache does not cache the final endpoint-dependent
route graph. Real converted/native acceptance remains BLOCKED separately.

Build with the private .NET home configured, then run
`node pathfinder-engine/tools/PathFinder.ModelRunner/test-smoke.mjs` from the
worktree. It records fresh synthetic/boundary controls and replays all ten frozen
design inputs against their unchanged expected values. It never regenerates
expected files or touches original checkouts/data.

# Private runner sessions

The default one-shot supervisor and `--worker` modes retain their original JSON
contract. `--session-supervisor` starts one private long-lived supervisor and one
computational child (`--session-worker`). No HTTP listener or credentials are
introduced. WFC still owns authorization, file provenance and publication fences.

Session frames are an unsigned four-byte big-endian byte length followed by strict
UTF-8 JSON, without a newline. A closed `pathfinder.engine.session.v1` ready frame
announces the runner SHA-256, pinned engine version and byte limits. Subsequent
request frames contain the unchanged runner DTO. A result frame wraps the unchanged
model response in `{schemaVersion,type:'result',response,session}`. Session metadata
contains only `requestOrdinal`, `preparedReuse` (`none`, `build`, `disk`, `memory`),
and `retireAfterResponse`. Memory reuse proves reference identity; the original
`prepared.loadedFromDisk` continues to describe how that object was constructed.

One request is active, with no application queue. Pipelined input, partial/invalid
frames, malformed JSON, unexpected fields, duplicate fields, bad identities and
unexpected process failure terminate the lane. Every geometry request still reads
the immutable snapshot, checks SHA and project/model identity, validates purpose,
and resolves dedicated lookup scope. Only one exact normalized input/rules identity
is retained. Changing it replaces the cache instance without changing ModelLimits
or disk key serialization. Graphs remain per calculation. Core and Model are
unchanged. Settings, options and category are always supplied per request.

Initial policies are 64 requests, 30 seconds idle, 10 minutes lifetime and five
seconds for ready. A client must recycle before dispatch if remaining lifetime
cannot cover the original request deadline. The independent .NET supervisor
enforces the request deadline even when synchronous computation cannot cooperate;
Node additionally owns the process-group hard deadline and kill/join. A deadline,
resource failure or executor exception retires the child and lane. No request is
silently replayed. Domain results such as `no_path` remain ordinary results.

Request payloads are capped at 1 MiB, whole response frames at 32 MiB, and child
stderr at 64 KiB for its lifetime. The supervisor samples combined supervisor/child
RSS every 100 ms and refuses above 512 MiB (or when the guard is unavailable).
This is a sampled soft guard and can miss short peaks; the isolated container's
existing 4 GiB limit is the separate hard OS bound. Thresholds are provisional,
not evidence of whole-plant capacity. Stdout contains protocol only.
