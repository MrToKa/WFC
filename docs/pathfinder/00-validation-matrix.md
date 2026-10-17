# PF-0 — Validation and future acceptance matrix

Source baseline: WFC `e1ef20202598bb4d3d78e4772cbbb9747ec23a00`, PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a`. PF-0 documentation lives only in local worktree `WFC-pathfinder-local` / branch `pf-0-contracts-baseline-20261017`.

Read the [baseline](00-baseline.md), [specification](00-specification.md), [parity catalogue](00-parity-fixtures.md) and [stage report](00-stage-report.md). This is a new matrix; old Routings viewer criteria and evidence are not overwritten.

## Status rules

- `PASS`: the specifically named check was performed successfully at the recorded scope.
- `FAIL`: the check was executed and the stated expectation failed.
- `BLOCKED`: a concrete prerequisite prevents the stated check.
- `NOT_RUN`: no execution of that functional check is claimed.

The first table accepts PF-0 **contracts and evidence**, not the future implementation. A source/contract PASS does not imply working admin UI, exact conversion geometry or end-to-end parity. Final human acceptance remains a separate user decision.

## PF-0 deliverable criteria

| ID | Observable criterion | Method / evidence | Result |
|---|---|---|---|
| PF0-BASE-01 | Both original PathFinder checkouts and WFC are distinguished by path, HEAD, branch, dirty state and live/cached remote comparison. | `evidence/00-start-state.json`; `evidence/01-github-observations.json`; baseline old-checkout analysis | PASS |
| PF0-ISO-01 | Deliveries are confined to the new local WFC worktree/branch; original main and old dirty files are preserved. | `evidence/02-final-validation.json`: original source/dirty hashes and scoped docs; known retained temporary child disclosed separately | PASS |
| PF0-REMOTE-01 | Remote heads, branch lists, unrelated open PR/reviews and exact-head CI observations are recorded with retrieval time. | `evidence/01-github-observations.json`; zero statuses/checks/Actions are not functional PASS | PASS |
| PF0-CORE-01 | Every active pure source file/function has an owner, input/output, host boundary and corresponding test/reference coverage; legacy code is distinguished. | Parity catalogue; 11 core / 9 harness hashes; final manifest audit | PASS |
| PF0-MATH-01 | PF geometry, category/gap priorities, approaches, lookup and Reverse semantics are frozen; formula ordering and precision are explicit. | Specification plus parity catalogue/source anchors and actual-core synthetic extraction | PASS |
| PF0-SET-01 | All three allowances are authoritative Project > Details values; null/zero, units, snapshot and invalidation are explicit. | Specification/contracts; actual WFC field mapping and user decision | PASS |
| PF0-CAT-01 | MV/LV/Control map directly and user-confirmed Instrumentation maps to Control; missing/unknown categories require resolution. | Specification and contract examples; explicit user reply 17 October | PASS |
| PF0-LOC-01 | One project location identity serves both directions/multiple cables, with versioned position bindings, ambiguity and manual precedence. | Specification/contracts; missing-registry source review | PASS |
| PF0-AUTH-01 | Strict admin UI/API/job/Apply checks are specified separately from broader engineer capabilities and session/project access. | Specification/contracts and WFC middleware/tab source review | PASS |
| PF0-VIEW-01 | Exact computed path/picking contracts respect the existing message limit and project/model/load/request fences; Ghost is preserved. | Specification/contracts vs current protocol | PASS |
| PF0-APPLY-01 | Automatic drafts, explicit review/apply, input/write version comparison, idempotency, audit and unchanged install length are specified. | Specification/contracts vs current cable update/history; independent review corrections | PASS |
| PF0-INPUT-01 | Model input explicitly declares geometry/units/transforms/identities/visibility; display readiness is distinct from calculation readiness. | Specification/contracts and parity input catalogue | PASS |
| PF0-REF-01 | Synthetic expected results originate from the unchanged actual core with source hashes and a reproducible generator; missing real paired cases are disclosed. | Fixture manifest, 43 expected cases, generator, repeat and final source/artifact hash audit | PASS |
| PF0-TEST-01 | Existing package-free pure Release harness is executed from an isolated source copy; exact count/log/private-fixture omission retained. | `evidence/pf-core-release.log`, 105/105 and `pf-core-summary.json` | PASS |
| PF0-DOC-01 | Local document links and JSON examples/schemas are consistent; expected hashes, source identity and owned-file scope are checked. | `evidence/02-final-validation.json` technicalStatus PASS; independent document review | PASS |
| PF0-PRESERVE-01 | No stage runtime is started; existing container identity/image/start state and original dirty file hashes remain unchanged. | `evidence/02-final-validation.json`: all 13 containers and three original source trees preserved | PASS |
| PF0-CLEAN-01 | Owned temporary core copies/build outputs are removed after evidence is retained; no original or necessary worktree files are deleted. | Automatic approval review rejected recursive deletion: `blocked by policy`; no executed deletion or retry. One retained child / 162 files / 3,586,733 bytes | BLOCKED |

## Future implementation criteria — all NOT_RUN in PF-0

| ID | Expected observable result | Target stage | Status / prerequisite |
|---|---|---|---|
| PF1-CORE-01 | Extracted core runs without Autodesk assemblies, COM or a desktop process; its synthetic outputs match the frozen reference. | PF-1 | NOT_RUN; preserve actual code and source provenance |
| PF1-API-01 | Bounded local worker/service accepts versioned inputs and returns exact path, lengths and diagnostics with cancellation. | PF-1 | NOT_RUN; contracts are proposed, not existing endpoints |
| PF2-GEO-01 | Real converted model yields equivalent world-space meshes, fragment boundaries, hierarchy and geometry-derived connections. | PF-2 | NOT_RUN; complete paired native/converted input evidence needed |
| PF2-ID-01 | Model-object/segment bindings are version-aware; units, root transforms and offsets agree for endpoints and paths. | PF-2 | NOT_RUN; cross-conversion identity must be proven |
| PF2-GRAPH-01 | Graph is prepared once per appropriate model/rule revision with bounded memory/time, progress and integrity checks. | PF-2 | NOT_RUN; real-model measurements required |
| PF3-LOC-01 | A single manual resolution automatically serves all matching From and To endpoints, persists after restart, and remains project-isolated. | PF-3 | NOT_RUN |
| PF3-LOC-02 | Missing/blank/duplicate locations remain distinguishable; no arbitrary first/fuzzy match; new model bindings are revalidated. | PF-3 | NOT_RUN |
| PF4-AUTH-01 | Admin UI, deep URL and every calculation/location/job/Apply API deny non-admin engineers; role revocation is respected. | PF-4 | NOT_RUN |
| PF4-VIEW-01 | Exact result points, endpoints and original tray colors are shown; surrounding geometry is Ghost; Clear restores prior state. | PF-4 | NOT_RUN |
| PF5-JOB-01 | Batch jobs continue independently of the tab, with progress, cancellation, retry/restart and deterministic input identity. | PF-5 | NOT_RUN |
| PF5-SET-01 | Edited Details values are read server-side; allowance-only edits recalculate design length without unnecessary geometry rebuild. | PF-5 | NOT_RUN |
| PF5-STALE-01 | Changed cable/location/model/rules/settings make old drafts outdated; stale work cannot become an applicable result. | PF-5 | NOT_RUN |
| PF6-APPLY-01 | Reviewed route/design length are applied atomically with current-input conflict checking, idempotency and attributable history. | PF-6 | NOT_RUN |
| PF6-APPLY-02 | Install length is preserved; manual/import changes invalidate the appropriate provenance; applied geometry is shown consistently. | PF-6 | NOT_RUN |
| PF7-PARITY-01 | Actual web pipeline matches representative reference paths, all numeric rules and diagnostic boundaries. | PF-7 | NOT_RUN; synthetic direct-core results are insufficient alone |
| PF7-REG-01 | Existing Details/Cables/Routings viewer/session/Ghost behavior remains usable; independent projects/models do not leak state. | PF-7 | NOT_RUN |
| PF8-OPS-01 | Separate local runtime has separate containers/DB/storage/ports; backup/restore includes new authoritative artifacts. | PF-8 | NOT_RUN; original runtime is not a deployment target |
| PF8-LOCAL-01 | Prepared model and local calculation work without Navisworks or conversion/cloud calls during routing. | PF-8 | NOT_RUN |
| PF8-USER-01 | User views the local demonstration and decides whether merging/publishing/deployment is wanted. | PF-8 | NOT_RUN; no blanket authorization inferred |

## Gates

PF-0 technical completion requires its deliverable rows to pass or to identify a concrete evidence limitation without hiding an unfulfilled deliverable. It does not require future PF-2/PF-7 parity checks to pass now. A missing real-model oracle is a PF-2/PF-7 dependency; it does not prevent extracting the existing pure core in PF-1.

PF-1 readiness means the reference source, mathematical contract, accepted decisions, fixture provenance and proposed boundaries are usable. If an unresolved question affects PF-1 inputs, state it explicitly. Do not silently infer acceptance or advance to PF-1.

## PF-1 execution — appended 17 October 2026

The preceding sections remain the frozen PF-0 observation. The user's subsequent explicit automation/start instruction authorizes PF-1 and later stages. This table records the new implementation and does not relabel PF-0 checks.

| ID | Current scope / evidence | Result |
|---|---|---|
| PF1-CORE-01 | Extracted separate DLL; eleven source files byte-identical; 105 original regression checks; 43 frozen cases replayed | PASS |
| PF1-API-01 | Strict local stdio worker/adapter, exact points/metrics/decimal values, bounded input, cancellation and hard process deadline; 215 boundary/parity checks | PASS |
| PF1-REVIEW-01 | Exact decimal rounding/underflow and `/LIMIT1` classification review findings resolved with fresh checks | PASS |
| PF1-ISO-01 | Source/environment audit preserves original three checkouts, local modifications and thirteen containers | PASS |
| PF1-CLEAN-01 | No PF-1 containers or disposable source clones; required ignored builds retained; inherited PF-0 denied child untouched | PASS for PF-1 scope; inherited PF0-CLEAN-01 remains BLOCKED |
| PF2-GEO-01 and later rows | No new native/converted, application UI, authorization, jobs or Apply behavior verified in PF-1 | NOT_RUN |

See [PF-1 report](01-stage-report.md), [core delivery](01-core-extraction.md) and their linked fresh evidence. Final human acceptance and integration authorization remain separate.
