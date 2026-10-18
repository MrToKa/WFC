# PathFinder local implementation progress

## Authority and environment

The user explicitly authorized automatic implementation of the remaining stages on 17 October 2026, invoking `prepare-stage-handoff` after each completed stage and using recommended choices for routine questions. The subsequent instruction starts that work now. Historical per-stage stop instructions do not require a fresh confirmation. Final integration into the existing application remains a separate user decision.

- Working copy: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
- Current branch at resumed implementation: `pf-3-locations-local-20261018` (inspect live branch/HEAD before each continuation).
- Current implementation/evidence checkpoint: `491c11c4398038854dd71674ee77df0c51661fff` (blocked partial PF-2, not stage completion). The accompanying progress index is committed separately; inspect live HEAD on resume.
- Starting commit: `23741d1f485248ddb519f9e04e0b7856cc0e3def` (PF-0).
- Canonical reference: PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a`.
- Original WFC, both PathFinder checkouts, running containers, databases and storage are reference-only.
- No push, PR, merge, deployment or updating the existing installation is authorized.

## Current work

**18 October user resumption supersedes the earlier routine stop:** automation is
ACTIVE again. See `18-execution-resume.md`. Independent PF-3 registry, PF-4
protected Viewer/UI, PF-5/PF-6 jobs/Apply and separate runtime work are progressing
in parallel; this does not waive PF-2/PF-7 engineering evidence. Current registry
source milestone: 20 pure +10 real SQL checks PASS, new ModelRunner 26 PASS,
fresh Core 105/215 PASS. Initial HTTP 12/13; alias-update needs refreshed-image
retest (source includes endpoint). See `03-stage-report.md`; no overall stage
acceptance or engineering Apply claimed. Runtime is new own localhost5190 with
fresh credentials/database/storage and copied model. Original resources stay
reference-only. Generate/finalize each subsequent handoff from real interfaces
and continue; do not treat old PAUSED entries below as current authorization.

PF-1 is **technically complete and verified** at local commit `db1b76ec32286d290210ba11adc0738c96665372`: 105/105 original regression checks and 215/215 parity/boundary checks, including 43 frozen cases, 33 production DTO replays and 14 CLI scenarios. Independent review fixes were verified, followed by the combined verification entry point. PF-2 has a **BLOCKED partial delivery** under `handoffs/PF-2.md`, inherited handoff commit `859949c` and earlier WIP checkpoint `f4d46ab5281ded40d0a0357c2f1cb1e23f5a5dc4`. This continuation records actual converted checks and the now-proven native licence blocker. Final human acceptance remains separate.

PF-1 has no user interface. Automated code/math checks use the normal build/test tools. The `computer-use` skill has been loaded and initialized for visual checks when an interface is available. No terminal is controlled through computer-use.

## Stages

| Stage | State | Next evidence |
|---|---|---|
| PF-0 | Technical PASS; inherited cleanup BLOCKED | Frozen receipts and local commit above |
| PF-1 | TECHNICAL_PASS | Extracted DLL; 105 original regression and 215 parity/boundary checks; source/environment preservation PASS |
| PF-2 | BLOCKED; partial implementation verified | Native host reports entitlement not found; full-precision reference and remaining graph/capacity work required |
| PF-3 | IMPLEMENTED; verification in progress | 20 pure +10 actual SQL PASS; refresh candidate HTTP alias-update check |
| PF-4 | IN_PROGRESS | Additive protected exact renderer/picking/metadata and strict-admin UI; source tests recorded separately |
| PF-5 | IN_PROGRESS | Durable jobs/new module work; no completion claim |
| PF-6 | PLANNED | Explicit Review + Apply, atomic revisions and provenance |
| PF-7 | NOT_STARTED | Integration, real-model parity, security and regression |
| PF-8 | NOT_STARTED | Isolated delivery, operations and demonstration |

## Inherited limitations

Frozen synthetic data does not prove real converted-model parity. Paired full-precision native/converted evidence is a substantive PF-2/PF-7 prerequisite. Investigate available authorized sources before treating that prerequisite as unavailable; do not fabricate evidence or loosen thresholds.

The PF-0 temporary child `.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c` was denied recursive removal with `blocked by policy`. It remains untouched. Do not retry or bypass that denial. New build outputs stay under the new engine directory and are not committed.

## PF-2 checkpoint — 18 October 2026, Europe/Kiev

- Actual UI checks now **PASS at capture scope** in an explicitly addressed in-app browser tab. The earlier Brave URL-confidence refusal remains a historical failed attempt; it was not retried. Copied model rendered 664,556 fragments; complete inventory has 438,155 unique objects. Both selected meshes normalized and passed the strict C# reader: 68/26 leaves, 257/99 fragments, 91,934/34,674 vertices. Full plant mesh is not captured.
- Strict normalization caught duplicate-root enumeration, nonfinite SDK translation and Float32 matrix loss. Corrected capture uses binary64 matrices and rejects nonfinite values. Failed captures are retained. Actual matrix/sample consistency is zero residual; independent native equivalence is still unproven.
- Fresh Model tests: **82/82 PASS**. Normalizer/comparator controls after independent depth review: **27/27 PASS**; both actual captures revalidated to byte-identical snapshots. ModelCheck CLI smoke: **9/9 PASS**. Two actual converted ordered lookups and memory/disk cache consistency **PASS at diagnostic scope**, with reported fallback geometry and `needs_review`. See `02-stage-report.md` and linked timestamped receipts for exact checked inputs.
- Final independent SDK enumeration review fixed support for nonindexed triangle meshes: **6/6 PASS** against the pinned SDK implementation and an actual indexed fragment. A fresh browser reload and capture exercised the final helper route; both final captures normalized successfully, with exactly unchanged geometry/identity/coordinates and new provenance hashes. The final screenshot and compact browser receipt are retained. Temporary browser/server are now closed/stopped; no port-5185 listener or native host remains.
- Actual lengths are 107.55007443085563m / 37.050260813690024m with explicit 1.0m diagnostic connection tolerance. They differ from the historical rounded 100.972m / 35.299m reports; this is unresolved, not an engineering or native parity PASS. Equipment From/To, project design allowances and SECONDARY design replacement were not evaluated by ordered lookup.
- Native Automation startup failed `0x80080005`. A separate documented direct CLI launch actually started Manage2027, then exited 2 before capture; its log reports **NOT Authorized / entitlement not found**. No licence/account/registry/installed-plugin changes or repeated identical attempts occurred. No owned native host remains. Only installed Manage2027 and Freedom2025 were found in the inspected standard application directories; no complete existing native export is available.
- `PathFinder.Model` caches fitted geometry; the endpoint-dependent graph is still built per calculation. Full graph preparation, complete geometry/category/visibility/source proof, real engineering tolerance, native parity and plant capacity are **not complete**. Do not advance to PF-3 or generate a success handoff.
- Changed files are confined to the new Model library/tests, diagnostic capture/normalizer/comparator/CLI/native-runner tools and `docs/pathfinder/`. The pinned Core and original regression sources remain unchanged. The local checkpoint commit following this update contains the complete file list and current evidence; `verify-isolation.mjs` records its checked source-set hashes separately from the pre-commit HEAD.
- Automation `pathfinder` was set to **PAUSED** through the application tool after the concrete external blocker. Resume only when an authorized full native reference is available or the user resolves the local entitlement and authorizes another capture. Retain existing code/copies/evidence and continue the first unmet PF-2 gate, not a duplicate PF-1/PF-2 implementation.
- The two denied cleanup children remain visible and untracked. No new removal attempt was made. New necessary build/cache/capture data is retained in ignored `pathfinder-engine/.scratch/`; no PF test containers were created.
- Final preservation audit **PASS**: `evidence/pf2/isolation-1792271766371.json` binds the actual engine source set to SHA256 `3b274e1e9ab562c9fd45009699ed23eff749849915732555066ebd6f53aff5a1`, preserves Core/native pins, frozen PF-0 material, all original checkout/dirty files and thirteen original container identities/images/start times. Final two recapture ModelCheck results exactly reproduce the prior valid outputs; see `model-actual-final-summary-20261017T2115Z.md`.

Next dependent step: obtain a complete full-precision native oracle for the same source, review identity pairs, investigate fitting/length differences, then complete the remaining PF-2 graph and capacity requirements. The runtime is intended to operate without Navisworks; this native dependency is for validation only.

## Resume protocol

Inspect current Git status and the stage reports before resuming. Finish the current stage, retain actual check results, review and commit locally, prepare the next durable handoff, then execute it. Never relabel historical checks as a new pass. On a real external blocker, continue independent authorized work and record the exact unresolved gate. Stop repeated unchanged attempts. Disable the automation after verified local delivery or when user input is indispensable.
