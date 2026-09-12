[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [switch]$ReplaceExistingData
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResolvedBackupPath = (Resolve-Path $BackupPath).Path
$DatabaseBackup = Get-ChildItem $ResolvedBackupPath -Filter "*.backup" | Select-Object -First 1
$MinioBackup = Join-Path $ResolvedBackupPath "minio-data"
$BackedUpEnv = Join-Path $ResolvedBackupPath "configuration/.env"
$PostgresData = Join-Path $ProjectRoot ".data/postgres"
$MinioData = Join-Path $ProjectRoot ".data/minio"

if (-not $DatabaseBackup) {
    throw "No PostgreSQL .backup file was found in $ResolvedBackupPath"
}
if (-not (Test-Path $MinioBackup)) {
    throw "Missing MinIO backup directory: $MinioBackup"
}

$ExistingData = (Test-Path $PostgresData) -and (Get-ChildItem $PostgresData -Force -ErrorAction SilentlyContinue)
if ($ExistingData -and -not $ReplaceExistingData) {
    throw "PostgreSQL data already exists. Use -ReplaceExistingData only when you intend to replace it."
}

Push-Location $ProjectRoot
try {
    docker compose down

    if ($ReplaceExistingData) {
        if (Test-Path $PostgresData) { Remove-Item $PostgresData -Recurse -Force }
        if (Test-Path $MinioData) { Remove-Item $MinioData -Recurse -Force }
    }

    New-Item -ItemType Directory -Path $PostgresData -Force | Out-Null
    New-Item -ItemType Directory -Path $MinioData -Force | Out-Null
    Copy-Item (Join-Path $MinioBackup "*") $MinioData -Recurse -Force

    if ((Test-Path $BackedUpEnv) -and (-not (Test-Path ".env") -or $ReplaceExistingData)) {
        Copy-Item $BackedUpEnv ".env" -Force
    }
    if (-not (Test-Path ".env")) {
        & (Join-Path $PSScriptRoot "setup-wfc.ps1")
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path ".env")) {
            throw "Could not create the local .env configuration."
        }
    }

    docker compose up -d postgres minio
    if ($LASTEXITCODE -ne 0) { throw "Could not start PostgreSQL and MinIO." }

    $Ready = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        docker compose exec -T postgres sh -c "pg_isready -U `$POSTGRES_USER -d `$POSTGRES_DB" | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $Ready = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $Ready) { throw "PostgreSQL did not become ready." }

    $ContainerBackup = "/tmp/wfc-restore.backup"
    docker compose cp $DatabaseBackup.FullName "postgres:${ContainerBackup}"
    if ($LASTEXITCODE -ne 0) { throw "Could not copy the database backup into PostgreSQL." }

    docker compose exec -T postgres sh -c `
        "pg_restore -U `$POSTGRES_USER -d `$POSTGRES_DB --clean --if-exists --no-owner --no-privileges '$ContainerBackup'"
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL restore failed." }
    docker compose exec -T postgres rm -f $ContainerBackup

    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw "The restored WFC stack did not start." }

    docker compose ps
    Write-Host "Restore completed. Open http://localhost:5173"
}
finally {
    Pop-Location
}
