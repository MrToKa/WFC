# PF-1 offline engine boundary

Implemented schema versions: `pathfinder.pf1.request.v1` and `pathfinder.pf1.response.v1`.
The contract is implemented by `EngineRequest` in `pathfinder-engine/src/PathFinder.Adapter/Contracts.cs`.
It is deliberately separate from the permissive frozen PF-0 fixture schema. In particular, production callers
cannot manufacture a `RouteResult` or invoke a design-only calculation with fabricated SECONDARY flags.

## Invocation and trust

The public .NET entry point is `PathFinder.Adapter.PathfinderAdapter.Execute(ReadOnlyMemory<byte>, CancellationToken)`.
Use `PathfinderAdapter.JsonOptions` for consistent JSON serialization. The adapter receives an explicit immutable
snapshot of all three Project Details allowances. It does not connect to WFC, a database or a Viewer and cannot
prove that a supplied snapshot came from an authorized project row. A future trusted WFC server adapter must
load and version those values itself; adding a client-controlled `source` string is not authorization.

`PathFinder.LocalRunner` consumes exactly one UTF-8 JSON document from standard input and writes one compact
JSON response followed by a newline. Its default coordinator starts one isolated worker process, forwards the
request and kills the worker process tree when its deadline or cancellation fires. The internal `--worker`
entry point is for coordinator IPC. Direct .NET invocation has cooperative cancellation, including calls into
the unchanged calculation, lookup, geometry and surface routines. The coordinator provides the hard process
deadline; neither API uses an abandoned background task as a timeout.

The runner reads stdin for at most 60 seconds. Once the complete envelope is available it gives the worker
the requested 1–60,000 ms, including worker startup. Cold startup can therefore exceed a very short deadline.
Reading/writing transport bytes and worker termination are not part of a promise of real-time scheduling.
The worker is killed and awaited before the coordinator returns a deadline result.

No server or HTTP endpoint is installed by PF-1. No authorization, real-model parity or production readiness
is inferred from a successful local calculation.

## Required envelope

All operations require these exact, case-sensitive properties:

- `schemaVersion`, `requestId`, `operation`, `timeoutMilliseconds`.
- `coordinateSystem: "right-handed-z-up-metres"`. Inputs are already canonical; this boundary does not apply transforms.
- `projectSettings`: `revision`, `secondaryTrayLength` (explicit decimal or `null`), `endConnectionLength`, `additionalBendingPercent`.
- `options`: `connectionToleranceMeters`, `sampleSpacingMeters`, `secondaryDistanceMeters`, `preferVerticalApproach`, `maxGraphNodes`, `maxGraphConnections`.

Decimal allowance inputs accept JSON numbers or invariant decimal strings, including exact scientific notation.
An input must be exactly representable by the core decimal type: excess precision and underflow are rejected,
rather than silently rounded (removable trailing zeroes are accepted). Decimal tokens are limited to 128 characters
and exponent magnitude 1,000 before bounded integer comparison. Response decimal values are invariant
strings, including `lengthBeforePercentageMeters`, `unroundedLengthMeters` and `designLengthMeters`, so a JavaScript
consumer does not silently round them to binary floating point. Engineering geometry remains full-precision
double JSON numbers. Core arithmetic and its double-to-decimal cast are unchanged.

Missing/unknown members, duplicate object members, wrong casing, unexpected operation-specific payloads,
non-finite or out-of-range numbers, invalid mesh indices, duplicate stable IDs and unknown versions fail explicitly.
No default allowance, vertical preference or numerical routing option is supplied by the adapter.

## Operations

| Operation | Additional input | Output |
|---|---|---|
| `calculate` | `segments`, `category`, `from`, `to` | Exact core route, path points, metrics and design breakdown |
| `lookup` | `segments`, `routeText` | Ordered lookup route and metrics; no invented equipment tails or full cable design |
| `geometry` | `geometry` | Core-fitted segment geometry, ports, fallback counts and diagnostics |
| `geometry-route` | `geometry`, `category`, `from`, `to` | Core geometry build followed by automatic route and design |
| `parse` | `routeText` | Parsed/coalesced ordered route codes |
| `name` | `names` in leaf-to-selected-root order | Resolved name and explicit owner index |

`reverse: true` is optional for calculate, lookup and geometry-route and delegates to the unchanged core reversal.
`MV`, `LV` and `Control` map directly; cable `Instrumentation` maps to `Control` under `wfc-mto-v1`.
Missing or unknown automatic cable categories return `category_required`. Tray category arrays permit an empty
set (ineligible tray), disallow duplicates after mapping, and reject unknown categories.

A segment requires `id`, `name`, `allowedCategories`, `points` and `connectionsAtEndsOnly`. Optional `verifiedPorts`
contain point/outward/u/v vectors and measured width/height. Optional `connectionSurfaces` contain a detached
triangle `mesh`, `verifiedPorts` and `endsOnly`; the public core surface constructor must validate it. This retains
physical surface clearance and measured-port behavior rather than silently reducing all input to polylines.

A geometry input requires `id`, `routeName`, `categories`, `shapeName`, `minimum`, `maximum`. Optional `faceExtents`
contain a canonical face name (`MinX`, `MaxX`, `MinY`, `MaxY`, `MinZ`, `MaxZ`), minimum/maximum and sampleCount.
An optional mesh contains `fragments`, each with finite `vertices` and local `triangleIndices`. Native fragment
boundaries are preserved. A geometry response includes measured/fallback diagnostics; it does not assert
that supplied synthetic or converted geometry equals the native capture.

SECONDARY settings are required only when the successful automatic route flags a SECONDARY approach. With
an explicit null SECONDARY allowance, that result retains geometric diagnostics and returns `settings_required`
without a design value. Explicit zero is valid. Automatic routes without SECONDARY do not use the nullable
allowance. Reserve is applied once before percentage using `CableDesignLength.Calculate`.

## Budgets and status

| Budget | Limit |
|---|---:|
| Request / response UTF-8 | 8 MiB / 32 MiB |
| JSON depth | 48 |
| Worker timeout | 1–60,000 ms |
| Segments / geometry inputs | 4,096 / 2,048 |
| Points per input segment | 2–8,192 |
| Total validated points / triangles | 262,144 / 200,000 |
| Fragments per mesh | 1–512 |
| Graph nodes / connections | 500,000 / 2,000,000 maximum; caller may lower |
| Absolute canonical coordinate | 1,000,000,000 m |
| Connection tolerance / sample spacing | 1e-9–1,000 m |
| SECONDARY threshold | 0–1,000,000 m |
| Each length allowance | 0–1,000,000 m |
| Additional percentage | 0–10,000% |
| Route text / name chain | 32,768 characters / 256 names |

Additional limits: IDs 256 characters (request ID 128), names 1,024; six unique box faces;
two verified ports and up to two connection surfaces per segment. Control characters are forbidden in identifiers
and names; route text permits tab/CR/LF whitespace because ordered lookup accepts it. The bounded JSON size,
graph ceilings, triangle/point counters, cancellation and worker lifetime jointly bound resource use. This is
not a host memory quota or a capacity claim for a real plant model.

| Status | CLI exit | Meaning |
|---|---:|---|
| `calculated`, `geometry_ready`, `parsed`, `resolved` | 0 | Operation completed; mode semantics still apply |
| `no_path`, `settings_required`, `category_required` | 3 | Controlled unresolved engineering input/result |
| `invalid_request` | 2 | Strict contract validation failed |
| `resource_limit` | 5 | Byte, geometry, or core graph budget exceeded |
| `cancelled`, `deadline_exceeded` | 4 | No completed calculation proposal |
| `failed` | 1 | Local process/transport failure |

The response includes engine/adapter/category-mapping versions and echoes the settings snapshot for successful
processing. Failure messages are diagnostics, not stable machine enums; consumers branch on `status`.
