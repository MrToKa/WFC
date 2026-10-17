# PathFinder local implementation progress

## Authority and environment

The user explicitly authorized automatic implementation of the remaining stages on 17 October 2026, invoking `prepare-stage-handoff` after each completed stage and using recommended choices for routine questions. The subsequent instruction starts that work now. Historical per-stage stop instructions do not require a fresh confirmation. Final integration into the existing application remains a separate user decision.

- Working copy: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
- Current branch: `pf-2-model-geometry-20261017`.
- Starting commit: `23741d1f485248ddb519f9e04e0b7856cc0e3def` (PF-0).
- Canonical reference: PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a`.
- Original WFC, both PathFinder checkouts, running containers, databases and storage are reference-only.
- No push, PR, merge, deployment or updating the existing installation is authorized.

## Current work

PF-1 is **technically complete and verified** at local commit `db1b76ec32286d290210ba11adc0738c96665372`: 105/105 original regression checks and 215/215 parity/boundary checks, including 43 frozen cases, 33 production DTO replays and 14 CLI scenarios. Independent review fixes were verified, followed by the combined verification entry point. PF-2 is in progress under `handoffs/PF-2.md`; the handoff itself is committed as `859949c`. Resume its existing code and evidence rather than starting duplicate workers. Final human acceptance remains separate.

PF-1 has no user interface. Automated code/math checks use the normal build/test tools. The `computer-use` skill has been loaded and initialized for visual checks when an interface is available. No terminal is controlled through computer-use.

## Stages

| Stage | State | Next evidence |
|---|---|---|
| PF-0 | Technical PASS; inherited cleanup BLOCKED | Frozen receipts and local commit above |
| PF-1 | TECHNICAL_PASS | Extracted DLL; 105 original regression and 215 parity/boundary checks; source/environment preservation PASS |
| PF-2 | IN_PROGRESS | Actual converted geometry, transforms, identities and native/converted comparison |
| PF-3 | NOT_STARTED | Shared project locations and From/To resolution |
| PF-4 | NOT_STARTED | Strict-admin tab, exact path rendering and picking |
| PF-5 | NOT_STARTED | Jobs, cancellation/recovery, settings and staleness |
| PF-6 | NOT_STARTED | Explicit Review + Apply, atomic revisions and provenance |
| PF-7 | NOT_STARTED | Integration, real-model parity, security and regression |
| PF-8 | NOT_STARTED | Isolated delivery, operations and demonstration |

## Inherited limitations

Frozen synthetic data does not prove real converted-model parity. Paired full-precision native/converted evidence is a substantive PF-2/PF-7 prerequisite. Investigate available authorized sources before treating that prerequisite as unavailable; do not fabricate evidence or loosen thresholds.

The PF-0 temporary child `.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c` was denied recursive removal with `blocked by policy`. It remains untouched. Do not retry or bypass that denial. New build outputs stay under the new engine directory and are not committed.

## PF-2 checkpoint and immediate next actions

- Converted harness: `pathfinder-engine/tools/model-capture/`, isolated URL `http://127.0.0.1:5185`. Its package/resource verification and HTTP boundary checks have new PF-2 receipts. The actual current ZIP hash differs from the historical handoff hash, while the full resource fingerprint agrees; preserve both observations. Actual browser geometry/inventory capture is **NOT_RUN**.
- The computer-use runtime refused a browser Ctrl+T action because it could not confidently determine the current Windows browser URL for policy enforcement, and ended computer use for that turn. No further UI action or alternate-tool bypass was attempted. Future visual checks require normally available authorized tooling and policy-compliant URL confidence; do not reset or switch tools simply to evade the refusal.
- Native oracle: unique isolated net48 plugin/runner compiled. The first bounded Automation API attempt failed before OpenFile with `Failed to startup Navisworks: -2146959355` / `0x80080005`. No native model/reference output was captured. Keep the failed receipt and investigate an authorized alternative without changing registration, startup settings or installed plugins. Official documented direct Roamer command-line switches may provide a separate API startup route; no such second attempt was performed at this checkpoint.
- Model snapshot/affine/cache code is being checkpointed separately under `src/PathFinder.Model` with its own tests and contracts. Read its final receipts before treating any checks as executed. Fitted geometry caching is distinct from the unchanged core's per-calculation graph construction.
- PF-2 is **not complete**. Real transformed/native geometry pairing and visual checks remain pending; do not advance to PF-3 by claiming synthetic/native parity.
- PF-2 synthetic model checks passed 68/68. Cleanup of their owned `.pf2-work/model-tests-2733f823d57d477ba5e338a7d9a08cc9` was rejected by automatic approval review with `blocked by policy`; the command did not execute. Keep this additional blocked child untracked and visible, with no retry or alternate-tool/parent-directory workaround. Future test scratch uses `pathfinder-engine/.scratch` but that does not authorize removing the denied target.

## Resume protocol

Inspect current Git status and the stage reports before resuming. Finish the current stage, retain actual check results, review and commit locally, prepare the next durable handoff, then execute it. Never relabel historical checks as a new pass. On a real external blocker, continue independent authorized work and record the exact unresolved gate. Stop repeated unchanged attempts. Disable the automation after verified local delivery or when user input is indispensable.
