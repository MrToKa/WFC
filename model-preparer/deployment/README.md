# Local Docker deployment

The project is independent of WFC, the working Viewer and Niedax. It runs one
managed Node.js 24 process with trusted SDK 7.130.0 and the existing public
Package A boundary. Local registration, preview and export do not require an
Autodesk mutation. Closed mode is the default. The live adapter uses a pinned,
current operator account review and separate authorization. This deployment
defaults live execution to reuse of an existing matching object/derivative.
New cloud preparation requires the explicit deployment switch and separate
source-bound operator authorization described below. Aalborg acceptance uses
the default reuse policy and does not demonstrate a new conversion.

## Build once, start locally

From the Preparer project directory, with Docker Desktop Linux containers and
PowerShell available:

```powershell
.\start-preparer.ps1 -Build
.\start-preparer.ps1
.\stop-preparer.ps1
.\start-preparer.ps1
```

The default UI address is `http://127.0.0.1:8083/`. A repeated start preserves the
same container when its image, mode and port match. Use `-Recreate` explicitly
after a new build or configuration change; it requests graceful shutdown first.
The script rejects another service occupying the requested port. It never stops
or removes other projects and never invokes a global prune.

`-Build` is an explicit deployment preparation step. It requires local Node.js
24 and the two source projects plus the trusted original SDK. The base is pinned
to `node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5`,
verified here as **Node v24.22.0**. The Windows development runtime is v24.19.0.
A first build may fetch that base image; there is no npm install, dependency
download, SDK vending or APS request in the Dockerfile. Build RUN steps use
`--network=none`. Normal startup uses an already delivered image, `--no-build`
and `--pull never`.

Three named build contexts contain only allowlisted copied Preparer source,
the public Package A source, and the verified deployment SDK. The main context
is the tiny deployment directory with a deny-all `.dockerignore` allowing its
Dockerfile and bounded recovery-fixture source files. The production
Dockerfile copies no fixture files. Original `.env`, NWD files, received ZIPs, state, evidence and old
outputs never enter those contexts or image layers. Each explicit build records
its source SHA inventory under `deployment/.build/<UUID>/build-input-inventory.json`.

## Existing configuration file

The start script defaults `-EnvFilePath` to the authorized PoC file:

```text
C:\Users\todor.chankov\Documents\Codex\2026-10-15\https-get-started-aps-autodesk-com\outputs\aps-local-viewer\.env
```

An explicit override changes only its path:

```powershell
.\start-preparer.ps1 -EnvFilePath 'D:\Existing configuration\.env' -Port 8083
```

The script validates required setting presence/syntax without printing values.
Compose supplies the existing file through runtime `env_file` with `format:raw`,
preserving literal dollar signs instead of interpolating credentials. Matching
outer dotenv quotes are normalized by the application readiness validator.
No second real `.env` is created. These scripts never edit the original file.
Any separately authorized change to that file is recorded in the stage report.

Only server-side readiness for `APS_CLIENT_ID`, `APS_CLIENT_SECRET`, `APS_REGION`
and `APS_BUCKET` leaves the configuration boundary. Old `PORT`, `MODEL_SOURCE`
and `MODEL_NAME` do not define this application's port, source or task. Historical
`APS_ACCOUNT_TIER`/`APS_ALLOW_CLOUD` do not authorize mutations. Starting,
restarting, refreshing and loading credentials create no job or APS call.
Do not print `docker compose config` or raw container environment diagnostics.

## Runtime paths, modes and isolation

| Configuration | Container value |
|---|---|
| `PREPARER_MODE` | `closed` by default; explicit `simulation` or proof-gated `live` |
| `PREPARER_INSTANCE_ID` | private UUIDv4, equal to the own container instance label |
| `PREPARER_HOST`, `PREPARER_PORT` | `0.0.0.0`, `8080` inside the private container |
| `PREPARER_PUBLIC_ORIGIN` | `http://127.0.0.1:<requested host port>` |
| `PREPARER_DATA_DIR` | `/var/lib/preparer/data` |
| `PREPARER_WORK_DIR` | `/var/lib/preparer/work` |
| `PREPARER_OUTPUT_DIR` | `/var/lib/preparer/outputs` |
| `PREPARER_PACKAGE_MODULE` | `/opt/package/index.mjs` |
| `PREPARER_SDK_DIR` | `/opt/preview/sdk`, served under `/sdk/` |
| `PREPARER_IMPORT_ROOT` | `/imports`, explicit read-only host-directory mount |
| `PREPARER_SOURCE_ROOT` | `/sources`, explicit read-only host NWD-directory mount |
| `PREPARER_PRICE_SIGNING_KEY_PATH` | `/var/lib/preparer/data/live/security/cost-hmac.key`, private persistent key |

The three persistent named volumes belong to Compose project
`routings-preparer`; their directories have stable container paths. The service
separates `closed`, `simulation` and `live` data/work/output subdirectories. Switching
mode needs an explicit `-Mode simulation -Recreate` or explicit live start. Simulation approvals and
ledger never activate live execution. Its tiny synthetic payload is fixed test
data and is not geometry converted from an operator's NWD.

`-ImportRoot` defaults to the Stage 1 package-output directory. This allows local
registration of the existing Aalborg ZIP without rebuilding it. Clients select
approved input IDs; they do not supply arbitrary server paths. Original inputs
remain read-only. New streamed uploads and captured snapshots use controlled
runtime locations, never Docker build inputs.

`-SourceDirectory` defaults to the explicit Aalborg NWD directory recorded in
the baseline, independently of old `MODEL_SOURCE`. It is read-only in the
container. On another machine, supply an existing allowed source directory and
`-ImportRoot` explicitly; browser path text never becomes a container path.

The published port binds only Windows loopback. The container runs as the Node
user, with a read-only root filesystem, dropped capabilities, no added
privileges and a bounded tmpfs. It uses a normal private Docker bridge because
Docker Desktop 28 suppressed published-port forwarding for an internal network.
This is **not an OS egress sandbox**. Closed/simulation capabilities, zero startup
calls and self-only browser policy enforce the application boundary. An explicit
live start with a pinned operator proof applies `compose-live.yaml` for its
read-only proof configuration. Credentials alone do not authorize an operation.

## Explicit live proof and existing-model reuse

The server-controlled source is an authenticated operator account review,
with pinned observation hashes, exact account/application/region/bucket
bindings, approved NWD identity, allowed operations, remaining allowance and
expiry of at most 30 minutes. See [the current review method](../docs/live-cost-source.md).
Environment flags, credentials, client JSON and simulation approvals cannot
issue this source. Its directory is mounted read-only under `/proof`, outside
all image/build contexts.

```powershell
.\start-preparer.ps1 -Mode live -Recreate `
  -PriceProofPath 'C:\path\to\review\aps-live-proof.json' `
  -PriceProofSha256 'THE_64_LOWERCASE_HEX_DIGIT_OPERATOR_REVIEW_SHA256'
```

Use the actual reviewed proof path/hash, not the placeholder. Changed proof,
configuration, permitted roots or image require explicit `-Recreate`; unchanged
healthy starts retain the same instance. A missing/expired/invalid proof keeps
the local UI available with requested mode `live` and actual capability closed.
Health/start checks compare `requestedMode` so that safe refusal is not mistaken
for a failed local application.

Keep the same requested `-Mode live` and proof pin when reopening saved live
jobs after expiry. They retain their live data/work/output namespace while APS
capabilities are closed. A fully downloaded job can still be packaged, verified,
previewed and exported locally. Partial downloads need a fresh review before
further network work. Switching to `-Mode closed` selects a separate store.

The server creates one 32-byte private signing key in its persistent live data
volume (0600 on Linux). Grants use HMAC-SHA256 and deterministic IDs for the
pinned review plus exact immutable operation. The key and APS values never
enter jobs, browser payloads, image layers or command arguments. Read and
mutation allowances have independent global per-review durable counters;
reapproval, labels, new job IDs and restart cannot reset usage. Final synchronous
checks reread the pinned proof/observations and expiry immediately before every
internal provider mutation after token/URL awaits.

`PREPARER_LIVE_REUSE_ONLY` defaults to `true`. Existing Aalborg acceptance
uses captured source SHA256 and the OSS SHA1/local SHA1 relationship, discovers
the existing derivative and downloads/verifies its raw resources. It records
reuse observations without inventing submission attempts, remote SHA256 or a
provider job ID. The adapter contains guarded mutation code, but this deployment
does not authorize a new upload/conversion demonstration. Stage evidence
distinguishes actual reuse from simulation and a new conversion.

For a separately authorized new source, the operator can explicitly enable
bounded new preparation using a fresh pinned review approving that exact
source and its zero-cost storage/upload/submit allowances:

```powershell
.\start-preparer.ps1 -Mode live -Recreate -AllowNewCloudPreparation `
  -PriceProofPath 'C:\path\to\new-source-review\aps-live-proof.json' `
  -PriceProofSha256 'THE_64_LOWERCASE_HEX_DIGIT_OPERATOR_REVIEW_SHA256'
```

This switch is refused outside live mode, without a pinned proof, or with an
expired/invalid review or missing explicit operator authorization. Its local
preflight checks current review dates and positive zero-cost operation
allowances; the server remains responsible for full strict proof/artifact,
account/source binding, HMAC, expiry and durable quota validation before every
operation. Enabling this capability does not start a cloud operation. The
operator still selects the approved source and invokes explicit actions.
Credentials and legacy `APS_ALLOW_CLOUD` flags never enable it. The reuse flag
is included in a runtime configuration SHA and container labels; changing
either policy requires `-Recreate`. Existing deployments without the new policy
labels also require one explicit graceful recreation. Omit the switch for the
Aalborg acceptance run and all ordinary reuse-only starts.

## SDK adaptation and preview

`prepare-runtime.mjs` requires the pinned original SDK inventory SHA
`747540a153fb18809c428d8ed177aa8a296cff1b5175ab85445e0a2ebdb36d75` and verifies
all **206 assets / 82552768 original bytes**. It rejects missing/unlisted files,
links and changed hashes. The deployment copy preserves all assets except
54 stylesheet URLs to Autodesk's font CDN, which are replaced with the already
present `/sdk/res/fonts/arimo-v29-latin_latin-ext-regular.woff`. Workers,
extensions, locale files and JavaScript retain their original bytes and local
resource root. The application preserves original model colors and light
lighting and adds no future WFC cable/manual routing tabs.

`deployment/preview-runtime/deployment-provenance.json` records origin, each
source/deployed size and hash, and the precise adaptation. Original CSS SHA is
`630eb9440c8484a7f2e1fac43017c891d17d2a98f7cc8d02b2675c05b142e724`;
deployment CSS SHA is
`4f687eb10c4a5c19be5676a143d36862d0967f6fbc9f436492c69bc6d5fddf45`.
The source Viewer/SDK files are never modified. Preview uses verified package
resources plus this separate runtime; package identity/provenance is unchanged.

## Locks, shutdown and backup

Stop signals only this project's container, waits up to 45 seconds by default,
and preserves containers' three named volumes and received inputs. The service
aborts its own local operations and waits for bounded completion. It does not
claim confirmed remote cancellation. Start reads persistent local state and
never automatically prepares, polls or recovers a stale lock.

On Linux, new lock owner records use schema 2 with kernel boot ID, PID namespace
and `/proc/PID/stat` start ticks. Same-namespace exact process absence or a reused
PID with different start ticks can establish death under explicit recovery.
The store retains schema 1 reading compatibility and refuses namespace-blind
Linux recovery of legacy owners. Live, foreign-namespace, changed-boot,
unreadable or ambiguous identities remain blocked. Nonce/inode checks still
protect release. Age is never takeover evidence.

The private PID namespace is intentional. `pid:host` would expose other Linux
VM processes and enlarge the signaling surface; this deployment does not use
it. Graceful stop/recreate releases owned locks. An abrupt termination followed
by recreation can leave locks from an old namespace. Automatic recovery stays
blocked. For an exact preserved stopped own container, use the explicit operator
action before recreation:

```powershell
.\start-preparer.ps1 -RecoverStoppedContainer
```

The deployment verifies its project/service/image/instance labels, Docker's
stopped state and PID=0, and that no running container mounts its data/work
volumes. It captures a read-only inode/device/SHA/nonce/process-identity snapshot,
rechecks Docker immediately before a network-none writable helper, and acquires
the core recovery mutex plus service lifecycle mutex. The helper revalidates
checksummed store/journal state and removes only locks belonging to that exact
stopped Node owner and its service-owner file. It never changes job records,
write-ahead ledgers, high-water heads or snapshots. Changed owner/state, foreign
instance, ambiguous mutex, legacy instance-less owner or corruption refuses
recovery. Preserve the stopped container until this action completes. Startup
cannot enter while the recovery marker exists; an interrupted ambiguous recovery
marker requires inspection and is never deleted automatically.

The isolated actual SIGKILL fixture proves that a new private namespace can read
the same job after this action while `submission-unknown` still rejects another
submit. `deployment/test-stopped-recovery.ps1` creates only uniquely named helper
containers/volumes and records its evidence, then removes those temporary Docker
objects. Reused-start-tick tests are
explicit stale-identity fixtures, not a claim that the kernel was forced to reuse
a PID. Real independent process crash/race cases are tested separately.

`deployment/test-app-sigterm.ps1` exercises the actual app service in isolated
network-none simulation containers. Deployment-only file-handle/provider
fixtures pause after captured temporary bytes, a partial downloaded resource
following a durable checkpoint, and ZIP staging bytes. SIGTERM drains the
service; restart retains interrupted state, and explicit local download/package
continuation does not submit again. These fixture controls are absent from
production image/runtime interfaces. Evidence records the synthetic basis and
exact cleanup; it does not claim a live cloud interruption was simulated remotely.

Record/head and snapshot publication occurs within the respective mounted
volume; ZIP staging/no-overwrite publication stays within the output volume.
Short owned publication fences synchronize public progress reads with record/head
publication across processes; they do not hold the long job lease during a read.
A live paused publisher makes readers wait for a coherent commit. A dead
publisher's inconsistent record/head pair remains corruption and is not repaired
by stopped-container lock recovery.
The implementation tests process-crash durability, not universal power-loss
durability or a hostile filesystem race. Back up **data, work and outputs
together while the app is stopped** and record image identity plus the SDK
provenance. Preserve captured snapshots, ledgers, checkpoints and last-good
packages together. Never use `docker compose down --volumes` for ordinary stop.

For offline delivery, export a new image archive after explicit build:

```powershell
.\start-preparer.ps1 -Build -ExportImagePath 'D:\Delivery\preparer-stage3.tar'
docker image load --input 'D:\Delivery\preparer-stage3.tar'
.\start-preparer.ps1
```

Move the source project/start scripts and the original authorized configuration
through their appropriate secure delivery process separately. The image archive
contains runtime code/SDK and never the credentials or a model. Current actual
Docker/browser/lifecycle results and remaining live restrictions belong in the
Stage 3 report; this guide is not evidence that a live conversion succeeded.

Docker references: [named contexts](https://docs.docker.com/build/concepts/context/#named-contexts)
and [service env_file, init, ports and persistent mounts](https://docs.docker.com/reference/compose-file/services/).

## Independent stopped backup and fresh restore

For a coherent capture of all three volumes **and job-referenced external ZIP,
source and proof inputs**, use the versioned tools in
[docs/operations.md](../docs/operations.md). They export the exact image ID and
carry their own operator modules for an offline fresh quarantine restore. They
refuse unsafe locks, incomplete history and existing targets; they never rewrite
job/WAL identities or renew APS authority. Restored startup keeps the requested
namespace with actual provider closed and defaults to `network:none`.

Ordinary `start-preparer.ps1` / `stop-preparer.ps1` remain unchanged. Normal start
does not build or pull; the launcher still has its protected configuration
prerequisites. The Stage 10 backup CLI has an explicit bounded stop/restart
option for the named source only. Keep credentials separate and private and
retain verified backups and portable ZIP inputs.
