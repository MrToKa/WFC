# SP-1 — offline source seed and qualified recovery contract

This is the source-backed implementation contract, not an executed backup or
restore receipt. Root is the sole actual executor. Stock operations v1 stays
unchanged; new SP-1 qualification is additive and cannot be inferred from a v1
businessSha256/registrySha256 match.

Source implementation checkpoint: `scripts/preparer-main/offline-seed.mjs` and
its focused tests are authored, with no agent execution or actual seed capture.
Root's copied foundation has a separate closed
`preparer-offline-seed-posix` capability profile; original generic/PF files are
unchanged. The approved intent additionally requires each role's networksSha256,
computed from exported networkAttachmentIdentity: attachment names/NetworkID and
configuration are pinned, excluding only endpoint allocation observations. A
source-wide main5180-offline-seed.lock serializes distinct operation UUIDs; failed
or uncertain attempts retain it for explicit reconciliation. Successful source
restoration and proof checks precede lock release and the final complete marker.
Final source fixes/tests remain **NOT_RUN**, pending root review/execution. Main
5180 has not been changed by this implementation. The user's reported5191 cable
workflow regression takes priority before any SP-1 runtime work.

## Exact source and first boundary

The authorized source is MAIN WFC on loopback5180, not PF5191 or a default full
stack. `docker-compose.app.yml` declares wfc-app backend/frontend on external
wfc-app_application, with external DATABASE_URL/MinIO and one model-imports
staging mount. Source configuration alone does not identify the live database.

Root's read-only discovery is retained privately at
`.preparer-work/sp1-discovery-450ef72a-ee83-4cf7-99c7-648811c3a8b6`. It found main
API f65cc58e restarting, frontend1d5592c1 unhealthy on5180; configured
host.docker.internal:5434/wfc_app resolves to the exact stopped wfc_app PostgreSQL
container2f1d30dd, image9a2e, anonymous volume8d141… at/var/lib/postgresql. MinIO
host9000 resolves to running wfc-minio6ad45a, image14ce, with the original
.data/minio bind. Full IDs/configuration remain in the private discovery; these
short identifiers are explanatory, never sufficient operation authority.

**Do not start the original PostgreSQL container to obtain a backup.** First pin
the complete actual source scope: container/image IDs, role labels, endpoints,
database, full mount identities, network configuration, restart/running states,
private environment/configuration, helper image, source closure and destinations.
Refresh these facts before mutation. Refuse ambiguous roles, unknown writers,
additional mounts, unsupported links/tablespaces or resources outside the pinned
scope. No blind pg_terminate_backend, cancellation, credential rewrite or repairs.

## Ordered execution

1. Create a new private operation with immutable BEGIN/failure records, positive
   free-space bounds, source/configuration pins and separate secret companion.
   Serialize all source actions. Stop only the approved main API/web writers and
   any other explicitly declared writers; prove absence of foreign writable
   mounts and clients. Preserve original running/stopped and restart settings.
2. While original PostgreSQL remains stopped, mount its exact volume read-only
   into the bounded pinned helper and capture a complete physical seed. Include
   file content SHA, mode/uid/gid/timestamps, archive hash and full verification.
   Do not weaken existing archive rejection of links/special files/hard links.
   Record absent/foreign writer and before/after source identity observations.
3. With applications stopped, stop exact source MinIO and capture its complete
   data bind plus complete staging mount. Export ID-only API/web/PostgreSQL/MinIO
   and helper images; verify archive envelopes. Preserve all buckets, models,
   original ZIP objects, pending upload metadata and orphan objects. Keep source
   config/keys only in a separately pinned private companion outside Git.
4. Complete and verify the cold seed before any recovery startup. Restore source
   MinIO/API/web only to their recorded prior states; original PostgreSQL stays
   stopped. Record the pre-existing unhealthy/restarting state honestly; backup
   does not claim to repair it. Resume failure is explicit, never hidden by PASS.
5. Restore the physical seed into a NEW owned PostgreSQL volume and the same
   exact PostgreSQL image, with isolated network, no published DB port and no
   app/worker/schema initializer. Verify exact restored seed before startup.
   Recovery writes happen only in this clone. Pin its operation/owner/resources;
   never describe post-start physical bytes as identical to the cold seed.
6. From the recovered clone, capture a logical custom dump plus all-public raw
   inventory/global SQL metadata. Record seed hash → clone identity/startup →
   logical dump/capture hashes. Derive full read-only model/ZIP audit using owned
   cloned MinIO and staging where needed; source storage stays unchanged.
7. Restore that dump and cold storage to a second fresh owned quarantine fixture
   using exact old images. Before auth fencing, prove raw rows/keys/catalog and
   supported global metadata exact to the recovered-clone baseline. Then rotate
   restored JWT and apply only declared viewer-binding fences; prove exact
   approved deltas. No API/web startup is required for SP-1 recovery proof.
   Later migration/startup qualification remains a separate gate before5180 update.
8. Retain cold seed, derived logical backup, every raw capture, images and private
   companion. Cleanup is only by verified fresh ownership. Recheck source resource
   identities and original PostgreSQL stopped state. New/unknown failures require
   a new operation or explicit reconciliation, never synthetic PASS/retry.

## Minimal reusable leaves and new seams

Reuse the existing Preparer workspace low-level modules directly:

- `scripts/operations/docker.mjs`: createDocker, environment, dataMount,
  publicContainer and writePrivateJson. Bound command time/output and revalidate
  exact source/target ownership in the SP-1 caller.
- `scripts/operations/archives.mjs`: assertCanonicalPath, measureDirectory,
  captureArchive, verifyArchive, restoreArchive and hashFile. Capture/restore
  preserves uid/gid/mode and verifies raw hashes; source mounts stay read-only.
- `scripts/operations/manifest.mjs`: recordFile, writeJsonNew, validateImage and
  verifyImageArchive. Do not pass a physical seed off as stock v1 format/profile.
- `scripts/operations/wfc-ops.mjs`: discoverSource/assertEndpointBinding are
  discovery foundations only. Stock backup107–116 requires a running source DB;
  stock fenceDatabaseClients36 terminates unknown clients; neither is the SP-1
  offline recovery path. Stock restore183–191 performs legacy inventory and
  health-writing model audit before automatic startup, so do not invoke it as
  the new quarantine qualifier.

Use a small namespaced SP-1 operator with explicit phases, immutable source pins
and dependency-injected Docker for source-only tests. Suggested adapter boundary:

`captureOfflineSeed(scope, destination, privateCompanion, {docker, signal})`
returns only a fully verified physical/storage/image receipt. Then
`qualifyRecoveredSeed(seedReceipt, freshTarget, {docker, capture, audit, compare,
signal})` returns linked recovered-clone and logical-restore proof. Fresh target
creation, stopped-source/unknown-writer checks and startup exclusion are mandatory
caller invariants, not optional hook behavior. No main/PF port or credential
fallback is allowed. Keep the two receipt kinds distinct and strictly bind their
file hashes, source identity, operation and helper closure.

The reusable PF implementations are three standalone leaves, copied with exact
source provenance and focused tests, rather than importing the PF runtime:

- `server/operations/losslessInventory.ts`: captureLosslessInventory(pool,
  {allowedRoot,directory,ownerId,inventoryId?,signal?,limits?}); pg type import and
  Node built-ins only. Cursor output stores to_jsonb(t)::text without decoding
  business numbers, exact lexical keys, per-file/catalog hashes and bounded
  read-only transactions. Limits can tighten, never silently expand.
- `scripts/pathfinder-copied-recovery/current-inventory-lib.mjs`:
  compareCurrentInventories(beforeDirectory,afterDirectory,{comparison,
  beforeOwnerId,afterOwnerId,targetId?,signal,limits?}); built-ins only. Reuse
  exact and explicit restore-fencing modes, with complete raw-file verification.
- `scripts/pathfinder-barriers/global-sql-v2.mjs`:
  capturePublicGlobals(pool,{signal}) owns its own read-only transaction; pass a
  Pool, not an already-begun client. Capture/compare public namespace, routines,
  views, relations, ACLs/owners, sequence state and pg_depend/identity ownership,
  extensions and unsupported objects. Reject unsupported facts; role memberships
  and cluster-role recovery are separate, unproven scope.

Do not transplant PF runtime-lib, raw-inventory-provider or B9 operator: they
import PF state, ports, topology and control policy. A new tiny capture helper
should pin these leaves, verify current_database and zero other DB clients before
and after each capture, use the clone connection only, write new private files
and emit compact hashes/counts. Both capture functions acquire their own pool
transaction; no nested BEGIN. Stock --no-owner/--no-acl logical restore cannot
prove arbitrary owner/ACL equivalence: compare real facts and refuse mismatches;
retain the exact physical seed rather than normalizing evidence to fit.

## Read-only models and original ZIP audit

Create a separate audit module/command, without app/db initializer imports.
`server/operations/service.ts` auditModels53–84 writes health at75/79 and excludes
health from its immutable comparison; it cannot be used for source proof.

The new auditor uses a READ ONLY transaction, exact immutable raw inventory
bookends and the existing storage reader only. Verify every ready model's declared
resource count/bytes/prefix and full raw readVerifiedResource SHA/size; close every
handle. Never call initialize, setHealth, recover, publish or cleanup. Return
observed integrity status without modifying stored health.

If model_package_archives exists, verify every published retained archive and
its exact import/project/model/prefix/byte/SHA provenance using
ModelStorage.readVerifiedArchive(prefix,{bytes,sha256},signal), then close the
pinned handle. Table absence is an explicit legacy-schema fact; do not migrate it
just to audit. Pending/unpublished/cleaned records need honest separate status,
not invented ZIP availability. Full MinIO seed still preserves all raw objects.
Archive storage/schema seams already exist in modelRegistry/storage.ts50–54,
435–437; repository.ts60–78,359–375; types.ts125; schema.ts151–166,244–245.

## Completion evidence

SP-1 requires actual root receipts for exact cold seed restoration, clone recovery
and linked logical restore; raw precision/key/schema/global/sequence checks;
read-only model plus ZIP audit; fencing-only deltas; secret companion/image
readback; unknown-writer refusal; positively scoped cleanup and source state
conservation. Test bigint/floating lexical values, view/sequence/ACL drift,
nonempty or foreign target, stopped-source guard, failing model/ZIP reads and
source/client races. Historical PF checks are reusable design evidence, not new
main5180 PASS. No5180 update, credential setup or fresh Autodesk submission is
authorized by a merely generated backup contract.
