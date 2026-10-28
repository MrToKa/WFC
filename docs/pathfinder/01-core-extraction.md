# PF-1 — Independent engine and offline boundary

PF-1 implements the detached calculation layer described by PF-0. It runs without a desktop host, database or container. It does not yet add the WFC PathFinder tab or calculate from the converted project model.

## Source and structure

The eleven production `AddinRibbon/Routing/*.cs` files from PathFinder commit `45c24bf5f433f13e102600b36f20327c77961d0a` are copied byte-for-byte into `pathfinder-engine/src/PathFinder.Core/Routing/`. Namespace, numerical code, thresholds, constructor guards, lookup semantics, graph ordering and decimal conversion remain unchanged. New assembly metadata is separate. [Source provenance](../../pathfinder-engine/source-provenance.json) records the source and frozen PF-0 hashes.

The original eight regression source files are also byte-identical. Their new project references `PathFinder.Core.dll`; it does not compile a second copy of the calculation source. An entry wrapper verifies assembly separation and absence of Autodesk references before invoking the original harness. Only `PathFinder.Regression` and `PathFinder.Parity` receive friend access for the existing internal test constructors/vectors. The production adapter is not a friend.

The new adapter accepts strict versioned inputs for calculation, ordered lookup, geometry fitting, geometry-plus-routing, parsing and name resolution. It retains fragment triangle meshes, measured ports and connection surfaces rather than reducing every tray to an approximate line. The [contract](contracts/pf1/README.md) defines explicit settings, units, budgets, modes and exit codes; its DTO is distinct from the deliberately permissive frozen fixture schema.

## Precision, settings and lifecycle

Coordinates are already canonical right-handed Z-up metres. The adapter does not apply model/display transforms. All numerical options, including vertical preference, are explicit. Instrumentation maps to Control. Unknown categories remain unresolved.

All three project allowances are explicit snapshots. Zero is valid; a null SECONDARY allowance produces `settings_required` only when the automatic result actually requires a replacement. Calculation delegates to the unchanged `CableDesignLength` implementation. Exact decimal tokens are accepted only if representable without rounding/underflow and are serialized as invariant strings. A future trusted WFC server must load/version the Project Details values itself; this offline boundary does not authenticate their provenance.

In-process execution uses cooperative cancellation through the existing core. The default stdio runner starts one worker process with bounded input/output and kills/awaits that process tree on its hard deadline. Direct internal `--worker` invocation has no coordinator watchdog. Limits are explicit safety ceilings, not a measured real-plant capacity or operating-system memory quota.

## Verification and remaining boundary

Fresh checks pass: 105 original regressions; 43 frozen golden cases within 215 parity/boundary assertions; 33 valid production DTO fixture replays; 14 real CLI scenarios. Repeated results are deterministic for tested inputs. Ordering/tie controls characterize the pinned implementation rather than impose a new permutation-independent tie breaker. Native/converted parity remains unproven.

Two independent review findings were repaired and covered: nonrepresentable decimal input could silently round to zero, and an unresolved route named `/LIMIT1` could be mislabeled as a resource limit. The adapter now compares exact integer decimal coefficients/scales and recognizes the pinned core's limit diagnostics explicitly.

Use the [engine README](../../pathfinder-engine/README.md) and `verify.mjs` for reproducible commands. Logs and receipts live in [PF-1 evidence](evidence/pf1/parity-results.json). Real geometry capture and reference comparison are PF-2 work. [Native oracle feasibility](evidence/pf1/native-oracle-feasibility.md) establishes available files/tools only; no native run or licence availability is claimed.
