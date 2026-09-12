# Portable WFC deployment and migration

This configuration runs the complete WFC stack on Docker Desktop:

- `wfc-web`: React production build served by Nginx
- `wfc-api`: Express/Node.js API
- `wfc-postgres`: PostgreSQL 18
- `wfc-minio`: object storage and console

Persistent data stays under `.data/`, which is excluded from Git. Secrets stay in `.env`, which is
also excluded from Git. Never commit `.env` or a backup containing it.

## First installation on a Windows desktop

1. Install Git and Docker Desktop and start Docker Desktop.
2. Clone the repository and enter it:

   ```powershell
   git clone https://github.com/MrToKa/WFC.git
   Set-Location WFC
   ```

3. Generate local secrets and start all services:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-wfc.ps1 -Start
   ```

4. Open WFC at `http://localhost:5173`. MinIO administration is available at
   `http://localhost:9001`.

For access from another computer over the VPN/LAN, use the desktop computer's hostname or IP,
for example `http://DESKTOP-NAME:5173`, and allow inbound TCP 5173 in Windows Firewall only for the
trusted network/VPN profile.

## Create a complete backup

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-wfc.ps1
```

The script creates a timestamped folder under `D:\WFC Back-ups` (created automatically) containing:

- a PostgreSQL custom-format dump;
- all MinIO objects;
- the local `.env` and Compose configuration;
- backup metadata and a SHA-256 checksum for the database dump.

It auto-detects both the new container names (`wfc-postgres`, `wfc-minio`) and the current legacy
names (`wfc_app`, `minio`). You can also pass `-PostgresContainer` and `-MinioContainer` explicitly.

MinIO is stopped briefly while its data is copied. PostgreSQL remains online because `pg_dump`
creates a consistent logical backup. Treat the backup as sensitive because it contains `.env`.

## Restore on a new desktop

1. Clone the repository and copy the complete backup folder to the new computer. If the old
   installation had no root `.env`, the restore script generates new local secrets automatically.
2. Restore into a fresh checkout:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\restore-wfc.ps1 `
       -BackupPath "D:\WFC Back-ups\WFC_Backup_YYYY-MM-DD_HH-mm-ss"
   ```

3. Open `http://localhost:5173` and verify users, projects, uploaded files, and templates.

The restore script refuses to overwrite an existing PostgreSQL data directory unless
`-ReplaceExistingData` is supplied. Use that switch only when the target data can be replaced.

## Useful operations

```powershell
docker compose ps
docker compose logs -f api
docker compose up -d --build
docker compose down
```

`docker compose down` does not delete the bind-mounted `.data` folders. Do not add `-v` to cleanup
commands unless you have verified the exact target and have a tested backup.

## Security notes

- The setup script creates fresh random PostgreSQL, MinIO, and JWT secrets.
- Existing credentials previously committed to Git must be considered exposed and replaced.
- Keep the repository source free of secrets; only `.env.example` belongs in Git.
- Restrict ports 5173, 5434, 9000, and 9001 to the local machine or trusted VPN/LAN where possible.
- A backup is valid only after a test restore confirms both database records and MinIO files.
