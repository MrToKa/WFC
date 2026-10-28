# PF-2 — Blocked partial delivery

## Current result — 18 October 2026, Europe/Kiev

PF-2 is **BLOCKED and incomplete**. Independent converted-model work has been
verified, but a real native comparison is unavailable because installed
Navisworks Manage2027 reports **entitlement not found**. The automation was set
to **PAUSED** through the application tool, preserving its prompt and schedule.
PF-3 was not generated or started. No successful-stage acceptance is claimed.

Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-2-model-geometry-20261017`, inheriting PF-1 `db1b76ec` and earlier
PF-2 checkpoint `f4d46ab`. This continuation is saved in the subsequent local
checkpoint commit; its parent plus file/source hashes are recorded in the new
receipts. There is no push, PR, merge, deployment or original-app update.
The implementation/evidence checkpoint is `491c11c4398038854dd71674ee77df0c51661fff`;
[its exact 61 changed files](evidence/pf2/changed-files-491c11c.json) are retained
as a local manifest. This accompanying progress index is a documentation-only
follow-up; it does not relabel the blocked stage or redate earlier checks.

| Check and actual scope | Result / evidence |
|---|---|
| Model contract, hierarchy roles/depth, transforms, fitting/cache, corruption/cancellation controls | **82/82 PASS**; `model-tests-20261017T205840675Z.json` and `model-review.md` |
| Normalizer/comparator synthetic negative controls, including full inventory depth independent of traversal order | **27/27 PASS**; `converted-normalizer-tests-1792271475604.json` and `converted-inventory-depth-review-1792271503143.json` |
| Separate diagnostic CLI bounds/deadline/cache smoke | **9/9 PASS**; `model-actual-cli-synthetic-smoke-20261017T210221755Z.json` |
| Actual offline SDK rendering/inventory | **PASS at capture scope**; 438,155 unique objects / 664,556 fragments, [final browser screenshot](evidence/pf2/converted-browser-final.png); `converted-browser-20261017T211447340Z.json` |
| Two selected actual mesh normalizations and strict C# reader interop | **PASS at selected scope**; 68/26 leaves, 257/99 fragments, 91,934/34,674 vertices; `converted-actual-normalization-1792271262061.json`; depth-review revalidation produces identical snapshot hashes |
| SDK triangle enumeration, indexed/nonindexed meshes and original winding/group order | **6/6 PASS**, including an actual indexed fragment; `converted-mesh-indices-20261017T211403555Z.json`. Final UI captures strictly revalidated in `converted-final-capture-normalization-1792271689778.json`; geometry/identity/coordinates are exactly equal to prior valid captures. |
| Actual fitted memory/disk restoration and ordered lookup | **PASS at diagnostic scope** for both final captures; [exact results and timings](evidence/pf2/model-actual-final-summary-20261017T2115Z.md). Full route/segment/count outputs exactly reproduce the previous valid capture. Partial geometry, unknown categories/visibility and many reported fitting fallbacks remain. |
| Full-precision native/converted pair and engineering tolerance | **BLOCKED / NOT_ESTABLISHED**; CLI host actually starts, exits 2 before capture with licence denial. See `native-cli-license-diagnosis.json`; previous COM failure is preserved separately. |
| Full plant geometry/capacity, reusable graph preparation and representative automatic From/To/design parity | **NOT_RUN / NOT_IMPLEMENTED** at required scope; graph remains per calculation. No engineering-write readiness. |

The actual diagnostic lengths are **107.55007443085563m** and
**37.050260813690024m**, using explicitly recorded 1.0m connection tolerance.
They differ from historical rounded reports of 100.972m and 35.299m. Those old
reports are not full-precision paired fixtures; the difference is unresolved,
not an accepted engineering deviation. Ordered lookup does not evaluate
equipment From/To, Details allowances or SECONDARY design replacement.

The strict pipeline caught and corrected duplicate root enumeration, nonfinite
SDK translation, Float32 matrix composition, hierarchy owners becoming physical
fallback segments, order-dependent depth checks, queued cancellation and
quadratic exclusion validation. Rejected raw captures and earlier test receipts
are retained. Actual binary64 internal consistency does not prove native
tessellation/transform equivalence or recover earlier converter precision loss.

See [computational delivery](02-model-geometry.md) for the implemented boundary,
identity/transform/cache contracts and remaining gates. New code is confined to
the isolated Model library/tests and diagnostic capture/normalization/comparison,
ModelCheck, native CLI and preservation-audit tools; new documents/evidence are
under `docs/pathfinder/`. Exact paths are available in the checkpoint commit.
No original database, storage, volumes, model selection or containers were
written. No PF containers were created. Original source/container preservation
is audited in a new `isolation-*.json` receipt without rerunning PF-0 generators.
The final [isolation audit](evidence/pf2/isolation-1792271766371.json) is **PASS**:
eleven Core files, eight original regression sources, fourteen native pins,
frozen PF-0 deliveries, three original checkouts/dirty files and all thirteen
original container identities/images/start times are preserved. It hashes the
actual changed source set and records the pre-commit HEAD, rather than claiming
that earlier test receipts were executed at a future commit.
The owned capture server and temporary browser tab were stopped/closed after
verification; port 5185 has no listener and no native host remains. Necessary
ignored captures, copied inputs and caches are retained for resumption. Neither
of the two policy-denied cleanup directories was retried or bypassed.
The retained [automation state](evidence/pf2/automation-paused.json) confirms
PAUSED; this is an external prerequisite pause, not a completed task.

To resume, provide a valid authorized native host or a complete full-precision
native oracle capture from a licensed machine for the same NWD. Account/licence,
registry and installed-plugin state were not changed. Only Manage2027 and
Freedom2025 were found in the inspected standard installation directories; no
other available licensed host or complete existing export was established.
Resolve real pairing/fitting discrepancies and finish graph/capacity work before
declaring PF-2 complete and preparing PF-3. Navisworks is a validation oracle;
the planned production calculation runtime remains independent of it.

## Historical checkpoint — `f4d46ab`

The following retained observations describe the earlier checkpoint before the
successful converted capture and the separate native CLI attempt. They are
superseded by the scoped results above, not current NOT_RUN claims.

At that checkpoint PF-2 was **IN_PROGRESS**. Resume the existing work under [PF-2 handoff](handoffs/PF-2.md); do not generate PF-3 on the basis of this filename.

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
