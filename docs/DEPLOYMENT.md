# WFC schema changes and independent application containers

## Existing installation verified on 2026-09-12

The running PostgreSQL server is the standalone Docker container `wfc_app`, PostgreSQL 18.0, published on `localhost:5434`, database `wfc_app`. It has an existing Docker volume mounted at `/var/lib/postgresql`; it is **not** the `postgres` service or `.data/postgres` bind declared in `docker-compose.yml`. MinIO is `wfc-minio`, Compose project `wfc`, with the existing `.data/minio` bind at `/data` and ports 9000/9001. The application was a host/VS Code process. Other Docker applications on this machine are unrelated.

Do not run `docker compose up postgres` to update this installation: it would attempt another server on the occupied port. Do not delete volumes, recreate PostgreSQL, or change MinIO credentials as part of an application release. `docker-compose.app.yml` deliberately contains only the frontend, backend and explicit operational commands, and cannot recreate either existing storage container.

## Explicit database lifecycle

Normal backend startup calls `assertDatabaseCompatible`, which performs SELECT queries only, then checks that the configured MinIO buckets already exist. It does not initialize/backfill tables or create buckets. An incompatible schema gives an actionable error before the API begins listening.

The `wfc_schema_migrations` ledger records version, name, normalized source checksum, adoption flag and timestamp. The migration command takes one session advisory lock, applies each pending migration plus its ledger entry in one transaction, rolls back failures, releases the lock and can resume. Applied source files are immutable: changing an applied checksum prevents startup/migration. Add a new ordered migration instead. A bounded lock timeout prevents indefinitely waiting for a conflicting database operation.

- `001-baseline`: explicit empty-database schema only. Two legacy creation-order defects were corrected for fresh installation (cable catalog before its backfill; load curves before their FK). Existing-database adoption verifies the required 400 columns and 384 constraints from `baseline-schema.json`, then records the baseline **without executing its legacy SQL/backfills**. A partial or different legacy schema is refused for deliberate upgrade planning.
- `002-material-foundations`: nullable current identity/snapshots for project/cable materials, row origins and inherited overrides; restrictive in-use project cable-type deletion; mutation revision/receipt/history tables. Legacy identity/snapshots are not reconstructed from current catalog data. Origin/override classification uses only existing explicit source/default links and copied-value differences.
- `003-tray-support-snapshots`: nullable captured tray/support values. Existing rows remain unknown, with no live-catalog backfill.

Host commands, after verifying `server/.env` points to the intended target:

```powershell
npm run db:backup -- wfc_app
npm run db:migrate -- --status
npm run db:migrate -- --adopt-baseline
npm run db:check
npm run storage:init
```

`--adopt-baseline` is needed once for an existing unversioned database. For an explicitly empty database run `npm run db:migrate` instead. `db:check` and `--status` do not write. `storage:init` is explicit bucket provisioning; it is not required during every release. Do not execute migrations against an old application's target until its compatibility and a restore-tested backup are established.

`db:backup` verifies the configured local database port against the named container, runs `pg_dump -Fc` there, copies the archive to ignored `.data/backups`, and writes a checksum/volume manifest without printing credentials. Keep backups access-restricted; they contain application data. Backup MinIO's existing volume through the deployment's storage backup procedure as well. The migrations here did not change MinIO objects or its volume.

For restore verification, create a **new** database such as `wfc_verify_upgrade_<timestamp>` on the verified server, restore the custom archive with `pg_restore --exit-on-error --dbname <new-database>`, and point the explicit migration invocation only at that new database. Do not restore over `wfc_app`. A production restore is a separately planned operation with downtime/target verification, not the rollback mechanism of the migration command. Failed migration transactions leave earlier ledger versions valid; correct the unapplied migration, test on the restored copy and resume. Prefer forward repair when new application data has been authored.

## Separate frontend and backend releases

The backend image compiles TypeScript and contains only production npm dependencies at runtime. The frontend image serves the Vite bundle with nginx; `/api` proxies to the backend over the private application network. Both run as non-root users with read-only root filesystems and writable temporary directories. Base image digests are pinned. Neither image includes `server/.env`, `.data`, keys or backups; secrets are injected when containers are created.

Prepare endpoint overrides once:

```powershell
npm run deploy:configure
docker compose -f docker-compose.app.yml build backend frontend
docker compose -f docker-compose.app.yml --profile operations run --rm migrations --check
docker compose -f docker-compose.app.yml up -d backend frontend
```

`deploy:configure` reads the existing `server/.env` internally, maps local database/storage hosts to Docker Desktop's `host.docker.internal`, and creates ignored `.data/deployment/app.env` without printing values. It refuses to overwrite an existing file. Container environment combines those endpoint overrides with existing credentials from `server/.env`; no credential reset is performed. If the database or MinIO is remote, explicitly verify that the retained host is reachable. On a Linux host verify the host-gateway route and listening firewall rules. Do not display rendered Compose configuration, because it contains injected secrets.

The default frontend address is `http://127.0.0.1:5173`. For side-by-side verification set `$env:WFC_FRONTEND_PORT='5180'` before Compose commands. There is no externally published backend port; the frontend proxies the API. The existing host API can keep its original port while the container packaging is verified. Set `CLIENT_ORIGIN` consistently if non-browser clients need CORS. External TLS termination is a deployment choice; this local profile binds the frontend to loopback.

Selective updates:

```powershell
docker compose -f docker-compose.app.yml build frontend
docker compose -f docker-compose.app.yml up -d --no-deps frontend
```

This changes only the frontend. For a backend-only compatible release replace `frontend` with `backend`. For a schema/API release: back up; build the new backend image; run the explicit migrations service; verify `migrations --check`; replace backend; verify health/API; replace frontend if its contract changed. The operational services have an `operations` profile and never run implicitly during `up backend frontend`. To adopt an existing unversioned schema in the container, use `run --rm migrations --adopt-baseline`; bucket provisioning is `run --rm storage-init`.

The original infrastructure Compose now includes health checks for PostgreSQL and MinIO but its storage containers were not recreated during this change. A new installation can provision its own independently chosen database/storage services, then run the same explicit baseline/migrations and application release. Verify Postgres major-version data paths before selecting that installation's volume; the legacy `.data/postgres` mount is not the observed live database.

## Development and verification

Keep the existing host development workflow: `npm run dev` and `npm run server:dev`, after `npm run db:check`. Schema work is a separate explicit `db:migrate` command. The normal application must never run `001-baseline` merely because it starts.

Pure/mock checks: `npm run test -- --run server/migrations/runner.test.ts`. Real concurrency verification is opt-in and refuses any database name not matching `wfc_verify_*`:

```powershell
npm run db:verify-isolated -- wfc_verify_upgrade_20260912b
node_modules/.bin/tsx --tsconfig server/tsconfig.json server/services/verifyChangeOrderIsolation.ts wfc_verify_upgrade_20260912b
node_modules/.bin/tsx --tsconfig server/tsconfig.json server/services/verifyProjectTrayIsolation.ts wfc_verify_upgrade_20260912b
node_modules/.bin/tsx --tsconfig server/tsconfig.json server/services/verifyTemplateSnapshotRetention.ts wfc_verify_upgrade_20260912b
node_modules/.bin/tsx --tsconfig server/tsconfig.json server/services/verifyCableIsolation.ts wfc_verify_upgrade_20260912b
node_modules/.bin/tsx --tsconfig server/tsconfig.json server/services/verifyCatalogOwnerDeletion.ts wfc_verify_runner_20260912
```

These commands require an explicitly created migrated isolated database. They derive credentials internally and replace only the database pathname; they never accept `wfc_app` as a test target. The migration concurrency, cable and catalog-retirement checks use random fixtures for real competing requests. Since schema 4 prevents physical catalog deletion, committed catalog fixtures are retired and retained in the isolated database. The catalog check keeps its global revision monotonic. The other verifiers roll back their complete fixture transactions. Keep isolated restored project data access-restricted and remove only explicitly named verification databases under a planned cleanup.

Observed migration checks: fresh install; backup restoration; existing-copy baseline adoption; deliberately failed DDL rollback and successful retry; migration repeat no-op; live compatibility; exact original row-payload fingerprints for all 33 pre-existing tables after migration 002; all 412 tray and 21 support-distance original rows unchanged after 003. Real PostgreSQL races established one stale-update winner/one conflict, one same-key commit/one replay, changed-payload rejection, complete failed-mutation rollback and reciprocal composition-link cycle rejection. Change Order integration checked independent local prices/packaging, catalog update/deletion isolation, pure reads and reopened XLSX exports.

Tray/support integration checked complete new captures, embedded load curves, distinct captures after catalog changes, survival of source deletion, retention of legacy numeric values with unknown snapshot status, and pure reads. Template retention integration checked saved-history reference detection and unreferenced-key cleanup eligibility before metadata deletion; this verifier performs no MinIO object writes.

Earlier schema-3 cable/catalog checks included physical catalog deletion and override conflicts. Schema 4 supersedes those behaviors: cable integration now verifies local override preservation through replacement/sync and retained catalog references after retirement. `verifyMaterialRetirement.ts` verifies all seven categories, preserved rows/edges and graph history, physical DELETE rejection, active-list/archive behavior, Change Order snapshot retention, exact replay and stale concurrent retirement conflicts. It also tests administrator assignment, assigned-project engineer access including Change Orders/Internal NCR, main-settings protection, revocation and role-specific exports. `verifyCatalogOwnerDeletion.ts` remains a compatibility entry point for this verifier. `verifyLocalOverrides.ts` separately verifies repeated replacement, source occurrence deduplication and cross-project/catalog isolation.

Both application images were built and started successfully on `http://127.0.0.1:5180`. Root and SPA routes returned 200; `/api/projects` returned JSON/200 through nginx. Separate forced frontend-only and backend-only recreations were verified by container IDs: each changed only its requested application service, while PostgreSQL and MinIO retained their IDs and mounts. Both application health checks passed after recreation. This proves the existing-storage deployment path; a separate new-machine infrastructure installation was not executed.

The final frozen application sources were rebuilt and both application containers replaced on 2026-09-12. The new backend image passed the one-shot SELECT-only schema/checksum check before replacement and both services became healthy. Post-replacement checks returned 200 for `/`, `/materials`, `/api/projects`, `/api/materials/supports/all` and `/api/materials/cable-types`; deployed support rows include the protected graph revision. PostgreSQL and MinIO container IDs and mounts match the recorded pre-build state. The redacted verification manifest is ignored `.data/deployment/final-build-verification.json`. Final local image digests: backend `sha256:5f20eefe7ea4119552a1e11fc6ac2c80d200f9b5ea68c1a3db501ce28b37a5b0`, frontend `sha256:4959fb9cea37f173128048848dcea023c30dd0834e2027701a99aa496e2ab651`.

The original lockfile remains unchanged. Image installation reported pre-existing dependency advisories (28 across build dependencies, including 2 critical; 15 in backend production dependencies, including 5 high). Dependency upgrades need a focused compatibility/security follow-up. Existing large frontend bundle warnings also remain. These do not change the executed migration/functional results.

## Schema 4 follow-up release, 2026-09-12

Migration 004 is now applied to the existing working database. It introduces obsolete material status, physical catalog DELETE protection and explicit project engineer assignments. Existing material rows stay active and assignments start empty. All original payloads in 36 pre-existing tables compare identically before migration and after application replacement when excluding only the newly added nullable obsolete fields.

The immediate pre-release backup is ignored `.data/backups/wfc_app-2026-09-12T19-09-01-941Z.dump`, SHA-256 `7e5805ee362bca9174d1e572390d2f025c39d0cc18fca29bc8bece313e774c71`. It was restored to `wfc_verify_release_20260912` and upgraded successfully before live application. Separate fresh/upgrade schema-4 checks and guarded snapshot/permission/retirement verifiers also passed.

The final complete suite used `npx vitest run --pool=threads --maxWorkers=2 --testTimeout=60000`: 67 files, 810 tests passed, none failed/skipped, no unhandled errors and process exit 0. The default process pool had an `onTaskUpdate` RPC timeout despite passing assertions; that run was not accepted. Use the recorded thread-pool command to reproduce the clean Windows verification. TypeScript, lint and diff checks passed.

The new backend image passed its one-shot read-only schema/checksum check before replacement. Frontend/backend were updated with `up -d --no-deps backend frontend` at port 5180; both are healthy. PostgreSQL and MinIO retained exact container IDs and mounts. Read endpoints and authentication boundaries passed through nginx, and a post-start database comparison confirmed preservation again. Final image IDs: backend `sha256:1a10db51e8dba4e906d1842525dfe637f356f8f544b235016b4b1ae5674e25d4`, frontend `sha256:bb5db022730a544fef44007fd08ae05f33d363791626485666ef4047cba4a115`. Redacted evidence is in ignored `.data/verification/v4-deployment.json` and `v4-live-after.json`.

Manage grants through **Admin panel > Users > Project access**; assigned users should refresh their session view to receive updated UI permissions. Backend grants/revocations take effect immediately on subsequent requests. Retired materials remain available through **Materials > Obsolete**. See [the current implementation plan](material-recommendations/STAGE_00_IMPLEMENTATION.md) for the exact role matrix, preservation behavior and remaining pilot/review gates.
