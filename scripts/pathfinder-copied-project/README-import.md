# Protected model import for the copied engineering project

These additive tools import the retained Aalborg package into the **new project
identified by the persisted seed plan**, using the normal protected model-import
and active-model HTTP contracts. The fixed target is the owned port5191 stack
and its recorded API/web images. The parent agent performs actual execution after
source review. Unit controls use synthetic data and mocked HTTP; they do not import
a model or provide engineering acceptance.

## Inputs and durable state

- Supply the private `seed-plan.v1` file and the PASS `seed-receipt.v1`, each with
  its independently observed raw SHA256. The receipt must bind the plan, original
  retained input/source receipt, new project and exact50types/2140cables.
- The original retained ZIP is read at
  `pathfinder-engine/.scratch/pathfinder-local/aalborg-portable.zip`. Its pinned
  439112840bytes/hash, complete verified manifest/fingerprint and five original
  property resource pins are checked before any HTTP mutation. The verifier uses
  the existing package implementation and its600second budget.
- Choose one fresh ignored directory named
  `pathfinder-engine/.scratch/copied-import-<UUID>`. It receives a private owner
  marker, immutable intent and idempotency UUID **before login or upload**.
  Append-only private events are fsynced, read back and chained by SHA256.
  The public receipt contains identities/counts/hashes and journal references.
  It excludes business rows, credentials and tokens.
- The existing generated administrator credentials are read only from this
  runtime's `demo.private.json`; login must return the explicitly supplied admin
  UUID with the current admin role. The destination comes from the seed plan.

Example invocation, with values copied from the actual verified seed delivery:

```powershell
node scripts/pathfinder-copied-project/import.mjs `
  --runtime pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600 `
  --owner 8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46 `
  --plan <absolute-private-plan-path> `
  --plan-sha256 <observed-plan-sha256> `
  --seed-receipt <absolute-PASS-seed-receipt-path> `
  --seed-receipt-sha256 <observed-seed-receipt-sha256> `
  --admin-id <existing-generated-local-admin-UUID> `
  --work-root <absolute-fresh-copied-import-UUID-directory> `
  --inspect-only
```

The optional `--inspect-only` verifies host inputs and the owned Docker binding,
then persists the intent. It performs no HTTP or SQL requests. Remove that flag
and reuse the **same work directory and all the same pins** for normal execution.
No build or container lifecycle operation is performed by this tool.

## Import and selection guarantees

Every mutation is preceded by the exact owned container/image/network/storage
and SQL-endpoint binding checks. Read-only SQL uses a fresh `pg` connection in
the existing owned API container, with parameterized project queries, a
REPEATABLE READ READ ONLY transaction, statement timeouts and a child watchdog
installed before stdin or imports. It imports no application/database bootstrap.

The tool checks the exact copied-project marker, Details values,50types and
2140cables, and refuses a synthetic engineering marker. First upload requires
an empty new-project registry and null selection at revision0. The normal POST
carries the persisted idempotency UUID, archive hash and exact byte length.

Accepted job state and raw non-login HTTP replies are saved privately before
assertions. A lost response is reconciled by the same new-project/actor/key in
the read-only registry projection. Once an upload might have started, subsequent
invocations never automatically upload again. A missing row at that point is
`IMPORT_UNCERTAIN_ACCEPTANCE`; retain the directory and investigate or rerun
read-only reconciliation later with the same directory. A failed job remains
failed. The tool neither deletes imports nor creates a replacement key.

Completion requires one new same-project version, import, alias, published
storage-ownership prefix and validation report, with no outstanding reservation.
The full manifest resources and every verified hash, all six validation checks,
fingerprint/source identity and storage readback counts/bytes must agree.
An already-existing global package identity is compatible with this flow.

Selection uses the normal PATCH contract with `expectedSelectionRevision:0`.
Readback of this exact model at revision1 is checked before any PATCH attempt,
so resumed success does not increment the revision. Uncertain PATCH responses
are read back; unchanged/competing selections are retained for reconciliation
instead of being overwritten or automatically patched again. Resource checks
also run in the normal server selection path.

## Bounds and recovery limits

JSON files are limited to4MiB, HTTP/child output to2MiB, scoped registry queries
to fewer than5rows per registry group, and the private journal to4096events or
128MiB. HTTP metadata requests have30second timeouts, upload15minutes, the
overall invocation30minutes, and polling1800iterations at a minimum500ms wait.
The read-only child watchdog is30seconds and the host Docker child35seconds.
These bounds can stop an invocation while the server still owns an accepted
operation; the persisted key and journal remain the reconciliation authority.

An exclusive local run lock is acquired before resume history is loaded.
Normal exit removes only that exact owned lock file. A hard process crash can
leave the lock behind; establish that its recorded process has ended and retain
the journal before resolving that lock. There is no automatic stale-lock bypass,
new-key retry, generic cleanup or container operation.

The private journal and compact PASS/FAIL receipts are retained on failure.
Host filesystem durability depends on the available filesystem; file fsync and
readback are performed. No guarantee against concurrent external edits beyond
the checked target/normal server contracts is claimed.

## Focused checks

```powershell
node --test --test-reporter=tap scripts/pathfinder-copied-project/import-lib.test.mjs
node --check scripts/pathfinder-copied-project/import.mjs
node --check scripts/pathfinder-copied-project/import-lib.mjs
```

Controls cover source/seed/ZIP/resource links, precision-preserving allowances,
target and admin refusal, uncertain upload/selection recovery, no repeated CAS,
foreign jobs, resource/report/storage contradictions, failure journaling,
deadline/cancellation, response limits, archive-reader cleanup and an actual host
watchdog with stdin kept open. A tiny explicitly synthetic journal fixture stays
under a fresh ignored scratch directory for inspectable resume-order evidence.
Test-only pin overrides and shortened watchdog intervals are function-level seams;
the CLI has no option to bypass its fixed source or target pins.

Actual import, existing-row/bucket preservation, browser operation and engineering
review are separate parent-executed checks. This tool does not set bindings,
calculate/apply cable lengths, modify QA/source projects, or mark engineering
acceptance.
