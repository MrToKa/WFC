[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [switch]$ReplaceExistingData
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResolvedBackupPath = (Resolve-Path $BackupPath).Path
$DatabaseBackups = @(Get-ChildItem -LiteralPath $ResolvedBackupPath -Filter "*.backup" -File)
if ($DatabaseBackups.Count -ne 1) { throw "Expected exactly one .backup file." }
$DatabaseBackup = $DatabaseBackups[0]
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

if ($ReplaceExistingData) {
    throw "Automatic replacement is disabled. Use a fresh checkout for migration."
}
foreach ($folder in @($PostgresData, $MinioData)) {
    if ((Test-Path -LiteralPath $folder) -and @(Get-ChildItem -LiteralPath $folder -Force).Count -gt 0) {
        throw "Existing data at $folder. Restore stopped to protect it."
    }
}
$ExistingData = $false
if ($ExistingData -and -not $ReplaceExistingData) {
    throw "PostgreSQL data already exists. Use -ReplaceExistingData only when you intend to replace it."
}

$ContainerRows = @(docker container ls --all --format '{{json .}}')
if ($LASTEXITCODE -ne 0) { throw "Start Docker Desktop first." }
foreach ($row in $ContainerRows) {
    $container = $row | ConvertFrom-Json
    $labels = @($container.Labels -split ',')
    if (($labels -contains 'com.docker.compose.project=wfc') -or
        (@('wfc_app', 'wfc-postgres', 'wfc-minio', 'wfc-api', 'wfc-web') -ccontains $container.Names)) {
        throw "WFC container '$($container.Names)' already exists. Restore stopped to protect its data."
    }
}
Push-Location $ProjectRoot
try {

    if ($ReplaceExistingData) {
        if (Test-Path $PostgresData) { Remove-Item $PostgresData -Recurse -Force }
        if (Test-Path $MinioData) { Remove-Item $MinioData -Recurse -Force }
    }

    New-Item -ItemType Directory -Path $PostgresData -Force | Out-Null
    New-Item -ItemType Directory -Path $MinioData -Force | Out-Null
    & robocopy $MinioBackup $MinioData /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "MinIO copy failed." }

    if ((Test-Path $BackedUpEnv) -and (-not (Test-Path ".env") -or $ReplaceExistingData)) {
        Copy-Item $BackedUpEnv ".env" -Force
    }
    if (-not (Test-Path ".env")) {
        & (Join-Path $PSScriptRoot "setup-wfc.ps1")
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path ".env")) {
            throw "Could not create the local .env configuration."
        }
    }

    $ConfigText = @(docker compose config --format json)
    if ($LASTEXITCODE -ne 0) { throw "Invalid Compose configuration." }
    $Settings = ($ConfigText -join [Environment]::NewLine) | ConvertFrom-Json
    $DbUser = [string]$Settings.services.postgres.environment.POSTGRES_USER
    $DbName = [string]$Settings.services.postgres.environment.POSTGRES_DB
    if ([string]::IsNullOrWhiteSpace($DbUser) -or [string]::IsNullOrWhiteSpace($DbName)) {
        throw "PostgreSQL user and database must be configured."
    }
    docker compose up -d --wait --wait-timeout 120 postgres
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL did not become ready." }

    $ContainerBackup = "/tmp/wfc-restore.backup"
    docker compose cp $DatabaseBackup.FullName "postgres:${ContainerBackup}"
    if ($LASTEXITCODE -ne 0) { throw "Could not copy the database backup into PostgreSQL." }

    docker compose exec -T postgres pg_restore --no-password `
        "--username=$DbUser" "--dbname=$DbName" --no-owner --no-privileges `
        --exit-on-error --single-transaction $ContainerBackup
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL restore failed." }
    docker compose exec -T postgres rm -f $ContainerBackup

    docker compose up -d --build --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw "The restored WFC stack did not start." }

    docker compose ps
    Write-Host "Restore completed. Open http://localhost:5173"
}
finally {
    Pop-Location
}
