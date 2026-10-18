# Isolated local PathFinder runtime

This installation belongs only to `WFC-pathfinder-local`. It uses a new Compose
project, images, networks, PostgreSQL database, MinIO storage, staging and
PathFinder artifact volumes. The original WFC application and its thirteen
containers are outside this lifecycle. There is no push, merge or deployment.

The default address is **http://127.0.0.1:5190**. Only the web service publishes a
port, bound to IPv4 loopback. API, database, object storage and calculation inputs
remain on the project's private Docker network. The front network permits local
access; it is not an operating-system network sandbox.

Actual container ceilings are checked after startup: API 4GiB with a 1536MiB
Node heap and 256 processes; PostgreSQL 1GiB; MinIO 1GiB; web 256MiB. These are
resource ceilings, not evidence that a complete plant fits in memory.

## Preparation and launch

Run the following from the isolated checkout, using Node 24 and Docker Desktop:

```powershell
Set-Location -LiteralPath 'C:\Users\todor.chankov\source\WFC-pathfinder-local'
node scripts/pathfinder-local/runtime.mjs init
node scripts/pathfinder-local/runtime.mjs configuration
node --test scripts/pathfinder-local/runtime.test.mjs
node scripts/pathfinder-local/runtime.mjs build
node scripts/pathfinder-local/runtime.mjs start
node scripts/pathfinder-local/runtime.mjs info
```

`init` creates a new ownership ID and fresh database, MinIO and JWT credentials in
`pathfinder-engine/.scratch/pathfinder-local/runtime.env`. The file is ignored by
Git and excluded from Docker transport. It is created privately; Windows also
removes inherited ACLs and grants the current account read/write access. These
values never come from another application's `.env`. Preserve that directory:
its marker and configuration establish ownership of the installation.

Initialization refuses an existing runtime directory. Subsequent commands use
the saved directory; they never silently replace a marker or regenerate a lost
password. Alternate runtime directories must remain under the isolated engine's
`.scratch/`. Reserved original application/service ports are refused.

The first image build requires access to the Docker/.NET/npm package sources.
The candidate Dockerfile copies the .NET 9 runtime into the Node 24 API image,
publishes `PathFinder.ModelRunner.dll`, and builds the current frontend. Every
build gets its own candidate tags. Start uses exact saved image IDs with
`--no-build --pull never`; restarting a verified installation needs no download.
All required Autodesk Viewer SDK files are copied from the verified local SDK.
There is no Autodesk account or cloud call in this runtime setup.

The file-specific Docker ignore list excludes copied model inputs, all engine
scratch, both policy-denied historical scratch directories, generated .NET
outputs, private configurations and environment files. The excluded historical
directories themselves remain untouched and remain visible to Git.

Do not use the root `docker-compose.yml`, `docker-compose.app.yml`, or the
existing `update-local-app.ps1` to manage this installation.

## Fresh demonstration data

```powershell
node scripts/pathfinder-local/runtime.mjs bootstrap
node scripts/pathfinder-local/runtime.mjs import-model --zip 'C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output\aalborg-svf-v1.zip'
```

Bootstrap requires an empty **owned** users table. It registers a new first user
through the ordinary authentication endpoint and checks the server's admin
result. It creates only a new demonstration project, with explicitly synthetic
Details settings: SECONDARY 3m, end connection 5m and additional bending 10%.
These are demonstration inputs, not imported engineering facts or recommended
real-project values. The generated login stays in the separate ignored
`demo.private.json`; tools do not print it or put it in public evidence.

The real portable ZIP is separately copied into this runtime directory only
after its exact current SHA/size pass. Import uses the normal authenticated model
registry upload, awaits its durable completion, verifies the expected resource
fingerprint, and explicitly selects that version using the selection revision.
It does not read the original WFC database/MinIO or call the Preparer/APS.

The accepted current ZIP is 439112840 bytes, SHA256
`e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922`.
It contains 342 resources with fingerprint
`b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`.
An older transport SHA in historical Viewer tests is not substituted here.

For the separately marked synthetic calculation/Apply acceptance fixture, after
the current backend has been rebuilt and launched with this dedicated profile:

```powershell
node scripts/pathfinder-local/seed-synthetic.mjs
```

This operation is restricted to the owned `PF_LOCAL_DEMO=true` runtime. It
creates a different `PF-SYNTHETIC-*` / `Synthetic PathFinder` project, imports its
own selected Viewer-model version and invokes only the backend's trusted fixture
CLI. That CLI owns the exact known10m synthetic geometry hash/proof, two
synthetic Control/Instrumentation cables and explicit Details settings. No
HTTP caller can assert that proof. The real Aalborg project/version retains its
unaccepted engineering status. The synthetic fixture IDs are saved separately
from the original demo project; credentials remain private.

Registration/project creation and ZIP import are separate explicit operations.
Do not repeat bootstrap into an existing database or rerun import after a failed
upload by deleting its receipt/copy. Diagnose and preserve existing history.

## Stop and restart

```powershell
node scripts/pathfinder-local/runtime.mjs stop
node scripts/pathfinder-local/runtime.mjs start
```

Stop verifies exact project/ownership labels, container names, mounts, networks,
endpoint settings and loopback binding before stopping only those containers.
It keeps images, database, model storage and the authoritative PathFinder volume.
There is no general delete/down/prune command. A separate `retire` command is
restricted to a successfully verified additional restore fixture and refuses the
primary demonstration installation and failed quarantine targets.

## Coherent backup including PathFinder artifacts

The older WFC operations profile supports one API staging mount. It must not be
used unmodified here: this candidate also owns `/var/lib/wfc/pathfinder`, which
contains authoritative snapshots/proposal artifacts as well as fitted cache
data. The dedicated profile captures **both** PostgreSQL and all three cold file
volumes: MinIO, staging and PathFinder. Exact API/web/PostgreSQL/MinIO image IDs
travel in the backup for an offline restore on this host/platform.

Choose fresh paths under engine scratch and keep the private configuration
outside the backup directory:

```powershell
node scripts/pathfinder-local/runtime.mjs backup `
  --backup 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\pf-backup-unique' `
  --private-config 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\pf-backup-unique.private.json'
node scripts/pathfinder-local/runtime.mjs verify-backup `
  --backup 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\pf-backup-unique'
```

The helper stops only the owned web/API with the application's graceful timeout,
refuses an unclean stop or another database writer, records the exact public-table
inventory, reads all ready model resources, and inventories every PathFinder
artifact by raw SHA/size. It requires stable business/registry inventories,
stops only its MinIO, takes a custom PostgreSQL dump, captures the three volumes,
reads their archives back, and verifies exported image envelopes and hashes.
It resumes the prior running services in dependency order and waits for actual
loopback health before publishing completion. The `finally` path also attempts
resumption on failure. A missing completion marker or failed resume is not a
successful backup; retain partial output for diagnosis.

Keep other operators and concurrent lifecycle/test jobs out of this isolated
installation during backup. No automatic backup cadence, retention deadline,
RPO or RTO is implied. Ensure sufficient host/Docker disk space before starting;
an I/O/space refusal leaves a partial directory rather than deleting data.

The private companion contains **only this installation's** generated secrets
and, when present, its local demonstration login. It is protected separately,
unencrypted, must not enter Git or public evidence, and must travel separately
from the business/model archive. The archive itself also contains business data.

## Fresh restore and quarantine

```powershell
node scripts/pathfinder-local/runtime.mjs restore `
  --backup 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\pf-backup-unique' `
  --private-config 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\pf-backup-unique.private.json' `
  --port 5191
```

Restore creates a new project/ownership ID, new runtime directory and fresh
volumes; it never overwrites or reuses the source. It verifies all backup/image
bytes first and loads only missing verified image IDs. The three file volumes
are restored while API/web are absent. PostgreSQL is restored into the new
database; full business/registry and PathFinder artifact inventories must match.
The ready model resources are audited again. A new target-only JWT secret is
generated and copied Viewer resource/login sessions are durably fenced before
exposing the new frontend. Fresh login is required.

A failed data/auth/integrity gate leaves API/web absent and retains the new
target as `failed-quarantine`. Do not expose or manually repair such a target.
Use another fresh restore target after resolving the cause. Old credentials or
an original application's environment cannot substitute for the matching private
companion. This is a same-host/platform procedure, not a claimed cross-platform
or cross-computer acceptance result.

The tool reports the new runtime directory. Supply that path with `--runtime`
for its later `info`, `stop` or `start` operations. A running demonstration should
be retained for review. Unneeded new resources may be removed only after exact
ownership verification; the historical two policy-denied cleanup directories
must never be retried or bypassed.

The combined final drill can be run with two fresh paths:

```powershell
node scripts/pathfinder-local/drill.mjs `
  --backup 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\pf-final-backup-unique' `
  --private-config 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\pf-final-backup-unique.private.json'
```

It obtains a fresh source login/Viewer session, takes the cold backup, restores
to an additional 5191 target, and checks the copied Viewer cookie and source JWT
are rejected there while a fresh target login/session works. The source cookie
must still work on the source. Tokens and cookies remain in memory. Only the
two sessions created by this drill are revoked during cleanup.

When the separate synthetic fixture is present, the drill also queues 64 new
disposable cables on the extra target. It must actually observe a .NET
supervisor/worker process pair and an unfinished running job before abruptly
stopping only that restored API container. It verifies the stopped process
namespace, source health, naturally expired lease/restart recovery and exactly
one proposal per cable without changing job leases in SQL. Failure to observe
the real pair within 25 seconds is explicitly NOT_RUN and performs no crash.
No cable Apply is performed. A passing drill retires the extra target; failed
targets and failure evidence remain for diagnosis. `--keep-restore` retains a
successful extra target for review; `--skip-crash-recovery` explicitly omits
that control. Neither option changes the primary demonstration installation.

After recording a successful drill, remove only that extra verified restore's
containers, networks and data volumes with:

```powershell
node scripts/pathfinder-local/runtime.mjs retire --runtime '<reported restore runtime directory>'
```

This checks the stored restore acceptance, project/owner labels and exact Docker
identities before every removal, refuses running resources until its own stop
has completed, and preserves the backup, images and diagnostic marker. It cannot
retire the primary project. Retired targets cannot subsequently be started as an
apparently restored application with empty data.

## Artifact transport boundary

The computational snapshot endpoint has its own 256MiB Nginx limit and streams
to the API after a body-free current-admin/login/project authorization
subrequest. The API repeats that boundary before parsing the large body and
again at the transactional write. Other API routes retain their ordinary
smaller limits. The protected Viewer capture additionally limits selected
capture data to 64MiB and 3000 events, each at most 24KiB, under the existing
bridge request quota. These are explicit rejection limits, not truncation.

`node scripts/pathfinder-local/check-artifact-transport.mjs` checks the isolated
proxy using a fresh own admin login, a header-only unauthenticated declaration,
a header-only 256MiB+1 declaration and an actual 11MiB intentionally invalid
snapshot. No accepted artifact is written. The recorded check is
`artifact-transport-1792290628158.json`: 204 authorization, 401 before body,
413 above limit and 400 backend-schema rejection above the old 10MiB limit.
This does not establish a successful 64MiB capture or 256MiB capacity benchmark.

After a combined final drill and its retained backup both verify successfully,
`cleanup-obsolete.mjs` can retire only the exact superseded initial PF3 backup
archives and unreferenced images carrying this installation's ownership:

```powershell
node scripts/pathfinder-local/cleanup-obsolete.mjs `
  --final-drill '<absolute final-drill receipt path>' `
  --old-backup 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\pf-runtime-backup-20261018-initial'
```

It keeps the historical manifest/receipts and records that their old archives
are intentionally superseded. It performs individual checked file removals
and non-forced own-image removals, with no recursive parent deletion, cache
prune or removal of capture/native inputs. The primary runtime, final backup,
private companion and both previously denied scratch directories remain.

## Verification status

Preflight currently verifies nine configuration/ownership/path/artifact negative
controls. Actual image build, start, model import, backup/restore and browser
checks require their own recorded results. The presence of these tools does not
establish a PASS for those operations or resolve the native/converted engineering
parity limitation documented in the PF-2 report.
