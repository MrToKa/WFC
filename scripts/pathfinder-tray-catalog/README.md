# Isolated project tray catalog transfer (PF-R1)

This operator copies the already selected original project's tray catalog and
its required drawing/report dependencies into the existing owned 5191 copy.
It never starts or updates the original application. It is not a model import,
Path Finder calculation, location mapping or engineering Apply operation.

Original project: `0c0007c9-d73f-4d13-bc87-601c544727b7`.
Owned target: `1af0f807-7653-40ea-8391-7eea6c54e7d4`, owner
`8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, port5191.
The original checkout, containers, database and object storage are read only.
The target's existing cables, model selection and Path Finder records are
preserved. Four initially NULL project drawing preferences are copied through
raw PostgreSQL values under full-row CAS: support distance/weight, load safety
factor and existing cable layout settings. Other project fields remain exact.
The initial 50 minimal cable types are enriched through their retained
source-to-local map and exact expected-state checks; they are not replaced.

## Modules and trust boundaries

- `source-lib.mjs`: closed 19-table dependency projection through raw PostgreSQL,
  read-only repeatable-read transactions, exact source identity and bounded output.
  NUMERIC/BIGINT values travel as text in unchanged PostgreSQL row strings.
- `transfer-lib.mjs`: immutable UUID/FK plan, exact global reuse or conflict,
  expected-state enrichment and one bounded serializable target transaction.
- `guard-io.mjs`: fixed local Docker/source/target binding, owned private work,
  durable bounded transports, original GET-only and owned object staging/readback.
- `preservation-lib.mjs`: independent full-row PostgreSQL JSONB-text audit of the
  previous 27 protected business/model/PF tables plus the catalog closure. Exact
  planned insertions/enrichments are the only accepted relational changes.

Private source rows, credentials, raw outputs, source-to-local maps and file
content stay under a newly owned ignored scratch directory. Public evidence
contains only statuses, counts, revisions, object/transport hashes and limitations.
Source credentials remain inside the original backend environment. Target
credentials remain inside the isolated backend environment. No application
bootstrap, source migration or generic prune/retirement is used.

## Verification and recovery rules

Every helper has an internal finite watchdog as well as a bounded host transport.
Raw output and transport results are durable before validation. A failed source
identity guard refuses the operation. Original queries cannot modify data.
Files use fresh owned keys; an existing mismatched object is a conflict. A lost
PUT response requires readback reconciliation of that same key and content.

The database writer checks current admin status, target ownership and exact
dependencies within its transaction. Partial or intervening edits refuse the
whole plan. A lost COMMIT acknowledgement must be reconciled against the same
immutable plan; generating replacement IDs or automatically retrying a write is
not permitted. Replaying a fully applied exact plan is idempotent.

The final report must distinguish source capture, actual copy, byte readback,
relational fidelity, preservation and computer-use inspection from engineering
acceptance. Native Navisworks parity, full-network capture, new purpose policy,
Left/Right implementation and cross-revision comparison are outside PF-R1.

## Explicit phase interface

`node scripts/pathfinder-tray-catalog/catalog.mjs <phase>` writes an immutable
public receipt and prints its path. Detailed inputs and plans are private.

| Phase | Inputs and result |
| --- | --- |
| `capture` | New owned work; source before/copy snapshots, full target DB/storage baseline. Read only. |
| `prepare` | `--work`, `--input` capture descriptor, `--sha256`, `--actor-id`; current admin/baseline checks, source bytes, new owned file staging, immutable transfer plan/prepared descriptor. |
| `resume-prepare` | `--work`, `--input` original prepare-intent, `--sha256`; explicitly reconcile the same file plan after interrupted staging. Existing mismatches refuse. |
| `recover-prepared` | Same prepare-intent pins plus `--plan-sha256`; rebind the already written plan and bytes and create only the missing local prepared descriptor, or reuse the exact existing one. No regenerated IDs. |
| `apply` | `--work`, `--input` prepared descriptor, `--sha256`; complete source/seed/file bindings and current auth, independent typed read-only preflight, one transaction, whole DB/storage/source readback. |
| `verify` | Same prepared descriptor pins; read-only same-plan reconciliation with complete independent final audit. |

An uncertain response is a stopping condition for that write invocation. Inspect
its retained raw/transport evidence and reconcile the same immutable plan; do not
rerun `capture`/`prepare` to obtain replacement IDs. The operator's `apply` means
catalog transfer only; it never calls the product's engineering Review→Apply.

Actual R1 result:330trays/51selected project types/6files transferred;
192synthetic controls and real copy/replay/verification/computer-use checks PASS.
See [stage report](../../docs/pathfinder/36-r1-stage-report.md). Do not repeat
the completed transfer in the demonstration while developing later stages.
