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
