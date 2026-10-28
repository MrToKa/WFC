# Copied engineering input seed

This additive local tool creates a distinct review project from the already
retained HPU Aalborg input snapshot. It never queries the original application,
imports application bootstrap modules, marks a synthetic project, imports a model,
creates locations/bindings or performs engineering Review/Apply.

The four owned files are `seed.mjs`, `seed-lib.mjs`, `seed-lib.test.mjs` and this
README. The normal model importer has separate ownership and consumes the immutable
plan and a successful seed receipt.

## Commands and private state

Run from the isolated repository root. All paths below are absolute on the host.
Only the parent executor runs these commands after source review and release.

```powershell
node scripts/pathfinder-copied-project/seed.mjs plan --work-root C:/Users/todor.chankov/source/WFC-pathfinder-local/pathfinder-engine/.scratch/copied-project-seed-<fresh-id>
node scripts/pathfinder-copied-project/seed.mjs apply --plan <absolute-plan.private.json> --plan-sha256 <exact-plan-SHA256>
node scripts/pathfinder-copied-project/seed.mjs verify --plan <same-absolute-plan.private.json> --plan-sha256 <same-plan-SHA256>
```

`plan` creates a new directory exclusively, checks the exact retained source bytes,
receipt/model/resource linkage and the owned 5191 target, then writes an immutable
`plan.private.json`. Its public status is **PLAN_READY**, which does not prove a
seed and cannot authorize model import. The plan contains source-to-new UUID maps
and copied cable inputs; it stays in ignored scratch and must not be committed.

`apply` uses one SERIALIZABLE transaction and a nonwaiting project advisory lock.
It inserts one new project, 50 minimal cable types and 2,140 cables in batches of
at most 500. Existing complete initial seed state returns `already_seeded` without
inserts. Partial, changed, foreign or colliding state is refused; there are no
upserts or updates. PostgreSQL's own `lower(name)` detects type-name collisions.
Source type identities are never merged or supplied with invented catalog facts.

`verify` uses REPEATABLE READ READ ONLY and never inserts or acquires row locks.
It is an **initial-seed-only** recovery check: selection and registry must remain
zero, with no model, locations or jobs yet. After normal model import or UI use it
intentionally refuses that changed initial workflow state. It is not the later
end-to-end source-fidelity/preservation audit.

Every run gets a separate private subdirectory. Exact raw helper output and
transport flags are saved before success assertions; compact public receipts go
under `docs/pathfinder/evidence/copied-project/`. A timeout, lost COMMIT response,
output overflow or connection-close error is retained as a failure/uncertain
operation. Investigate and explicitly verify the same plan; do not generate new
IDs or blindly retry a write. A confirmed commit with failed connection teardown
is still reported as a failure requiring reconciliation.

## Fidelity and isolation

The source snapshot and final source receipt have fixed SHA256 pins in the library.
Their exact observed project/model/five-resource provenance is validated using the
existing pure retained-source validator. No original credentials or runtime calls
are used by that validator. No source business rows or UUID maps are public files.

The new project has a distinct `PF-COPY-…` number, a clear English copy label and
an exact review description marker. Source S/E/P remain decimal strings through
parameterized NUMERIC inserts and `::text` readback. A missing end allowance or
percentage is refused; a NULL secondary length stays NULL. The approved local
connection gap is explicitly `1`. No QA/default allowance is substituted.

Cable number, raw tag, From/To, MTO and engineering revision are copied exactly.
Instrumentation remains its raw category; existing product rules map it to Control.
New routing/design/install fields are explicitly NULL because those original
values were not copied. New timestamps/material flags use fresh-row semantics.
The existing server trigger owns `cable_write_revision=0`. The project's existing
triggers create its empty model selection and Path Finder registry state.

Target guards require the exact handoff owner/project/5191/API/web/PG images,
private backend network, isolated volume mounts and loopback web port. Docker
inspection uses closed nonsecret projections. The credential URI is parsed only
inside the owned API container and never returned; host/database/user/port are
fixed, and SQL server identity is checked before business statements. The helper
clears only its process's NODE_OPTIONS, uses a 256MiB V8 heap, 5s connect/8s SQL/
3s lock/10s query limits, a referenced 55s whole-helper watchdog and 60s host bound.
Host stdout is capped at 16MiB and stderr at 32KiB; input/plan are capped at 2MiB.

The tool verifies only the planned new rows and initial workflow state. The parent
must independently preserve all pre-existing rows with the lossless V2 comparison
(`--allow-new`) and verify exact expected additions, model/storage ownership and
original/5190 preservation. These tool controls are not native parity, full-model
coverage or engineering acceptance.

## Focused controls

```powershell
node --test --test-reporter=tap scripts/pathfinder-copied-project/seed-lib.test.mjs
node --check scripts/pathfinder-copied-project/seed.mjs
node --check scripts/pathfinder-copied-project/seed-lib.mjs
node --check scripts/pathfinder-copied-project/seed-lib.test.mjs
```

Tests use synthetic in-memory business records and a fake raw Client to exercise
fidelity, ownership, transaction/refusal and recovery paths. One read-only test
validates the retained actual input/receipt hashes; it performs no database or
runtime operations. The watchdog control executes the fixed generated helper with
a test-only shortened interval and blocked stdin, without importing pg. Actual
PostgreSQL inserts and normal import are separately executed and recorded by the
parent; passing host controls must not be presented as those actual checks.
