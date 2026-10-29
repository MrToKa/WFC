# Saved exact-route display on first popup opening

Date: 2026-10-25. Status: installed and independently verified on 5191;
qualified cleanup complete.

## Observed cause

The user's `=H1=KF1=TAC1=WGA1` popup displayed the stored Cable list route and
58 m design length but disabled Show. A read-only observation found a complete,
sealed proposal with 174 persisted path points and a proven automatic own write
from cable revision 18 to 19. Its saved route and design length match the Cable
list. Its model, preparation and actual barrier snapshot remain unchanged.

The proposal predates the current engine identity, the derived destination-group
planning metadata and the 2048-parent resource profile. Existing first-open GET
hydration was already present. The refusal came from treating current calculation
authority as a prerequisite for viewing the already saved geometry.

## Separate display qualification

The new optional `calculation.savedExactDisplay` flag grants only read-only
display of the exact saved path. It does not change calculation currentness,
reviewability, accepted-current proof, Review or Apply authority. The UI uses a
separate `saved-exact` display source and the existing `showPath` point transport.
It does not reconstruct a route from tray names or submit Calculate on opening.

Qualification retains the original result/length/barrier seals, exact proposal
tuple, latest own-write receipt, saved cable values, model/frame, From/To bindings
and physical obstacle dependencies. The canonical comparison may normalize only
explicit display-only implementation/metadata differences in a local copy:

- Supported engine implementation hashes, with matching schema, upstream source
  and policies apart from the documented resource-profile transition.
- Valid `destination-groups-v1` derived routing-balance metadata. A background
  occupancy/layout hash change does not move the already saved path. All other
  project settings and their revision remain exact.
- The explicit mixed profile v3 to v4 authoring allowance change from
  128 parents/256 components to 2048/2048. Both canonical profile hashes and all
  other profile fields must match their defined values.

The unchanged receipt proof explains only its own cable revision increment.
There is no general exception for changed endpoints, scene, obstacle snapshot,
mathematical settings, invalid profiles, missing receipts or changed saved values.
The saved display makes no claim that the old choice is optimal under new
planning settings; fresh calculation and write authority remain separate.

Unsaved endpoint edits, unresolved Save/Apply, a replacement calculation, changed
account/model/scope and late or mismatched replies withdraw Show readiness.
Hide remains available for an already displayed path. Show/Hide/Show reuses the
same checked persisted points.

## Verification and delivery

Backend/shared checks after the bounded metadata refinement: 235 PASS. UI:
362 PASS across Results (158),
Workspace (120), Panel (73) and integrated Save/display flow (11). Client/server
types, scoped lint and diff checks passed on the final frozen sources. The first
real-reader check identified the
additional legacy metadata differences; an engine-only unit fixture was
insufficient. With the bounded refinement, the actual production repository
reader qualified the user's exact 174-point, 58 m saved route in 1.067 s, returning
`savedExactDisplay=true` while `currentness=changed`, `reviewable=false` and
`acceptedMatchesCurrent=false`. The job and item remain complete. It used an
existing valid administrator/login and the unchanged SELECT-only repeatable-read
boundary in a throwaway helper, without creating a login, recalculating, writing
project data or patching the running container. The helper was removed.
Independent review of the final frozen backend and UI sources passed.

The browser tool's origin restriction remains in force. Component integration,
actual read-only repository checks and installed byte/health checks must be
reported separately from a live browser acceptance test.

Private local evidence remains under
`D:/Codex-test-output/graph-reuse-20261025/`, including
`first-open-diagnostic.json`, `saved-exact-ui-receipt.json` and
`saved-exact-display-qualified/qualification.json`.

## Installed result

Owned operation `530a2206-9772-496d-8ef2-455987a3d0d6` completed initialization
and all eight subsequent phases. The independent final verifier passed at
2026-10-25T15:52:18Z: all three retained conservation windows were requalified,
16 served/static files matched their immutable image bytes, the temporary 5192
target was retired and all helper commands joined and were removed.

| Component | Installed SHA256 |
|---|---|
| API image | `c8ff03e5cb5fae5fd251e971c20ecee122a7fad33f0d9c200c4cb90cb9e2e618` |
| Web image | `86237f912dd6c614c6dd6f432e4534e5fe53adadb8da31659a36aacaa64f2fd9` |
| Unchanged v2 engine identity | `1775e210ae86bc59d6550c58ab3be75907168f6a7ef399aade78e049577a3c9a` |
| Unchanged v3 engine identity | `399bc584f23fbf9035c0dad25c8fe86cd8967a76eacf2524431f63295aee8dca` |

The six native modules and all 48 protected compiled projection files are exactly
equal to G2, with closure SHA256
`c8a8fe48227726600b6756ca1558f9a280969f349f2f503f56790b43c05d6a94`.
Routing algorithms and native cache selection are unchanged. The unchanged
native benchmark was not rerun.
The prior native Aalborg mathematical qualification is inherited only because
these bytes and both complete identity bodies are equal.

The actual new immutable API image, without any code overlay, passed the saved
route reader check before installation (1.092 s) and after installation (1.099 s).
The latter returned the exact existing 174 points and 58 m route, with saved
display true and all stale/current-write restrictions unchanged. These are
repository reader timings, not live browser Show latency.

The root agent independently observed actual API/web containers running and
healthy, web bound to 127.0.0.1:5191, PostgreSQL healthy and MinIO running. Actual
API environment remains `session / interactive / graph-cache=0`.

Project conservation passed at 2026-10-25T15:54:03Z: all six compared
project/model/prepared metadata records are unchanged. The original Aalborg and
clean copy each retain 2140 cables and 31 barrier parents; their barrier revisions
remain 12 and 1 respectively. No qualification created a login, submitted a
calculation or wrote project data.

Evidence under
`D:/Codex-test-output/graph-reuse-20261025/deployment-saved-exact/`:

- `candidate-behavior-gate.json` and `candidate-calculation-closure.json`
- `candidate-workflow-qualification.json`
- `final-verification.json`
- `installed-workflow-qualification.json`
- `final-project-conservation.json`

## Cleanup

The latest verified full backup is
`82dbb222-aefe-4872-af07-791e0bf0e29d` (4109313023 bytes including its retained
files/metadata). Both immediate G2 and original pre-graph rollback configurations
and all six current/G2/original API/web image pins remain retained.

The independently reviewed new schema-v2 retirement guard passed 147 pure checks.
Its corrected wrapper binds the actual G3 verifier, full backup verification,
source health/configuration, image/rollback pins, active mount ancestry and fresh
regular-file/single-link/path/hash facts. It may unlink only eight exact payloads
of the older G2 backup, totalling 4108831341 bytes. Its inspector, manifests and
receipts remain. Execution was authorized only after G3 final PASS and the root
agent's independent actual health/pin/environment check. Execution passed:
eight files / 4108831341 bytes removed, with the latest backup reverified and
source health passing.

The preceding G2 operation also retained obsolete raw conservation copies. A
read-only inventory found no reference from the current G3 operation, runtime,
backup or calculation closure to those raw files. The independent reviewer
approved a separate manifest-bound retirement disposition after 94 focused
tests and a full SHA256 check of every target. It removed only 2304 exact
`table-0000.ndjson` through `table-0143.ndjson` payloads in 16 explicitly approved
old G2 capture groups, totalling 6530369245 bytes. There was no directory/glob
deletion, database operation, service stop or Docker-image deletion.

All 48 old metadata files (12439045 bytes), inspectors, old PASS/retirement
receipts, both rollback records and all eight application/platform image pins
remain. Full independent raw replay of the expired G2 operation intentionally
ends; its metadata and original PASS attestations remain. The complete current
G3 raw audit and latest recovery backup remain available. The current G3
operation occupies approximately 4.110 GB for the backup and 6.626 GB for its
unique conservation inventories. The older failed capture and previously
refused small Windows cleanup targets were outside this retirement scope.

Combined retirement removed **2312 files / 10639200586 bytes** (10.64 GB).
The root agent independently confirmed all 2304 raw targets absent, verified
all 48 retained metadata byte counts/hashes, and had already confirmed the eight
expired archive targets absent. Final actual Docker inspection again showed the
expected API/web image pins running and healthy, PostgreSQL healthy, MinIO
running, and `session / interactive / graph-cache=0`. The observed C: free space
was 91241373696 bytes (91.24 GB / approximately 84.97 GiB).

Cleanup evidence under `D:/Codex-test-output/graph-reuse-20261025/`:

- `cleanup-saved-exact-execution.json` and
  `cleanup-saved-exact-parent-observation.json`
- `cleanup-g2-raw/preparation-receipt.json`, `target-plan.json`, `execution.json`
  and `parent-observation.json`
- `deployment-saved-exact/completion-summary.json`

## User acceptance

Close the old cable popup, hard-refresh the main 5191 page with Ctrl+F5 and reopen
the cable. The saved exact path should become available through Show without a
new Calculate. To update the result under the current calculation settings, use
Calculate, close/reopen the cable and verify Show again. The live browser action
remains a user acceptance check because the browser tool denied this origin;
server qualification and component integration are not reported as a live UI run.
