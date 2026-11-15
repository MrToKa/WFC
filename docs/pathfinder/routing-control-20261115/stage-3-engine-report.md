# Stage 3 native engine report — 2026-11-15

## Scope and baseline

Implemented native endpoint-aware ordered manual cable routing and its protected ModelRunner transport. Repository `work/endpoint-stall10`, branch `fix/barrier-frame-recovery-20261112`, HEAD `cf7c64d3845aa42276c10743b62a146b5f3ce77d`, with substantial pre-existing and concurrent uncommitted server/UI/barrier work preserved. The checked implementation is the local working tree, not HEAD alone. Remote PR/CI state was not retrieved for this local-only subtask and establishes no acceptance.

Stage 2 persisted controls and `pf_manual_route_jobs` enqueue seam are implemented in the concurrently edited working tree. Its report became available during final preparation and reports 396 unique stage 2/regression checks passing, including isolated PostgreSQL; those tests were not rerun by this native subtask. Native verification does not establish deployed integration or user/browser acceptance. No TS changes were made by this native subtask.

## Implemented interface

Protected request `schemaVersion: pathfinder.model.runner.v2`, `operation: calculate` accepts:

```json
{"manualRouteConstraint":{"schemaVersion":"pathfinder.manual-ordered-route.v1","routeText":"/A/B/C"}}
```

The request retains existing project/model/snapshot hashes, category, actual From/To world-metre points, numeric routing options, Project Details settings, authenticated barrier context, purpose permissions and capacity exclusions. `reverse: true`, another constraint version or an unprotected request is refused. Normal direct-SECONDARY shortcut is suppressed when this constraint exists, even if directSecondaryPolicy was supplied. The raw saved manual text must remain untouched in DB; native parsing/route output is normalized independently.

Native entry point is `RouteCalculator.CalculateManualOrdered(...)` in `Support/ManualOrderedRoute.cs`, returning `LocalApproachRouteEvaluation`. A separate parser accepts up to 16,384 characters and 100 physical route tokens. Terminal SECONDARY is endpoint-approach notation; measured approach distance and the normal threshold decide reserve flags. Interior/only SECONDARY and adjacent repeated labels are explicit refusals. Nonadjacent `/A/B/A` is supported, and the intermediate B occurrence must contribute actual physical body distance, not a zero-length label transition.

The first/last equipment candidates are on the first/last specified physical tray. Product-state graph search preserves every ordered occurrence, excludes unlisted trays, and retains original graph edges, gap accounting, category/purpose/capacity restrictions, checked local endpoint approaches and exact final segment collision checks. Original surface/solid kernels are reused. Inter-tray opening repair uses the same bounded checked maneuver domain when the authenticated mixed runtime profile enables it. Every lazy repair iteration invokes ordered path selection; it cannot fall back to unconstrained free routing. The pinned default automatic selection remains the null-selector branch; the original private OpeningFallback signature remains for existing regression fixtures.

Output remains `pathfinder.model.response.v3` with ordinary `route`, `design`, optional requested `lengthLedger`, and barrier execution/proof. Full design length comes from the existing `LengthLedgerObserver.Calculate` and includes actual equipment approaches, actual used tray/gap/maneuver geometry, the ordinary reserve replacement, end allowance, bending and ceiling. Lookup length is not used.

The manual lane intentionally emits `barriers.directSecondary: null`. Current TS `requireBarrierEngineStrategy` requires a direct-secondary decision for all LV/Control automatic results; integration needs an explicit frozen manual strategy branch that preserves all barrier/endpoint/proof checks and validates exact ordered physical output. Its default automatic branch must remain strict. `requireCalculationLengthLedger` already supports the ordinary v1 components without a direct decision.

## Diagnostics and limits

- Success: `MANUAL_ORDERED_ROUTE_CLEAR` or `MANUAL_ORDERED_LOCAL_ROUTE_CLEAR`; existing `_INTER_TRAY_OPENING_MANEUVER_V1` and improvement-limit suffixes remain meaningful.
- Missing/renamed/ineligible mandatory tray: `MANUAL_ROUTE_REQUIRED_TRAY_UNAVAILABLE`; the offending code appears in the result message. Native failure has no successful route/design.
- Unsupported syntax: explicit `MANUAL_ROUTE_*` parser diagnostic in `invalid_request`; retain the entered text and surface the diagnostic.
- Bounded candidate exhaustion: `MANUAL_ROUTE_CANDIDATE_DOMAIN_EXHAUSTED`, `searchComplete: false`. This does not prove physical impossibility outside the finite domain.
- Explicit drilling or explicit-empty barrier publication reuses the existing bypass plumbing while still enforcing ordered physical trays; proof/status continues to distinguish actual drilling from no barriers declared.
- Existing work/query/input/graph/pair/local-plan/deadline limits and cancellation apply. Product states additionally stop at `MANUAL_ROUTE_STATE_LIMIT`, mapped to `resource_limit`.
- Physical cable radius, complete global model coverage and engineering acceptance are not established by these native synthetic checks; existing authority flags remain unchanged.

## Changed native sources

- New `pathfinder-engine/src/PathFinder.Core/Support/ManualOrderedRoute.cs`.
- `Support/ConstrainedRoute.cs`: optional ordered path selection and constrained opening callback.
- `Support/InterTrayOpeningManeuvers.cs`: optional selector implementation behind the unchanged default wrapper.
- `pathfinder-engine/tools/PathFinder.ModelRunner/Program.cs`: strict optional DTO/validation.
- `BarrierRoutingExecution.cs` and `MixedBarrierRoutingExecution.cs`: manual dispatch ahead of direct-SECONDARY shortcut, reusing ordinary proof and length output.
- New native projects `PathFinder.ManualOrdered.Tests` and `PathFinder.ManualOrderedTransport.Tests`.

The new source must be covered by the actual calculation implementation/build/closure inventory. C# source is compiled into Core; do not invent a new module or put this calculation-only logic in geometry-trace derivation. Existing `calculationEngineIdentity.ts` hashes Core/Runner binaries and its fixed TS projection; any new TS manual worker/dependency projection also needs to enter the appropriate calculation closure within published bounds.

## Verification

All results below are PASS on the local working tree. Logs are in `D:/WFC-Test/validation/routing-control-20261115/`.

| Suite | Passed | Evidence |
|---|---:|---|
| New manual ordered Core | 24 | `manual-native-tests.log` |
| New protected manual one-shot/session transport | 12 | `manual-native-transport.log` |
| Existing constrained routing | 72 | `native-constrained-regression.log` |
| Existing local connectors | 51 | `native-local-regression.log` |
| Existing inter-tray maneuver/graph regressions | 33 | `native-intertray-regression.log` |
| Existing length-ledger direct and one-shot/session transport | 35 | `native-length-regression.log` |

The new tests execute partial one-tray endpoints, automatic formula/ledger equality, forced A/B/C over an unlisted shortcut, A/B/A physical traversal, missing/category/capacity restrictions, disconnected geometry, actual registered mesh blockage, endpoint occupancy, indeterminate query, explicit bypass, terminal SECONDARY reserve formula, used versus unused BC182 extension, resource/cancellation refusal, real local approach detour, ordered inter-tray opening repair, exact final original-geometry segment checks, strict protected DTO and warm session automatic/manual isolation. The transport fixture computes 7 m real geometry + 5 m end allowance, 10% bending, ceiling = 14 m. Inter-tray transport uses authenticated profile v3 with actual original opening material.

Commands: `dotnet run --project pathfinder-engine/tests/<suite>/<suite>.csproj`; the two transport-enabled suites additionally require `-- --runner <absolute Debug/net9.0/PathFinder.ModelRunner.dll> --work-root <new absolute test directory>`. New successful transport evidence is under `manual-transport-run-04`; length transport under `length-native-run-20261115`. `git diff --check -- pathfinder-engine` passed. Compiling/running these projects built current ModelRunner/Core/Adapter/Barriers/Verifier without errors.

Earlier harness runs that failed had incorrect fixture API/schema/expected formula assertions; these were corrected against actual contracts and rerun. The final referenced logs contain current successful results, not carried-forward status. TS worker persistence, causal invalidation/currentness, deployed runtime and in-app browser behavior remain NOT_RUN by this native subtask and are the next integration gate.

## BC182 mathematical supplement — 2026-11-15

The earlier BC182 test proved a raw geometry change and unchanged partial use, but did not expose its full before/after formula. It is now replaced by three native cases, with no runtime changes. The focused native project passes **26/26** checks. Exact complete before/after ledgers are emitted in `geometryEvidence` in `D:/WFC-Test/validation/routing-control-20261115/manual-native-bc182-geometry.log`.

Each case invokes the real Core `CalculateManualOrdered` and existing `LengthLedgerObserver.Calculate`, with the existing two-metre SECONDARY threshold and Project Details S=7 m, E=6 m, bending=10%. These are synthetic explicit world-metre tray geometries with a checked-clear oracle; they establish mathematics, not real-model SDK capture, persistence, engineering acceptance or another SQL invalidation test. The caller's manual input sequence stays unchanged; generated endpoint SECONDARY notation follows actual measured approach flags.

| Scenario | Raw geometry before → after | Approaches before → after | Replaced approaches / reserve total | Base before percentage | Unrounded | Native Design |
|---|---|---|---|---|---|---|
| Used mandatory `/A/BC182/C`, BC182 5 → 7 m | 16 → 18 | From 3 → 3, To 4 → 4 | Remove 3+4 and add 14 in both | 29 → 31 | 31.9 → 34.1 | **32 → 35 m** |
| Literal straight BC182 extension 5 → 7 m | 8.23606797749979 → 9 | From 1 → 1, To √5 → 1 | To changes from SECONDARY to ordinary; reserve 7 → 0 | 19 → 15 | 20.9 → 16.5 | **21 → 17 m** |
| Extension outside used two-metre partial span | 9 → 9 | From 3 → 3, To 4 → 4 | Remove 3+4 and add 14 in both | 22 → 22 | 24.2 → 24.2 | **25 → 25 m** |

For the mandatory case, A and C are unchanged two-metre trays. BC182 alone changes from `(0,0)→(5,0)` to `(0,0)→(0,1)→(5,1)→(5,0)`: its complete used geometry grows from 5 to 7 m while both connection ports, equipment points, other trays, options and settings remain fixed. The test asserts both added waypoints, actual final-polyline length, exact ordered physical sequence, final checks and every ledger component. The added two physical metres become three Design metres because the native bending and ceiling are applied to the complete result; no nominal delta is appended to a previous Design length.

The literal straight extension additionally demonstrates why the direction of the final change cannot be inferred from nominal tray growth: the To approach becomes short enough to stop replacing it with the fixed seven-metre SECONDARY reserve under the existing formula. This is observed from actual native approach measurements and flags, not an added special rule.

For unused extension, BC182 changes from x=0…5 to x=0…7, while the cable still uses x=1…3. The tests assert identical complete path points and byte-identical serialized full native ledgers, not just equal rounded totals. Formula remains `ceil((9−3−4+14+6)×1.10)=25` in both.

Command: `dotnet run --project pathfinder-engine/tests/PathFinder.ManualOrdered.Tests/PathFinder.ManualOrdered.Tests.csproj` (PASS). Only that native test `Program.cs` and this supplement were edited for this follow-up. Existing native engine, server/worker, SQL and application files were not modified.
