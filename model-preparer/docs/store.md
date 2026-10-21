# Durable local store and capture

`createStore({dataDirectory, workDirectory, clock?, fault?, instanceId?, readOnly?, recoveryNonce?})` from `lib/store.mjs` provides the local persistence boundary. Construction, `init`, `list` and `read` do not import or call a provider. The original Viewer state, Stage 1 tool/package and blocked old relocation directory are never read or changed by this module.

The two explicit directories must be disjoint. Ancestors and files are checked with `lstat`/`realpath`; symlinks, junctions, special files, hardlinked files and resolving aliases are refused. Use canonical absolute paths, including long Windows paths rather than TEMP's possible 8.3 spelling. Newly created persistence/work directories use private modes where supported by the operating system.

## API

| Method | Result and requirements |
|---|---|
| `await init()` | Explicit local bootstrap or validated reopening; no network. Missing identity in a nonempty data root or missing required roots in an existing store is corruption, not a fresh store. |
| `await read(kind, key)` | A detached latest committed plain value or `null` when no value has ever committed. Every revision and high-water head is verified first. |
| `await list(kind)` | Latest values for that kind; any encountered corruption aborts the read. |
| `await withLock(kind, key, fn, {signal?, recoverDead?})` | Calls `fn(lease)` under cross-process exclusion. Busy locks fail conservatively; no age-based takeover. |
| `await write(kind, key, value, {lease, signal?})` | Commits the next immutable revision and high-water head, verifies readback, then resolves with a detached value. Exact matching active lease required. |
| `await captureSource(jobId, sourcePath, {signal?, onChunk?})` | Captures private streamed bytes under the job lock and returns `{name,bytes,sha256,snapshotPath,capturedAt}`. Call before taking an enclosing job lock; leases are not reentrant. |
| `snapshotPath(jobId, name)` | Computes the validated private snapshot path, preserving the original `.nwd` basename. |
| `await verifySnapshot(source, {signal?})` | Checks owned path, no links, stable identity/size and a fresh SHA-256 of the captured upload bytes. |

Kinds are `job`, `submission`, `target`, `cost`. Keys are canonical lowercase UUIDv4 or 64-character lowercase hexadecimal identities. The domain layer supplies validated DTOs; the store retains every previous value and rejects credential keys/signed URLs. No credentials, tokens or signed download URLs belong in records. Missing/expired cost approval cannot erase a submission ledger.

## Files and commit protocol

```text
data/
  store.json
  records/{kind}/{key}/0000000000000001.json
  records/{kind}/{key}/0000000000000002.json
  heads/{SHA256(kind,key)}.json
  locks/{SHA256(kind,key)}.lock
  locks/{SHA256(kind,key)}.publication.lock
  snapshots/{jobId}/{original-basename.nwd}
work/
  ... domain-owned staging and download checkpoints ...
```

Each immutable record has `schemaVersion=1`, kind/key, positive consecutive revision, previous hash, timestamp, value and record hash. `recordHash` is SHA-256 of canonical sorted-key JSON for the entire envelope without `recordHash`. The machine envelope schema is `schemas/store-record-v1.schema.json`; runtime additionally validates decoded duplicates, UTF-8, hashes, continuity and head agreement. Checksums detect accidental corruption and are not authentication signatures.

The first empty bootstrap owns an exclusive initialization mutex, creates required roots, syncs a private marker and atomically publishes `store.json`. Interrupted bootstrap is refused conservatively. Existing-store initialization never restores missing persistence roots. Every asynchronous public operation rechecks the marker and required roots; an initialized instance also pins the marker checksum so replacing a valid marker changes its identity and fails closed. The pure `snapshotPath` helper only computes a path. Work staging is separate from durable evidence and can be created during initialization.

A lease serializes `read current → prepare next revision → private exclusive temporary write → file fsync → atomic same-volume rename → high-water-head fsync/rename → readback`. Same-lease writes are queued, and caller data is frozen before asynchronous serialization. Committed files are never overwritten by the store; only the checked high-water head advances. Safe `.pending-UUID.tmp` files from a crash before commit are not committed state. Other unexpected files, revision gaps, missing tails, truncated JSON, duplicate keys, invalid schema/hash and record/head disagreement fail `STORE_CORRUPT` without reset, rollback to older eligibility or automatic repair.

The high-water head is outside the record directory so losing the directory or its last revision cannot silently appear to restore eligibility. Record and head are two publication steps: a crash between them yields an explicit fail-closed mismatch. This is deliberately conservative, not automatic recovery of partial commits. If all copies of the persistence evidence are externally destroyed, this file store cannot reconstruct the prior remote submission history.

`write` must be awaited before any dependent provider mutation. `fault('beforeCommit',{kind,key,revision})`, `fault('afterRecordCommit',...)` and `fault('afterCommit',...)` support crash/write-failure tests. A failure before commit leaves the last value intact. A failure between record and head publication preserves the new record and refuses all subsequent reads/writes for that inconsistent chain. A failure after commit retains the new intent even though the caller received no acknowledgement. The shared submission ledger, not a possibly lagging job projection, is authoritative for rejecting resubmission.

Records are bounded to 32 MiB, 64 JSON nesting levels and 100,000 revisions per identity. Reads use actual bounded counters. The store attempts directory fsync where supported; Windows may not expose directory flushing through Node. File fsync plus atomic publication is tested for process crash/restart. It does not promise universal host-power-loss durability or protection against a hostile process changing filesystem paths between syscalls.

## Locks and recovery

Lock records include schema, kind/key, hostname, PID, random ownership nonce and acquisition time. Every acquisition, recovery and release uses an exclusive lifecycle mutex directory. This prevents two recoverers from deleting a newly acquired lock. Release verifies nonce/PID and held-file identity; an ownership mismatch preserves the other record.

`recoverDead:true` is explicit. It requires a recognized owner on this host and an OS result proving that exact owner is absent. Live owner, permission ambiguity, foreign host, truncated/unrecognized owner or existing lifecycle mutex refuses mutation. Age alone never permits takeover; platforms without process start identity conservatively treat PID reuse as live. A lifecycle mutex abandoned by abrupt process termination requires operator inspection and is never deleted automatically.

On Linux, schema 2 owners additionally bind boot ID, PID namespace and process start ticks. Exact same-namespace PID reuse with different ticks can prove the previous process is gone; foreign namespaces remain ambiguous. Optional `instanceId` binds deployment locks to the service owner. Short exclusive publication files fence initial head/directory publication and final record/head/readback against public `read`/`list`, independently of the long job lease. Readers wait for a live publisher; a proven-dead publication owner is preserved and permits only chain validation. An inconsistent orphan remains `STORE_CORRUPT`; writes never steal publication files automatically.

`readOnly:true` is a quiescent stopped-container audit option: initialization validates existing roots without creating any directory/lock; mutations are refused. The deployment-only recovery tool uses pinned read-only snapshots and fresh Docker-daemon proof before acquiring `.docker-recovery.mutex` plus the service lifecycle mutex. Normal initialization and operations refuse that marker. The narrowly scoped helper removes only recognized locks/service ownership from the exact stopped instance, rechecking inode/device/SHA/nonce and all immutable state. It never repairs record/head mismatches or changes jobs, ledgers, snapshots and checksums. `recoveryNonce` is internal helper coordination, not a browser recovery capability. See [deployment recovery](../deployment/README.md).

Hold the relevant submission/target lease through `read → eligibility → confirmed write-ahead unknown intent → single provider submit → persisted normalized result`. Timeout, 404, pending manifest, abort, fresh cost evidence, new local job, label or output destination must not turn an existing unknown/submitted operation back into a fresh submit. Local store locking does not establish Autodesk exactly-once semantics.

## Capture and interruption

Capture reads the original file only, hashes while streaming into a private snapshot temporary file, compares original file identity/size/mtime/ctime before and after, syncs and publishes without replacing an existing job snapshot, then independently verifies its bytes. Source changes refuse the operation. Updating the original path later cannot update the captured task. Snapshot corruption refuses upload. Capture inputs must be outside persistence/work roots.

Normal failed capture removes only its own unpublished temporary file/directory. A committed snapshot or orphan left by abrupt termination is preserved for inspection; capture does not reuse a job identity to replace its contents. Stop/abort is local interruption and never claims that a remote Autodesk operation was cancelled.

The store tests use only controlled files and real child processes: live-lock refusal, dead-owner recovery, two recovering processes, crash before/after the write-ahead marker, repeated reopening, corrupt records/heads and source-change/link rejection. Test commands are `node --test test/store.test.mjs` or the project's full test command.
