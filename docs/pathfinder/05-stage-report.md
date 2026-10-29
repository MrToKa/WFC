# PF-5 — Local durable calculation jobs

Status: **implemented locally; bounded synthetic verification PASS; real-model engineering acceptance BLOCKED**.
The final local candidate and the earlier checkpoint are recorded separately.
No original WFC installation, original containers, working data, remote branch,
or canonical PathFinder checkout was modified by this stage.

## Delivered behavior

The strict administrator-only API creates durable project/cable jobs, captures
server-owned cable-write, settings, registry/binding, selection/model/artifact
dependencies, and invokes the existing C# mathematics through a bounded private
process. Project Details supplies all three allowance strings exactly. Successful
geometry is retained for settings-only `design` recalculation without rebuilding
the route. Results remain immutable proposals until explicit review and Apply.

The queue has one database advisory-lock engine owner, per-job ownership tokens,
leases, recovery attempts, progress and cancellation. Node kills the owned process
tree/group and waits for its child on cancellation/deadline. Publication rechecks
the current account/login and dependencies. The common principal transaction
holds project/admin/login locks and checks login expiry immediately before commit.
The project mutex uses `FOR NO KEY UPDATE`, allowing legacy cable-import and
admin-assignment foreign-key checks without reversing their lock order.
Automatic scans use a cursor to visit projects beyond the first five; confirming
shared locations or changing settings/inputs produces new proposals rather than
changing cable values.

The final increment adds original ordered lookup and Reverse as a queued
diagnostic job, sharing the same serial engine worker. Diagnostic lookup creates
no Apply proposal and invents no equipment approaches/design allowance. Its HTTP
and SQL controls passed on the final rebuilt candidate. Explicit manual Calculate
can force a retry after failure; automatic requests deduplicate. The latest
cancelled calculation holds automatic scanning until an explicit Calculate resumes
it, rather than falling back to an older completed job.

## Actual verification

* Production Node/C# client plus registry tests: **34/34 PASS** on 18 October 2026.
  [Current-source receipt](evidence/pf5/engine-registry-20261018T022600Z.json).
  This comprises 20 matching/hierarchy/contracts tests and 14 process/dependency/
  compatibility/pagination tests. Actual private DLL tests cover 10m geometry,
  Instrumentation → Control, 18m design length, exact `1e-28` decimal output,
  controlled failures, cross-project rejection, deadline, owned-child cancellation,
  original ordered lookup and exact Reverse points. The six-project cursor test
  verifies progress past the first page. This does not prove full-plant capacity.
* Server TypeScript: **PASS**, exit 0.
* Actual SQL/HTTP integration: **20/20 PASS**, recorded
  `2026-10-18T02:32:01.087Z`, in separately marked synthetic project
  `54cfad40-bd12-41e9-ab24-d90bdaafc993`.
  [Receipt](evidence/pf5/jobs-apply-20261018T023201Z.json) records each result.
* Verified running API image:
  `sha256:562e80739ed2c105f280a8f460ba449b26aaa6a7a63bcb9b311ff58345407a01`,
  container `e8c8a954be28f08d3c48da861e6f726a16b1c1b9270f3822c54a781661b1ad67`.
  PostgreSQL container:
  `6830635a4597dad696f1a5ced6846853cd9e1fee0f858450ad6f858e4c2e30b9`.

The 20 live controls include shared From/To identity, actual durable calculation,
settings-only exact formula reuse, cancellation, expired-lease recovery/fencing,
manual/settings/selection A→B→A invalidation and login/role denials. Additional
controls verify exact ordered lookup/Reverse without cable writes, lookup
staleness, forced retry after a seeded transient failure, cancellation intent
across a 16.4s automatic-scan window, and two-connection mixed-import/admin FK lock
orders. The body-free authorization endpoint returns 204 for the current admin,
401 for revoked login and 403 for the current non-admin role. The same run
also verifies the PF-6 transaction controls described in its report. Test fixture
users/cables/locations/jobs/uploads were removed; original synthetic settings and
model selection/health were restored. Necessary append-only audit events remain.

The earlier [16-control checkpoint](evidence/pf5/jobs-apply-20261018T020526Z.json)
remains historical evidence for its exact earlier image, not the final source.
The [first 20-control candidate](evidence/pf5/jobs-apply-20261018T022415Z.json)
also remains recorded. The final rerun binds the same compiled driver hash
`17d3fa559c337a2d6a4724c8dbd65de956edff3a4e05c7534fdb9aedc1ac2404`
to the final combined image above; the intervening overlay changed only the
frontend/rendering and did not infer a backend PASS without that rerun.

The live cancellation case observed the queued/terminal job path. The separate
Node test cancels a spawned owned process. A hard crash of an actively calculating
large model container is **not established by this receipt**; the expired-lease
control is not that test. Any subsequent recovery drill has its own evidence.

## Limits and remaining gates

Real native/converted correspondence and engineering length parity remain
**BLOCKED**. Uploaded geometry and capture claims never grant engineering
acceptance. Only the CLI-seeded, hash-bound `pf-local-straight-v1` fixture in
explicit `PF_LOCAL_DEMO=true` mode exercises accepted synthetic Apply.

Current explicit ceilings are 10,000 cables/job, 100,000 cables in the state
response, a 256MiB snapshot, a 32MiB process response and a 120s private deadline.
The Viewer shows at most 20,000 exact path points and 512 object IDs. Existing
Routings compatibility limits Apply to 8,000 routing characters/100 ordinary
segments. Larger computed results are rejected with a diagnostic, never truncated.
These are local implementation ceilings, not accepted plant-wide operating limits.

The reusable artifact cache stores fitted geometry/ports/meshes. The original
endpoint-dependent routing graph is still constructed per calculation; immutable
graph-adjacency reuse is not implemented or claimed. Full real-model completeness,
native visibility/categories, calibration, large-batch performance and real
engineering Apply remain unresolved acceptance work.
