# PF-2 — Implementation checkpoint (not complete)

PF-2 is **IN_PROGRESS**. This report is a durable continuation checkpoint, not a completed stage or acceptance claim. Resume the existing work under [PF-2 handoff](handoffs/PF-2.md); do not generate PF-3 on the basis of this filename.

Working copy: `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch `pf-2-model-geometry-20261017`. Verified PF-1 delivery is `db1b76ec32286d290210ba11adc0738c96665372`; next-stage handoff/progress commit is `859949c`. There has been no push, PR, merge or updating of the original installation.

## Implemented and checked scope

| Part | Actual evidence / state |
|---|---|
| Computational snapshot, affine transforms and fitted-geometry cache | Implemented under `pathfinder-engine/src/PathFinder.Model`; 68/68 synthetic contract/transform/cache checks PASS in `evidence/pf2/model-tests-latest.json`. Actual captured-model integration remains pending. |
| Converted capture harness | Implemented under `pathfinder-engine/tools/model-capture`; 342 package resources and 206 SDK files hash-verified; six local HTTP boundary checks PASS. Actual browser initialization/rendering/inventory/mesh capture NOT_RUN. Owned port-5185 server stopped cleanly. |
| Unique native oracle | Separate net48/x64 plugin and runner compile; fourteen pinned source copies remain byte-identical. First actual Automation startup failed before OpenFile with `0x80080005`, matching DCOM event10010. No native reference capture or parity PASS. No owned runner/Roamer remains. |
| Reusable route graph | NOT_IMPLEMENTED: cache stores fitted geometry; unchanged core still builds the endpoint-dependent graph per calculation. This distinction is explicit. |
| Real native/converted comparison | NOT_RUN: neither paired data nor actual Viewer capture is available yet. |

Current ZIP is 439112840 bytes / SHA256 `e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922`, differing from the older transport observation. The complete verified 342-resource fingerprint is unchanged: `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`. Old reports are preserved. This does not invent a cryptographic link to the original conversion input.

## Why browser verification did not run

The `computer-use` runtime refused a Brave Ctrl+T action because it could not confidently determine the current browser URL for policy enforcement, then ended computer use for that turn. No browser action was retried and no alternate UI tool was used to evade that refusal. The harness itself was not observed in a browser. New visual checks require an allowed session with reliable target URL identification.

## Resume steps and limits

1. Read the model project/test README, converted harness README and `evidence/pf2/native-checkpoint.md` plus startup diagnosis. Preserve failed receipts and actual check scopes.
2. Resume the separate converted server and perform inventory/reference mesh capture through authorized computer-use when available. Capture units/root/offset/visibility facts, not display assumptions.
3. Investigate the documented direct Roamer command-line startup candidate using only a new owned process, copied NWD and unique plugin, with bounded lifetime. Do not change registration, startup options, installed plugins, account/licence state or original model bytes. The alternative was not attempted at this checkpoint.
4. Map actual native/converted capture schemas into the computational snapshot and run real comparison checks. Category assignments are explicit planning inputs; unknown native visibility and unproven source/transform facts remain review diagnostics. Do not enable engineering writes on an unverified capture.
5. Resolve the remaining graph preparation/reuse and measured-capacity requirements honestly before declaring PF-2 complete. Preserve the pinned core reference and its regression evidence.

Bulk model copies and captures are owned ignored scratch, separate from original data. Needed evidence and copied reference inputs are retained for the next attempt. No test containers were created. The inherited PF-0 cleanup denial remains untouched and is not retried. Final technical completion, human acceptance and integration authorization are all still separate.

Automatic approval review also rejected removal of the new owned test fixture child `.pf2-work/model-tests-2733f823d57d477ba5e338a7d9a08cc9` with exact reason `blocked by policy`. It was inventoried first (52 descendants, no reparse entries), but the removal did not execute. Cleanup is BLOCKED; no retry or bypass is allowed. The retained directory remains visible and untracked. The test source now uses ignored engine scratch for future fixtures; this path-only change does not relabel the earlier executed check or remove the denied directory.
