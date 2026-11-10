# Aalborg Routings Builder — independent Docker development environment

This is a **non-destructive staging plan**, not a verified deployment. Do not edit or run the existing production `docker-compose.yml` to launch this PoC.

## Known inventory — user supplied 2026-11-10
- Existing `wfc-app-frontend-1` and `wfc-app-backend-1` healthy at loopback 5180.
- Existing `wfc_app` PostgreSQL (211 MiB), `wfc-minio` bind mount in main WFC checkout (1.7 GiB), `wfc-app_model-imports` (4 KiB).
- Two old `*-preparer-rollback-*` containers were restarting; **do not run --remove-orphans or prune**.
- Aalborg project historically `0c0007c9-d73f-4d13-bc87-601c544727b7`, active version historically `9dbe511d-9c51-49e8-bb4a-b52033b98f35`; verify IDs in *current* source DB.
- Main checkout branch is diverged from origin main. Work only from separate branch/worktree `C:\Users\todor.chankov\source\WFC-aalborg-poc`.

## Stage 0A — configuration validation, safe to run now

In PowerShell **inside the POC worktree**:

```powershell
Set-Location 'C:\Users\todor.chankov\source\WFC-aalborg-poc'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\poc\initialize-poc-env.ps1
docker compose --project-name wfc-aalborg-poc --env-file .env.poc -f compose.poc.yaml config --quiet
docker compose --project-name wfc-aalborg-poc --env-file .env.poc -f compose.poc.yaml config --services
```

Do not post `docker compose config` without `--quiet`: rendered output includes private credentials. `.env.poc` is gitignored.

The compose project has unique container/volume/network names, no `container_name`, and no host-bound database or object-store ports. Only web is planned on loopback 5181. The `app` profile prevents accidentally starting an empty/migrating backend while preparing data.

## Stage 0B — data consistency / backup gate

**DO NOT restore or start the application profile until source and backup have been verified.**

1. Check exact source Postgres DB name, active Aalborg project/version and readiness/health, backend DB endpoint, MinIO bucket and model-storage ownership. Avoid printing application credentials.
2. Use the existing `scripts/operations/wfc-ops.mjs` mechanism, with source roles and verified backup private config, only after matching the documented supported profile. Refer to `docs/routings-viewer/10-operations-backup-restore.md`; backup requires a coherent cold boundary. A naive hot filesystem copy of MinIO or PG volume does **not** qualify.
3. Verify backup manifest/readback and restore into independent PoC storage. For the PoC you can instead export/import only the authenticated Aalborg project through a separately validated data migration procedure. Never import any original production `users`/tokens without considering necessary credential isolation.
4. The original published SVF model uses the `wfc-models` object store bucket. Validate ready-model resources, manifest, exact fingerprint and no missing objects on the restored stack.
5. Run a diff of all original Postgres/MinIO mounts and container identities before/after. Only then approve the POC app startup.

Stage 0A can create **empty PoC** data services without touching source:
```powershell
docker compose --project-name wfc-aalborg-poc --env-file .env.poc -f compose.poc.yaml up -d postgres minio
```

This deliberately starts **no backend and no web**. Do not attempt the app profile against empty data and expect an Aalborg model: the backend automatically initializes its own database on startup.

After independent restoration and identity checks (separate runbook/script still required):
```powershell
docker compose --project-name wfc-aalborg-poc --env-file .env.poc -f compose.poc.yaml --profile app up -d --build api web
```

Open `http://127.0.0.1:5181` locally. Verify WFC health, Aalborg active version, Viewer model load, no external model requests, and original 5180 remains healthy.

## Rollback and stop conditions

- Stop only the POC project: `docker compose --project-name wfc-aalborg-poc --env-file .env.poc -f compose.poc.yaml --profile app stop`.
- **Never use** `down -v`, `system prune`, `volume prune`, `--remove-orphans`, or delete original MinIO folders.
- Stop if backup not verified, source model/version differs, port 5181 occupied, source data being altered, Docker Desktop storage near capacity, or migration cannot restore a coherent snapshot.
- No production WFC service needs to be removed or updated to deploy the PoC.
