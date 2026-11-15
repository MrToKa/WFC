# Read-only source catalogue snapshot into isolated PoC

`node scripts/poc/clone-materials-catalog.mjs` performs a read-only snapshot and prints
only table counts, image IDs/sizes/hashes and a catalogue digest. Add `--apply` to copy
the snapshot into the exact isolated PoC API container. No credentials are accepted as
arguments or printed; each container uses its existing environment internally.

Source is fixed to `wfc-app-backend-1`, Compose project `wfc-app`, service `backend`.
Only explicitly selected columns from all `material_trays`, their referenced
`material_load_curves`, curve points and image `template_files` are read. PostgreSQL
uses a repeatable-read read-only transaction. Numeric and timestamp values travel as
text to avoid rounding. Every referenced image is bounded, read twice and SHA-256
compared, with object metadata checked before/after each read. No source files or
tables are written and no service is stopped. This is a bounded Materials snapshot,
not a full application backup or copy of the current project.

Destination is fixed to `wfc-aalborg-poc-api-1`, with matching Compose project/service
labels, CAD/isolation flags, dedicated `wfc_poc` database and `wfc-poc-*` buckets.
Existing target UUIDs must match the snapshot exactly; mismatches are refused rather
than overwritten. Missing image objects use only deterministic PoC-owned keys and
receive full hash readback. Rows are inserted transactionally and compared after
insertion; the tray/curve FK cycle is resolved without disabling constraints. Source
UUIDs and catalogue timestamps are retained. Source account IDs/ownership, template
version history, user records, projects, sessions and original credentials are omitted.
Template ownership is explicitly null through the target schema default.

Reruns of the same snapshot reuse matching rows/objects. A changed source snapshot is
refused when target UUIDs already contain different values. This avoids overwriting
subsequent PoC edits. Failed target DB transactions attempt removal only of image keys
created by that invocation. No existing source or target object is removed.

Run guard tests with `node --test scripts/poc/clone-materials-catalog.test.mjs`.
Successful execution evidence and counts belong in the current acceptance report;
authored code alone does not imply that a snapshot was applied.

## Executed 2026-11-10

Guard tests: 3/3 PASS. Source read-only snapshot, first guarded apply and an immediate
second idempotence apply all passed for digest
`cadaa19851553057e4bd23b2864a932e618e9875773797006cbe61b6a008aecb`.

| Table | Source snapshot / target verified | First inserted | Rerun inserted |
| --- | ---: | ---: | ---: |
| material_trays | 48 | 48 | 0 |
| material_load_curves | 5 | 5 | 0 |
| material_load_curve_points | 1254 | 1254 | 0 |
| template_files | 4 | 4 | 0 |

Four image objects (729085 bytes) passed source double-read SHA checks and target
SHA readback; rerun uploaded no objects. Target read-only confirmation found 48 linked
canonical straight components, zero image records retaining an uploader ID, and only
the single independently registered PoC user. No source user records were copied.
