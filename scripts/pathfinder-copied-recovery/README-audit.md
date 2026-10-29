# Lossless copied-project recovery audit

`audit.mjs` captures the owned source5191 or its separately restored target5192.
The parent performs live execution after frozen source review. The helper imports
`pg`, `pg-connection-string` and `minio` directly in the already-owned API container;
it imports no application bootstrap and performs no SQL, storage or container
mutation. The shared `binding.mjs` guard belongs to the parent.

## Captured scope

The snapshot contains **27 entire tables**, preserving each PostgreSQL
`to_jsonb(row)::text` value and a deterministic primary-key projection:

- Four core tables: projects, cable types, cables and model selections.
- Seven model-registry tables: package identities, validation reports, imports,
  versions, reservations, aliases and storage ownership.
- Sixteen Path Finder tables: project state, locations, aliases, artifacts, model
  objects, bindings, matches, events, jobs, job items, proposals, lookup results,
  synthetic projects/proofs, reviews and Apply receipts.

The two Viewer authentication tables are captured separately. The three owned
storage buckets are listed with key, size, opaque ETag, last-modified timestamp
and user metadata, using `statObject` for each listed object. This is **metadata
proof only**. Raw model/artifact SHA readback is a separate backup/restore gate;
this audit does not claim it from an ETag or metadata match.

SQL uses one REPEATABLE READ READ ONLY transaction, verifies the exact owned SQL
address/database, and records numeric/BIGINT precision witnesses. Comparisons use
the original row strings. A syntax check may parse a row but never replaces those
strings with decoded JavaScript values. PostgreSQL COLLATE C and validation both
use UTF8 byte order, including supplementary Unicode characters.

The copied project/model/fingerprint,2140cables/50types, selectionrevision1 and
absence of its synthetic marker are checked. Global active Path Finder jobs and
model imports must both be zero before SQL capture and after storage listing.
The metadata scan and SQL transaction are separate observations, so this is not
an atomic cross-service backup. The controlled cold backup supplies that separate
operational boundary.

## Commands and policies

Capture a fresh source baseline after closing browser renewers and preparing the
normal source auth capsule:

```powershell
node scripts/pathfinder-copied-recovery/audit.mjs `
  --runtime pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600 `
  --kind source --owner 8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46 `
  --phase source-before
```

The output identifies a compact public PASS/FAIL receipt. Its SHA and raw snapshot
reference are needed for a later comparison:

```powershell
node scripts/pathfinder-copied-recovery/audit.mjs `
  --runtime <recorded-owned-runtime> --kind <source-or-target> `
  --owner <exact-owner> --phase <recorded-phase> `
  --backup-id <required-for-target> `
  --baseline <absolute-PASS-audit-receipt> `
  --baseline-sha256 <observed-raw-receipt-SHA256> `
  --comparison <exact-or-restore-fence-or-owned-auth-or-business-only>
```

Omit `--backup-id` for the source. A target must be the new owned5192 fixture,
with the exact verified restore backup UUID and images. Source owner/path/project/
port and reused container identities cannot be passed as a target.

The four explicit comparison policies are:

- `exact`: all27tables, both auth tables and all bucket metadata must be exact.
  Source container identities/images remain fixed; authorized cold-backup
  start-time changes are recorded and allowed.
- `restore-fence`: source→fresh target, before new login. All27tables/storage
  remain exact. Every old auth row remains present. Previously revoked rows must
  be byte-exact; previously active rows may change only `revoked_at` and resource
  `revoke_reason='logout'`. No hash, identity, expiry rewrite or added row passes.
- `owned-auth`: same targetT0→T1 after the one normal fresh REST login/session.
  All old auth rows remain byte-exact, and exactly one new login and session must
  match the independently SHA-pinned safe metadata file supplied by the auth
  helper. Add `--allowed-auth-file <private-allowed-auth.private.json>` and
  `--allowed-auth-sha256 <observed-SHA256>`. Its exact whitelist contains only
  target owner/runtime/project/port/backup UUID; actor/login/session/load/project/
  model UUIDs; login/session/absolute expiry; and the session secret's SHA256.
  Cookie, bearer and unrecognized fields are rejected. New rows must match these
  IDs, links, expiries and hash and remain nonrevoked. Timestamp comparison
  normalizes timezone notation while preserving PostgreSQL microseconds.
- `business-only`: after the browser demonstration, all27tables/storage are
  compared. Auth differences are retained privately and summarized, with
  **authentication explicitly NOT_CHECKED**. It does not replace the prior
  restore-fence or owned-auth gate.

A capture without a baseline reports `operation:'capture_only'`; a comparison
reports `capture_and_compare`. A successful capture is not itself restore or
authentication acceptance.

## Durability, privacy and limits

Each invocation creates a fresh private owner-marked scratch directory. Full raw
returned bytes are fsynced, read back and hashed **before** transport/status/schema
assertions. Comparison inputs and complete differences are saved before checking
their PASS/FAIL classification. Failures retain whatever raw/helper phase data
was returned and a public sanitized error/ref; there is no automatic retry,
retirement, deletion or cleanup action.

Public evidence contains counts/hashes and target identities, not business rows,
auth rows, cookies, credentials or tokens. Private output uses restrictive mode
and an inherited Windows ACL; plans and source data are never edited. Source
module hashes are checked at the start and end of the invocation.

Limits are100000rows per table,300000rows combined,4MiB per row,
20000objects per bucket/30000combined,64MiB raw output and128MiB differences.
SQL counts/aggregate bytes are checked before fetching full groups. Metadata and
SQL share the fixed120second helper watchdog, installed before stdin/imports;
the host Docker child is130seconds and the full audit300seconds. Individual
storage calls share that hard watchdog rather than claiming a per-call socket
timeout unsupported by the pinned MinIO request-options whitelist. A deadline
can leave a truncated raw helper response; it is retained and classified FAIL,
never interpreted as a complete snapshot.

## Focused controls

```powershell
node --test --test-reporter=tap scripts/pathfinder-copied-recovery/audit-lib.test.mjs
node --check scripts/pathfinder-copied-recovery/audit.mjs
node --check scripts/pathfinder-copied-recovery/audit-lib.mjs
```

Controls use synthetic snapshots and a real bounded host child kept waiting on
stdin. They cover lossless decimal/BIGINT differences, table/schema/quiescence/
resource limits, source/target separation, Unicode ordering, tombstones, exact
fresh auth metadata and explicit post-UI auth limitations. The implementation
owner runs no live SQL, Docker, HTTP or restore action. Live source/target checks,
raw SHA inventory, browser proof and target retirement are separate parent-run
evidence. No native/engineering acceptance is granted by this audit.
