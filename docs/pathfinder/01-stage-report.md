# PF-1 — Stage report

## Delivery and authority

Technical status: **PASS**. User acceptance of the final integrated feature remains pending. The user explicitly authorized automatic stage execution and recommended routine choices. No publication, merge or update of the original application is authorized.

Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`; branch `pf-1-independent-engine-20261017`; parent commit `23741d1f485248ddb519f9e04e0b7856cc0e3def`. The delivery commit is the local commit containing this report. Canonical algorithm reference remains `45c24bf5f433f13e102600b36f20327c77961d0a`.

Implemented deliveries are confined to `pathfinder-engine/` and `docs/pathfinder/`: separate Core/Adapter/LocalRunner projects, original regression harness referencing the DLL, frozen replay/boundary harness, source provenance, commands, contracts/examples and fresh reports. No WFC product UI, server route, database migration, container installation or real-model calculation is included in PF-1.

## Executed checks

| Check | Result and scope |
|---|---|
| Original detached regression | PASS: fresh 105/105; optional private Excel fixture NOT_RUN |
| Golden replay and boundary harness | PASS: 43 frozen cases, 215/215 checks; 33 strict DTO fixture replays and 14 CLI scenarios |
| Precision and negative controls | PASS: exact decimal strings, underflow/excess-precision rejection, category/settings/null distinctions, malformed/deep/duplicate/bounded input, geometry indices and counts |
| Lifecycle | PASS: cooperative cancellation/deadline plus actual CLI hard-deadline and controlled exit-code scenarios |
| Source integrity | PASS: eleven core and eight original regression source files match pinned bytes; production adapter has no synthetic result factory |
| Host independence | PASS: separate DLL assembly audit, no Autodesk/Navisworks references or external packages |
| Integrated verification entry point | PASS: `node pathfinder-engine/verify.mjs` builds runner, runs original regression and full parity harness in sequence; final retained integration receipts identify the run |
| Original environment preservation | PASS: three original checkout heads/branches/statuses and old dirty-file hashes unchanged; thirteen original container identities/images/start states unchanged |
| Native/converted model, web UI/auth/jobs/Apply | NOT_RUN: later stages |

Evidence: [core](evidence/pf1/core-verification.json), [parity](evidence/pf1/parity-results.json), [source/environment preservation](evidence/pf1/source-preservation.json), [remote observations](evidence/pf1/remote-observations.json). The final parent run repeats both harnesses only to verify the new combined verification entry point; it does not expand the claimed scope.

Independent review found and resolved exact-decimal underflow/rounding and false resource-limit classification for a missing `/LIMIT1` route. Fresh boundary checks cover both. Historical intermediate test counts are retained as separate observations and are not promoted to final acceptance.

Live GitHub observations at 20:40 UTC on 17 October confirm unchanged WFC main `e1ef202…` and PathFinder master `45c24bf…`. The unrelated WFC PR #1 remains open with COMMENTED reviews; PathFinder has no open PRs. Both default heads have zero statuses/checks/Actions runs; `pending` with zero entries is not running/passing CI. This local branch remains unpublished.

## Cleanup, side effects and next stage

No PF-1 containers or redundant source copies were created. Needed engine build outputs remain ignored for subsequent stages; fresh verification logs are separated from historical receipts. The inherited denied PF-0 temporary child remains **BLOCKED**, untouched and not retried. Its earlier automatic approval rejection was `blocked by policy`; no workaround is used.

The first .NET invocation with a fresh private CLI home printed installation of an ASP.NET Core HTTPS development certificate. No trust or removal action was performed. Later commands explicitly disable certificate generation. Preservation claims cover the recorded repositories/containers, not a comprehensive audit of global SDK state.

PF-2 can now start. Its real native/converted evidence gate remains open. Read-only investigation found the named NWD, installed Manage 2027 APIs and package-free native automation examples; actual isolated capture and comparison are still required. Preserve the original host plugin/configuration and model bytes. Prepare the durable PF-2 handoff and continue automatically in a new local branch inheriting this delivery.
