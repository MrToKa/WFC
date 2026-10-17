# Operations, coherent backup and isolated restore

Stage 10 uses the existing PostgreSQL, private MinIO registry and independent Model Preparer. Maintenance tools run locally with Docker access. They introduce no public maintenance API. `/health` remains a process/readiness check; it is not a model integrity check.

## Prerequisites and boundaries

- Use Node 24, PowerShell 7 and a local Docker Engine context with Linux containers. The transported image OS/architecture must match the target Engine. This stage validates localhost HTTP on this Windows/Docker Desktop host. LAN, HTTPS and a second physical computer require separate acceptance.
- Have sufficient free space on both the host backup disk and Docker's data disk. The backup command measures source mounts, database size and image sizes and refuses inadequate host space. Leave capacity for all transported images, fresh database/object/staging volumes, verification scratch files and retained diagnostic targets. Measured sizes and timings are in the stage report; no RPO, RTO or deletion deadline has been agreed.
- All WFC application/import/recovery workers must be declared. Discovery checks database/object endpoints and shared writable mounts, refuses undeclared writers and unsupported extra mounts. External non-container writers must be excluded by the operator during maintenance. Do not run competing deployment, recovery or storage jobs.
- The supported database profile is one PostgreSQL database selected by the API's `DATABASE_URL`, using the transported PostgreSQL image and its initialization role/database. Restore uses `POSTGRES_USER` (default `postgres`) and `POSTGRES_DB` (default that user); the API connection must resolve to that restored role/database. The checked original installation uses the default-role/default-database profile. The custom dump uses `--no-owner --no-acl`: it is not a `pg_dumpall` backup of cluster roles, other databases or tablespaces. Deployments requiring additional global objects need a separately verified migration procedure.
- Backups have a versioned manifest, full file hashes and a complete marker. An incomplete directory is diagnostic material, not a restorable backup. Old backups without this format are **legacy/unverified**; these commands do not upgrade, delete or overwrite them.
- Real operator credentials belong in the separately protected private configuration, never Git, images, command arguments or public evidence. Protect the data archive itself as business data. Keep its private configuration through the same controlled offline transfer, separate from the archive.
- Ready model metadata/content are immutable. Recovery only removes provably owned **unpublished** import resources through the existing recovery service. Published orphan prefixes, foreign staging and ambiguous ownership are retained. Retention is report-only by default.

## Coherent WFC backup

The original `DestinationRoot` parameter remains supported. Use a new private-configuration filename outside that destination. The supplied source inventory must identify the exact working build, including untracked sources and SDK/runtime. HEAD alone is insufficient.

The private configuration contains the saved role environments and launch settings. It is created exclusively with mode 0600; on Windows the writer removes inherited permissions and grants the current account read/write access. Protect its parent directory and transfer channel too, and inspect the resulting access policy before delivery. It is not encrypted by this tool and must not be placed in public evidence or inside the backup directory.

```powershell
$repo = 'C:\Users\todor.chankov\source\WFC'
Set-Location -LiteralPath $repo
# Use the exact operations helper image ID recorded with the verified build.
$helperImage = 'sha256:<64-hex-verified-helper-image-id>'
./scripts/backup-wfc.ps1 `
  -DestinationRoot 'D:\WFC Back-ups' `
  -PostgresContainer 'wfc_app' -MinioContainer 'wfc-minio' `
  -AppContainer @('wfc-app-backend-1') -WebContainer @('wfc-app-frontend-1') `
  -HelperImage $helperImage `
  -SourceInventory 'D:\WFC Operations\verified-source-inventory.json' `
  -PrivateConfigOut 'D:\WFC Private\backup-unique.private.json'
```

Check wrapper parameter names with `Get-Help ./scripts/backup-wfc.ps1 -Detailed`. The equivalent Node CLI is:

```powershell
node scripts/operations/wfc-ops.mjs backup --destination-root 'D:\WFC Back-ups' `
  --postgres-container wfc_app --minio-container wfc-minio `
  --app-container wfc-app-backend-1 --web-container wfc-app-frontend-1 `
  --helper-image $helperImage --source-inventory 'D:\WFC Operations\verified-source-inventory.json' `
  --private-config-out 'D:\WFC Private\backup-unique.private.json'
```

Repeat `--app-container` for every worker. Each declared worker must use the same database/object settings and the exact shared staging mount as the API. The API must have one unambiguous network; PostgreSQL and MinIO may be on different networks when the API reaches their verified published ports through `host.docker.internal` or `gateway.docker.internal`. Selecting a container by name alone does not establish its relationship to the API.

The backup follows this order:

1. Validate source identities, mount ownership, destination and space. Pin the exact helper image with a stopped, uniquely owned lease container so removing a tag cannot make the helper disappear during maintenance.
2. Stop every declared application/web worker with a default 45-second allowance, exceeding the application's 30-second shutdown deadline. Record the actual exit code and OOM status. A forced/nonzero interruption is reported as `forcedOrUnclean`, never as a clean drain.
3. Fence remaining PostgreSQL client backends of the exact selected database. A disconnected application's blocked SQL can survive its process exit, so container shutdown alone is insufficient. Terminate blocked requests before their blockers, wait up to 5 seconds per backend, then require a fresh query to find zero remaining clients. The bound is 128 clients with a 60-second statement timeout. The tool refuses an exceeded bound or an unsuccessful fence. `database-fence.json` records the result and is included in the hashed manifest. Keep reconnecting external writers excluded throughout the maintenance window.
4. Capture the canonical inventory, fully audit all ready model resources, and require unchanged business/registry inventories. Then stop MinIO **before** the logical database dump and cold MinIO/staging capture. PostgreSQL stays running for `pg_dump --format=custom`; `pg_restore --list` checks the dump envelope.
5. Capture the actual MinIO/staging mounts and read back both archives. Export and validate the five exact image roles, copy the four operator modules, and record their byte counts/SHA-256.
6. Resume only services that were initially running and check their resumed state/readiness **before publishing `complete.json`**. Finally recheck the source state, release the owned helper lease and record `resume.json`. A failed resume is a failure, not an accepted maintenance interruption.

The archives use bounded 1 MiB buffering; no whole-model buffer is required. The versioned file envelope records file and directory paths, modes, ownership, timestamps, sizes and hashes. Capture checks source identities before/after reading and verification reads the archive again. Unsafe paths, links, special files, collisions, source changes and limits cause refusal. Buffered capture changes I/O batching, not the cold consistency boundary or full hash checks.

The archive carries the entire MinIO `/data` tree including metadata and all buckets, exact cold staging, database, canonical public-table inventory, model audit, source inventory, exact API/web/PG/MinIO/helper images and public deployment topology. Inventory hashes use the full PostgreSQL JSON row values, preserving timestamp precision; restored session tables are deliberately fenced separately. Templates, SDK and runtime are inside the verified application images. Extra worker/MinIO mounts and any web mount are refused by this profile; PostgreSQL is captured logically rather than by copying its data mount. The original portable ZIP is a separate operator artifact; WFC does not promise a ZIP export endpoint or persistence after staging cleanup.

Always inspect the final status, `complete.json` and `resume.json`. A backup requires a successful command and verification; a cold dump or partial directory alone is not completion. The `finally` path attempts to restore each initially running source even when a preceding step fails. It preserves initially stopped services. Check any `HELPER_LEASE_RETAINED` cleanup receipt separately. Failure is not permission to delete or reuse a partial directory. Resolve a source-resume failure before another maintenance operation; use new output/private-configuration filenames for a retry.

## Verify and fresh offline restore

```powershell
$backup = 'D:\WFC Back-ups\wfc-<capture-id>'
$ops = Join-Path $backup 'wfc-ops.mjs'
node $ops verify --backup $backup
node $ops restore `
  --backup $backup `
  --private-config 'D:\WFC Private\backup-unique.private.json' `
  --target-root 'D:\WFC Restores\aalborg-drill-unique' `
  --project wfc-restore-aalborg-unique --http-port 18091
```

The parent directory must exist; the target directory must not exist. Project/container/volume names and loopback port must be free. The tool refuses replacement, foreign resources, unsafe paths, malformed archives, incomplete backups, unexpected file hashes and incompatible image identity/profile/platform. `ReplaceExistingData` remains unsupported and is explicitly refused by the compatibility wrapper.

Transfer the whole verified backup directory, the separately protected configuration and a Node 24 runtime to the target. The backup already contains four flat, hash-pinned bootstrap modules: `wfc-ops.mjs`, `docker.mjs`, `manifest.mjs` and `archives.mjs`. Run the bundled `wfc-ops.mjs` as shown above; keep the modules together. No original checkout, `package.json`, `node_modules`, PowerShell wrapper or npm install is needed for that route.

The five transported image roles are API, web, PostgreSQL, MinIO and operations helper. Their immutable IDs and platform metadata are verified before load, with no pull, rebuild, SDK download or source-tag overwrite. New captures save by ID without working image tags. Validation handles Docker's modern OCI envelope, including a pinned index with only its locally present selected platform: the selected config must be reachable, its OS/CPU must match, and all included content-addressed blobs must hash correctly. It does not fetch absent platforms or establish compatibility with a different CPU architecture.

Restore creates new labeled PostgreSQL/MinIO/staging volumes and two networks. Database, storage and API use the internal private network. Only web additionally joins a dedicated **non-internal** front network and publishes the requested port on `127.0.0.1`. This Docker topology makes the local frontend reachable; it is not an OS-wide egress sandbox or a LAN/TLS deployment. The tool checks both network identities/policies and exact container, volume, mount and ownership bindings. It does not reuse source mounts.

Initially only database and storage start. Before creating the app services, restore compares the canonical business/registry inventories, revokes copied resource sessions, retains revoked login bindings as durable tombstones, generates a new **target-only** JWT secret and reads every ready model resource with raw SHA-256/size verification. Every successful pinned read handle must close before that model can become healthy. Active UUID, selection revision and the full PostgreSQL timestamp are preserved. Restore does not choose latest, promote staged objects or call selection PATCH.

Only passed gates allow API and loopback web startup. Completion additionally requires a real host HTTP `GET /health` through that published frontend: HTTP 200, bounded JSON and `status: 'ok'`; a Docker-internal healthy flag alone is insufficient. A failed model readback retains the target in `failed-quarantine`, with diagnostic audit and unavailable health for proven missing/corrupt bytes. Transient storage failure remains a failed availability check without falsely classifying corruption or replacing prior health. These failures prevent API/web creation. Do not expose a failed target manually. Keep it for diagnosis, then retry from a separately verified backup into a new target. Do not overwrite published objects to repair a model in place.

Fresh password login is required. Old source Bearer tokens fail the new signing key; copied cookies are revoked; old login IDs remain fenced even with an otherwise valid signature. The source signing secret is unchanged.

## Audit, recovery and selecting another model

```powershell
$manifest = Get-Content -LiteralPath (Join-Path $backup 'manifest.json') -Raw | ConvertFrom-Json
$helperImage = ($manifest.images | Where-Object { $_.role -eq 'helper' }).id
node $ops audit-models --target-root 'D:\WFC Restores\aalborg-drill-unique' --helper-image $helperImage
node $ops recover --target-root 'D:\WFC Restores\aalborg-drill-unique' --helper-image $helperImage
```

The second command is a dry run. Read its owned unpublished candidates, published orphans and unproven staging entries. Applying recovery additionally requires `--apply`, a verified owned target and a stopped target API. After verifying the target marker against the actual Docker IDs/ownership, stop only that target's API with the 45-second allowance, run the same `recover` command with `--apply`, inspect its result, then restart that exact API. The CLI refuses apply while it is running and refuses unexpected clients/mounts. It reuses the existing reconciliation/advisory-lock service, never generic prefix deletion. A deferred job is reported as deferred, not successful cleanup. Full audits run explicitly, separate from routine health checks. Healthy can be restored only after **all** raw resources pass.

Retention is report-only/default retain, with no automatic deletion deadline. An interrupted job is not published because its objects exist. Ready objects, published orphan prefixes and foreign/unproven staging remain preserved. Audit/recovery does not repair ready metadata, rewrite source provenance or change the active selection.

For a new model, use the existing authenticated [Stage 4 HTTP/operator import workflow](04-model-registry-import.md): send the verified portable ZIP as raw `application/zip` to the project's model-import endpoint with a new UUID `Idempotency-Key` and the lowercase SHA-256 in `X-Package-SHA256`, then poll its import result until a ready version is confirmed. Project edit permission is required. Review the import/report through that workflow.

Then open **Project Details → Details → 3D model**, review the displayed label, source and dates (the version ID is added when needed to distinguish otherwise identical entries), explicitly select the version and use **Save**. This section selects existing ready versions; it does not upload/import a ZIP or display a fingerprint/full verification report. Backup/audit commands do not change the selection. **Routings viewer** loads the selected version. A route retains original tray colors and the yellow connecting line; remaining elements use Ghost. Clear returns to the whole model and restores the previous Ghost setting.

## Independent Model Preparer

The Preparer has its own Compose project, loopback port 8083, `restart: no` and three persistent volumes. WFC never starts it and needs no APS settings to consume an imported model.

```powershell
# Run in PowerShell 7. Supply the existing private operator settings without printing them.
Set-Location -LiteralPath 'C:\Users\todor.chankov\source\routings-model-preparer'
./start-preparer.ps1 -Mode live `
  -PriceProofPath $PreservedPriceProofPath `
  -PriceProofSha256 $PreservedPriceProofSha256
./stop-preparer.ps1
node ops/preparer-ops.mjs inventory --container routings-preparer-preparer-1
```

The variables above mean the operator-preserved proof path and exact SHA pin belonging to the original live instance; obtain them from the protected operator record, not a new review. Preserve its existing image, configuration and import/source paths as well. The launcher defaults to `closed`, so a bare `./start-preparer.ps1` is appropriate only for a matching closed instance and refuses the current preserved live instance. Reopening live history after proof expiry keeps local jobs visible with cloud capabilities closed; it does not authorize new APS work. See [launcher mode/proof requirements](../../../routings-model-preparer/deployment/README.md) for its exact arguments.

Start/stop use existing images with no implicit build/pull; ordinary start omits `-Build`. Do not use `down --volumes` to stop. For stopped-consistent backup and fresh restore use the exact commands, prerequisites and protected configuration handling in [Preparer operations](../../../routings-model-preparer/docs/operations.md) in the independent checkout. A complete backup covers valid committed state in data/work/outputs across all ledger namespaces, the signing key and required external ZIP/source/proof references at stable container paths. Unsafe live, foreign, ambiguous or abandoned lock/owner records refuse completion and remain diagnostic evidence; backup does not accept them as safely recoverable or rewrite their history. Image-only or three-volume-only copies are insufficient when jobs reference external `/imports`.

Closed, simulation and live namespaces remain separate. A restored live namespace stays live with its provider closed; changing namespace would hide that history rather than migrate it. Restoring does not change IDs, rewrite history, renew expired price proof, reset allowance, submit cloud jobs or grant cloud authority. Unknown/foreign locks or unsafe cross-host history recovery fail closed. The portable Preparer operator modules and exact image travel with its independent backup. Its default start has no network or published port; optional first-start `--expose-local` enables its recorded loopback port without granting APS capability. Retain the original input ZIP and any required source/proof artifacts independently.

## Failure and cleanup procedure

1. Preserve complete backup and protected configuration. Read the safe status code and diagnostic files; do not print raw Docker environment or private configuration.
2. Check source services resumed to their original running/stopped states. A failed resume needs operator attention before another maintenance operation.
3. Keep failed restored app services stopped and quarantine private. Compare database inventory, exact images and full model audit; process health alone is insufficient.
4. Use a new target for the next restore. Never point restore at source database/storage/staging mounts.
5. Remove temporary resources only after matching target/project ownership labels and markers against their exact Docker IDs, network and volumes. Preserve foreign/unproven objects and historical blocked cleanup targets. Never use global prune or global stop.

## Executed evidence and acceptance limits

The Stage 10 report owns the final result for each gate. The consistency drill additionally exercised a genuine forced worker exit and PostgreSQL-blocked public selection/delete requests: the final fence terminated three remaining backends, and the completed cold dump retained the prior selection and project while leaving the candidate unpublished. This is a same-host fixture result, not a permission to skip maintenance exclusion in another deployment.

Measured archive sizes, maintenance times, restore times, the actual offline Viewer checks, negative quarantine tests and the original-service preservation receipts are in the [Stage 10 report](10-stage-report.md). Prior stage PASS results are historical. User acceptance, another physical computer, LAN/VPN, TLS and untested architectures remain **NOT_RUN**. No RPO/RTO, destructive retention deadline or Stage 11 work is accepted by this runbook.
