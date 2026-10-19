# PF-R7 — durable automatic recalculation and proposal provenance

Status: **TECHNICAL_PASS at the recorded local diagnostic/synthetic scope**.
The implementation, runtime controls and final seven frontend suites below are
verified. The next step is the local delivery commit and immediate R8 handoff.
Human engineering acceptance and full-plant coverage remain **NOT_ESTABLISHED**.

Workspace `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
`pf-r7-durable-recalculation-local-20261019`, inherited R7 handoff
`bc6e0e1fd3188a7dfd2cc27ba228b3cbe46ef2c1`. This report describes the actual
uncommitted candidate source; the eventual delivery commit is recorded separately.

## Delivered behavior

An administrator explicitly enables **Automatic recalculation** for at most
30 minutes under the current login. Relevant engineering changes are recorded
durably in the transaction that changed them. Bounded debounce combines a burst
into the latest desired generation. A ready coherent project scope becomes one
atomic generation enrollment and calculation job; missing inputs remain precise
blockers without repeated empty jobs. Pause, resume, retry and disable are durable
commands with current-role checks, control revision and exact idempotency receipts.
There is one server producer; the former browser-local automatic producer is gone.

Changes to routing rules, shared endpoints, active geometry/model, relevant
comparison evidence, engineering Details or cable inputs conservatively affect
all ready project cables. Drawing-only layout, declared tray audit length and
Path Finder's own Apply output marker do not create rerouting events. S/E/P-only
changes may reuse the latest successful route only after exact non-settings
authority and unchanged connection gap have been verified. An intervening gap
change cannot be skipped by searching older matching geometry history.

New proposal dependencies are v5 and freeze actual four-DLL implementation and
computational projection hashes alongside the existing model, aggregate, routing,
endpoint, comparison, Details and cable-write revisions. v2/v3/v4 remain historical
readers. Current dispatch, completion, Review and Apply check current v5 inputs;
original automatic enrollment authority cannot be supplied by a different valid
reviewer login. Results are immutable proposals, never automatic cable writes.
Original C# Core/runner mathematics, SECONDARY, allowance formula, tie/guard
behavior and Instrumentation-to-Control semantics remain unchanged.

The serialized engine lane yields after one calculation invocation. Persistent
project service order prevents many jobs in one project buying extra turns.
Clean yields do not spend crash-recovery attempts. Expired leases have bounded
recovery; cancellation pauses the associated automatic enrollment. A failed
process join or lost worker owner cannot become a successful/cancelled proposal.
Unconfirmed joins quarantine ownership; loaded implementation changes stop the
worker and are surfaced by a separate bounded observer transaction.

The English UI shows finite enablement, progress, blockers, generation, calculation
mode and immutable provenance. Unknown command outcomes retain the exact bounded
command across a reload under the same project/account/token epoch; a fresh
authorized GET precedes reconciliation. No bearer is stored in that recovery
record. The protected bridge, exact yellow path, filled Ghost, original tray
colors, Clear and Restore view remain in use.

## Verification at the recorded scope

Evidence links below are under `evidence/recalculation/`. Counts overlap; focused
tests are not added again to the combined totals.

| Check | Recorded result |
| --- | --- |
| Backend and shared regression | PASS87files/189suites/1484checks, 0FAIL, 5 optional lookup-worker checks NOT_RUN. File count is the87unique testResults names, distinct from the JSON suite count. Final private `r7-final-backend-tests10.private.json`. |
| Final frontend regression | PASS7files/83checks/0FAIL/0NOT_RUN, serial verbose root run,967.38s. Together with the disjoint backend/shared selection:94files/1567PASS/0FAIL/5NOT_RUN. First JSON-only run was interrupted without a result; it is not a product FAIL or PASS. PathFinderTab deliberately permits60s per interaction test and uses expensive FluentUI role/style queries. |
| Source/build | PASS both TypeScript checks, full ESLint and candidate3 API/web builds; source context and exact images below. |
| Fatal/observer/session controls | PASS79checks across4files; includes16observer and8fatal-worker cases. Failed kill/join/owner/loaded-implementation controls use mocked process/database adapters, not actual unreaped production children. |
| Actual PostgreSQL | PASS14 bounded rollback-only phases: event coalescing, Details, drawing/Apply-marker exclusions, cable statements, generations, expiry/revocation, immutability/FKs and authority/lock ordering. [actual-controls.json](evidence/recalculation/actual-controls.json). |
| Actual scheduling | PASS production claim/finish SQL through a rollback/savepoint envelope, four jobs/two projects, project fairness and21clean slices without burning recovery attempts. This is not sustained throughput. [actual-fairness.json](evidence/recalculation/actual-fairness.json). |
| Actual Settings/C# flow | PASS candidate2 normal Details PATCH: S/E/P-only uses `design` and preserves exact route/diagnostics/category; gap change uses `calculate`; restoring all original settings uses `calculate` and restores route/design exactly. [actual-settings2.json](evidence/recalculation/actual-settings2.json). Candidate3 did not change reuse mathematics; its new implementation identity correctly invalidated older proposals. |
| Actual authorization | PASS normal context/command403 after temporary demotion of the owned fixture actor, anonymous401, restored role exact; superseded Review409; current-state expiry gives409AUTOMATIC_AUTHORITY_EXPIRED under another valid login, then exact scheduler-state restoration. Immutable enrollment was never edited. |
| Actual expired-lease recovery | PASS declared fault injection on one NEW completed fixture job, production worker/C# recovery to attempts2/slices4, three original proposals and all item rows exact. No observed process-crash claim. |
| Actual running cancellation | PASS normal authenticated retry, observed running0/3, durable before-action capture, normal DELETE, cancelled0/3 and persistent automatic pause/no restart. No direct job-row mutation for this control. |
| Actual UI | PASS candidate3 protected model load; three tools; current v5 proposal, generation/engine provenance, yellow route/filled Ghost; Clear then Restore view returns the whole opaque model. Private screenshots `r7-final-proposal-ui.png` and `r7-final-cleared-ui.png`. No Review/Apply success. |
| SQL/PF_ROOT preservation | PASS110baseline/116final tables:104 old tables exact,6 old tables receipt-qualified,6 new tables reconciled. All114oldfiles/17,384,086bytes exact.10newjobs/30items/27proposals/7commands. [preservation.json](evidence/recalculation/preservation.json). |
| Storage/reference sources | PASS1547objects with exact key/size/ETag/lastModified metadata, no added object. This is not a fresh raw SHA rehash. Three reference checkout branches/HEAD/status/trimmed tracked patch hashes exact; old untracked file contents are not newly certified. |
| Cleanup | PASS four owner-verified unused candidate1/2images and six already-retained files in one exact own `/tmp` capture removed; no new test container and no prune/force/denied-path retry. Keep5191, checkpoint, private companion and evidence. |

The first Settings replay exposed the older-history reuse bug; its failed control
and restoration were retained before the candidate2 correction and successful
fresh control. The first offline classifier compared raw `pathPoints` with the API
projection `points`/unique `objectIds`; its FAIL is retained beside the exact
source-defined DTO correction and116-table PASS, with no data exception. Recovery
HTTP harness mistakes about `state` versus DTO `status` were corrected by read-only
readback, without repeating the injection. The first cancellation helper refused
an incorrect port precondition before any action; the corrected API_PORT4000
control is independently recorded. Reference patch hashing initially omitted the
baseline's trim convention; canonical re-reading matched, with no source repair.

After the full tests, the final staging check found one extra EOF blank line in
recalculationRepository.test.ts. The initial local commit had been made before
that result was handled; it was corrected by removing only that blank line and
amending the unpushed local delivery after a clean staged diff check. No runtime
statement changed, and no new full test execution is claimed for whitespace.

Four UI command receipts were reconciled retrospectively from exact immutable
server rows plus observed browser actions. They are explicitly not reconstructed
pre-action intents or network recordings. Normal HTTP command evidence and the
actual cancellation before-action capture are distinguished in preservation.json.

## Runtime and external lifecycle observations

Candidate3 source context
`a5f4f2bde38ca3789fd07c55c4319467b189608e95f47e5918de6084f64d24ed`,1420files,
built on the inherited HEAD above with the coordinated R7 working changes.

- API image `sha256:6b182c2704f15168e42032bab390f97949f432dffe6b8e788ce94498dba2fe0b`;
  container `3edd0b47ab7e401a3c5d17530d99fc4e0adeea2300a2ccef483b39da52872537`.
- Web image `sha256:6d7aa2a62bf2a41fb2749f08965392f62c630bda2d62b810e96989407afe3719`;
  container `edc60e0f89b6e36d676e46d09bdf908ccb8a5e6f746677fa426ee80d6f36c378`.
- Loopback5191, owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, Docker project
  `wfc-pathfinder-local-0cba87606e9b`; private approved profile6 in owned R7 work
  `.scratch/tray-catalog-e62e3f89-80dd-4261-ac5b-da1f7d936b4c`.

The user personally started Docker after the pause. Nine outside container start
times changed through that external daemon startup. The agent started only four
exact owned stopped5191containers and later replaced only its API/web. The
original `/wfc-app-backend-1` was independently observed in an autonomous restart
loop. No original start/stop/exec/update/repair was performed by this stage.

All18outside IDs/images remain pinned;17 start times are strict from the resumed
baseline. The one exact original backend has monotonic restart/start observations,
exact current configuration/restart-policy/mount/network/port-binding identity and
separate private pre/post lifecycle records, including failed operations.
This is **EXTERNAL_CHANGE**, not unchanged-container PASS. Dynamic endpoint/IP
fields are observed separately for that container. Full configuration equality
before the first full pin is NOT_ESTABLISHED. Failed unsorted Docker Mounts hashes
were retained; exact mount entries are compared after destination sorting.

Pre-R7 cold checkpoint `592e502e-4f1f-4942-85c4-16ac22670c6a` retains8members,
4images, verified dump TOC and1541raw-verified model resources across5versions;
private host provenance remains separate. [checkpoint.json](evidence/recalculation/checkpoint.json).
Full restore of this checkpoint is NOT_RUN; R10 owns final restore/offline delivery.

## Capability boundary and next stage

R7 is Level A: protected preparation plus explicit human bindings and a current
finite enrolled administrator login. It does not provide indefinite background
authority or closed-browser model extraction. The real copied project retains
330trays/2140cables/51types, Details7/5/10/gap1 and unresolved real From/To names;
the retained13-object diagnostic network is not the complete plant network.
No seed, model conversion/import, real correspondence/frame acceptance or
engineering Apply was repeated or manufactured.

After the now-completed frontend verification, commit the technical delivery locally, apply
prepare-stage-handoff for R8 and execute immediately on a new inherited branch.
R8 must introduce a separate explicit server-owned calculation-only grant and a
qualified bounded managed geometry producer. It must not fabricate a human login,
reuse a bearer indefinitely, bypass the protected bridge or grant Review/Apply.
Original checkouts,5190 and existing installation remain outside mutation scope.
No push, PR, merge or deployment is authorized. The automation remains ACTIVE.
