# Independent Preparer operations

These Node.js 24 tools operate the existing standalone Preparer. WFC does not
import, start or depend on it. Ordinary launch/stop remains
`start-preparer.ps1` / `stop-preparer.ps1`; omit `-Build` for a normal start.
They use the existing image and retain the three named volumes. Do not use
`down --volumes` as a stop command. The legacy launcher has its own protected
operator-configuration prerequisites; an offline WFC user does not need them.

## What is preserved

`ops/preparer-ops.mjs` captures a stopped, exclusive source, with an explicit
complete marker and a checksummed format-version-1 manifest:

- All bytes in data, work and outputs, across **closed, simulation and live**:
  job snapshots, committed revision chains and heads, authoritative submission
  WAL, cost reservations, checkpoints, last-good outputs, service operations and
  request history, namespace identities and the private signing key.
- Every external ZIP referenced by a job's package or last-good package. A
  `registerPackage` path under `/imports` is an external reference, not an
  implicit copy in outputs. Missing or changed references refuse capture.
- Original NWD chooser inputs when they match captured job identity and are
  locally present. Immutable private captured snapshots are always required.
  Unreferenced chooser/import catalogs are not part of this backup.
- The narrowly mounted proof directory as historical provenance, including
  expired or unknown inputs and referenced observation files. It never renews
  proof or resets allowances.
- The exact Linux image by immutable ID, OS/CPU prerequisites and an offline
  Docker-save archive without source image tags. Runtime, Package verifier and
  local SDK are in that image. The seven operator modules travel in the backup.

Stable restored paths are `/var/lib/preparer/data`, `/var/lib/preparer/work`,
`/var/lib/preparer/outputs`, `/imports`, `/sources` and `/proof`. No job IDs,
absolute ledger references or frozen provenance are rewritten.

The manifest includes sizes, SHA-256, safe deployment/mount mapping, Linux file
ownership/modes, including volume-root metadata, and a semantic audit.
`complete.json` is published last, after full payload readback. A failed
attempt remains incomplete and is refused by verify/restore. Historical backup
formats do not gain these guarantees automatically.

## Protect the operator artifacts

Use a private destination outside the checkout, public evidence and web roots.
Do not put backup blobs or real configuration in Git, public evidence or images.
On Windows the tool applies and verifies a protected DACL for the current user
and SYSTEM only, inherited by children. Unix roots use mode 0700. Node's 0600
argument alone is not a Windows confidentiality control.

Credentials are **not** captured. Retain the original authorized configuration
separately through the operator's protected delivery process. Do not print it,
inspect raw container environment, or copy it into the image. Public receipts
contain IDs, counts, paths and hashes, never secret/key bytes. Protect the whole
backup as sensitive: it contains captured sources, model bytes, provenance and
the private signing key. Restrict access to referenced external inputs during
capture; handle/stat checks detect changes but do not fence unrelated host writers.

## Back up the existing service

Run these from the Preparer checkout with Node 24 and a running Docker Desktop
Linux engine. Create the parent destination first; every attempt gets a new UUID
directory. No existing archive is overwritten.

```powershell
node .\ops\preparer-ops.mjs inventory --container routings-preparer-preparer-1
node .\ops\preparer-ops.mjs backup `
  --container routings-preparer-preparer-1 `
  --destination-root 'D:\Private Preparer Backups' --stop
```

`--stop` authorizes only the named source container's clean stop. Without it, a
running source is refused. Discovery requires the exact standalone service,
fixed hostname, valid instance label and the three owned named volumes. Unknown
mounts, shared running volume users, nonzero/forced stop and ambiguous locks
refuse backup. No global Docker stop is used. Application shutdown is given
45 seconds; a forced exit is not labelled clean.

The script audits state, checks free space, captures full payload/reference
hashes, rechecks state, exports the exact image ID and verifies all bytes before
publishing completion. Required space is the measured payload/reference bytes
plus uncompressed image size, 10% margin and 64 MiB metadata. This is a local
prerequisite, not a negotiated RPO/RTO or retention policy.

In `finally` it restarts only a source it stopped, checks the same image/instance
and waits for local service readiness. Originally stopped sources stay stopped.
The receipt records real timestamps and restart outcome. Failed restoration of
source service removes the complete marker; preserve the diagnostic directory.

## Verify and restore fresh, without the original checkout

Copy the complete private UUID directory and the separately protected operator
configuration using your authorized channel. Node 24 and compatible Docker are
host prerequisites. Image import uses IDs and refuses saved working tags. It
does not pull, install dependencies, build from Git or download SDK/models.

```powershell
$backup = 'D:\Private Preparer Backups\preparer-<backup-uuid>'
node "$backup\operator\preparer-ops.mjs" verify --backup $backup
node "$backup\operator\preparer-ops.mjs" restore `
  --backup $backup --target-root 'D:\Private Preparer Restores\drill-01' --port 18093
```

`restore` requires an absent target, a free loopback port, compatible image and
new uniquely owned volumes. It verifies every blob/tool/image, imports the
untagged image, restores into fresh volumes, checks all chains/snapshots/external
references, and runs the public full Package verifier on ready packages. It
stays in quarantine with **no application container** until every gate passes.
Failed allocations remain quarantined for inspection; they are not promoted by
the mere presence of files. There is no replacement/overwrite option.

```powershell
$target = 'D:\Private Preparer Restores\drill-01'
node "$backup\operator\preparer-ops.mjs" start --target $target
node "$backup\operator\preparer-ops.mjs" stop --target $target
```

The default restored container uses `network:none`, no published port, no APS
credential inputs and no price-proof settings. It retains the source's requested
namespace: a `live` backup remains in `live` with actual provider **closed**.
Changing to `closed` would show a different store; it does not migrate live jobs.
Startup requires actual closed readiness and zero startup cloud calls. Historical
HMAC/proof/cost/submission bytes remain intact and cannot activate this provider.

For a local UI, choose exposure **on the first start only**:

```powershell
node "$backup\operator\preparer-ops.mjs" start --target $target --expose-local
```

This binds the recorded new port on 127.0.0.1 using Docker's bridge. It is not an
OS egress sandbox, although no cloud capability/configuration is supplied. Do
not use a real source service/volume as a target. A later incompatible exposure
flag is refused instead of silently changing the existing target policy. Use
the same flag for subsequent starts. The stop command preserves all volumes.

Repeated start of the same running target checks exact owner/instance/image,
namespace, mounts, exposure policy, backup pin and closed readiness. It does not
claim a new full audit of an active writable store. A stopped target receives a
fresh full audit before restart. Original store IDs and immutable job identities
must remain; valid appended jobs and local status/history changes are allowed.
This permits normal local work followed by stop/start without resetting history.

## Crash, corruption and retention

Committed submission-unknown history is retained as unknown. A new approval,
restart or restore never makes a second submit safe. Explicit reconciliation
belongs to the core's existing provider boundary; this stage makes no APS call.

Any lock/service owner/publication mutex found during stopped audit is refused.
The tools do not steal locks by age, remove unknown owners, alter WAL JSON,
repair chains or regenerate IDs. Cross-host/namespace process death cannot be
inferred from an absent local PID. The existing source-specific
`-RecoverStoppedContainer` procedure requires its original exact stopped Docker
instance proof and is not a generic restored-volume repair. Preserve incomplete
captures and use a known coherent backup when proof is unavailable.

Retention is report-only/default retain. Keep verified backups, portable ZIP
inputs and evidence. Remove only explicitly identified own drill resources after
checking project/owner/container/volume labels and references. Do not globally
prune images/cache or retry historically blocked cleanup targets. Evidence of a
same-computer isolated restore does not prove a second physical computer.

## Bounded acceptance tools

`node --test test/ops.test.mjs` exercises format/path/hash/ACL refusal and
unknown-history/foreign-lock behavior with isolated local fixtures.
`ops/drill.mjs IMAGE_ID OUTPUT_ROOT PACKAGE_DIRECTORY` is an explicit acceptance
driver, not a launcher. It creates only uniquely labelled offline fixture
resources, uses the existing Aalborg ZIP read-only, and saves safe receipts under
the output's evidence directory. It does not stop the working Preparer. Consult
the Stage 10 report for actual versions, counts, measured times/sizes, failures,
cleanup and remaining NOT_RUN environments; the commands above are not results.
