# PF-R0 stage report

Status: **TECHNICALLY COMPLETE / PASS for R0 contracts and evidence**.
Future implementation checks and human engineering acceptance remain NOT_RUN.
Local worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
`pf-r0-purpose-contracts-local-20261019`, inherited implementation/planning
revision `916256f0da14b8f21ca039b34bfae2de33b2bb0d`.

The user's 19 October instruction explicitly authorizes sequential implementation
and a detailed next-stage prompt followed by immediate execution. App heartbeat
`path-finder-purpose-rules-and-model-revisions` is ACTIVE every ten minutes;
the prior deleted `pathfinder` automation is not revived. No publication or
original-installation update is authorized.

## Deliveries

The [R0 overview](34-r0-contracts.md) joins separate private lossless catalog
copy and public normalized routing/drawing views. Three synthetic example files
cover catalog, policy/drawing and geometry/revision contracts. Proposed transport,
identity, decimal, frame, partial/aggregate, staleness and Apply boundaries are
explicit, rather than represented as already implemented endpoints.

[Capacity and catalog audit](r0/capacity-and-catalog.md) separates current
code limits from proposed future measurements. [Validation matrix](r0/validation-matrix.md)
defines observable criteria for all remaining PF-R stages and user acceptance.

Source review exposed and resolved the following design gaps before code work:

- The copied 50 cable types are minimal, without drawing purpose/diameter. R1
  includes required type/material/support/grounding/report dependencies.
- Private lossless copy and public normalized catalog originally had conflicting
  shapes. They now have distinct schemas and an explicit server-owned projection.
- Exact currently authorized idempotent replay returns its historical receipt
  before CAS for new commands; stale new commands still conflict.
- Routing-only catalog revision/digest are separated from drawing facts and full
  audit hashes, including transitive preparation/proposal hashes.
- Legacy grounding-on-right is preserved; explicit MV side override includes
  grounding with clear UI help and a separate compatible packing family.
- Canonical coordinate/alignment definitions must be immutable; changing their
  meaning requires a new identity/revision and invalidates dependent preparation.

## Actual evidence

| Evidence | Scope and result |
| --- | --- |
| [Local repository baseline](r0/evidence/local-baseline.json) | Read-only branches/HEAD/status/cache observations. Original WFC and canonical PathFinder clean; old dirty checkout retained. |
| [Live remote observations](r0/evidence/remote-observations.json) | Configured connector GET: WFC main `e1ef202`, PF master `45c24bf`; no candidate PR. Candidate CI/review NOT_ESTABLISHED. |
| [Fresh local catalog counts](r0/evidence/catalog-counts.json) | Guarded owned 5191, REPEATABLE READ READ ONLY, exact DB/model/project: 0 trays, 0 report mappings, 2140 cables, 50 types; all 50 purpose/diameter null; 0 active jobs. PASS for counts only. |
| [Reference lock](r0/reference-lock.json) | Actual content hashes: 24 files, 11 unchanged pure Core files, locked 43-case historical corpus. PASS for integrity; 105/43 are not new test executions. |
| [Both model inputs](r0/evidence/model-inputs.json) | Actual stable file SHA/size checks bind current 439112840-byte and older 174823508-byte converted packages to prior independent verification. PASS for input integrity only. |
| [Document validation](r0/evidence/document-validation-1792359163929.json) | 12/12 scoped checks PASS; 29 unique proposed policy cases, 24 locked files/11 Core, 54 local links/0 missing, 0 known secret-value matches. No production validation is inferred. |
| [Independent contract review](r0/evidence/source-contract-review.json) | Five pinned contract/example files; four material findings closed. Overview status-only delta verified against reviewed bytes. No reviewer runtime/test claim. |

Independent source/contract review closed the catalog, replay, transitive hash
and immutable-frame findings. All remaining criteria have explicit owners and
observable gates; no unresolved contract decision prevents R1. Final Git scope
and whitespace are checked before the local commit.

No application/UI/engine regression test is claimed for this documentation stage.
The new synthetic expected cases are proposed behavior, not executed production
validation or newly generated mathematical expected outputs. Native oracle is
user-waived, not silently counted as PASS. Old/new alignment, qualified identity,
actual geometry/purpose/movement comparison and engineering acceptance remain
NOT_RUN, with concrete owners/criteria in R4–R10.

## Isolation and cleanup

Only docs/pathfinder deliveries are changed. No new container, installation,
image build, application schema/business-data mutation, model import/selection,
original checkout modification or original runtime restart. The only SQL was a
guarded read-only count query in the already-owned 5191 installation. No secret
or business-row dump is added to Git.

Keep the two verified packages, source snapshot, needed private provenance and
5191 demonstration. All seven historically denied scratch children/parents remain
untouched, without retry or prune. This stage created no disposable container.

## Next authorized step

After final R0 checks and local commit, create a detailed PF-R1 handoff using
prepare-stage-handoff with the actual revision and the fresh dependency findings.
Create a new inheriting local branch and immediately implement exact tray/type/
material/dependency copying into the isolated project. Original reads must be
bounded and read-only; original writes remain prohibited. Do not repeat model
seed, import or Autodesk conversion.
