[CmdletBinding()]
param(
    [string]$DestinationRoot = [Environment]::GetFolderPath("Desktop"),
    [string]$PostgresContainer,
    [string]$MinioContainer
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$BackupDir = Join-Path $DestinationRoot "WFC_Backup_$Timestamp"
$PostgresFileName = "wfc_app_$Timestamp.backup"
$PostgresHostPath = Join-Path $BackupDir $PostgresFileName
$PostgresContainerPath = "/tmp/$PostgresFileName"
$MinioBackupDir = Join-Path $BackupDir "minio-data"
$ConfigurationDir = Join-Path $BackupDir "configuration"

function Test-ContainerExists {
    param([string]$Name)
    docker inspect $Name *> $null
    return $LASTEXITCODE -eq 0
}

if (-not $PostgresContainer) {
    $PostgresContainer = if (Test-ContainerExists "wfc-postgres") { "wfc-postgres" } else { "wfc_app" }
}
if (-not $MinioContainer) {
    $MinioContainer = if (Test-ContainerExists "wfc-minio") { "wfc-minio" } else { "minio" }
}

if (-not (Test-ContainerExists $PostgresContainer)) {
    throw "PostgreSQL container '$PostgresContainer' was not found."
}
if (-not (Test-ContainerExists $MinioContainer)) {
    throw "MinIO container '$MinioContainer' was not found."
}

Push-Location $ProjectRoot
try {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    New-Item -ItemType Directory -Path $ConfigurationDir -Force | Out-Null

    Write-Host "[1/3] Backing up PostgreSQL..."
    docker exec $PostgresContainer sh -c `
        "pg_dump -U `$POSTGRES_USER -d `$POSTGRES_DB -F c -f '$PostgresContainerPath'"
    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL backup failed."
    }

    docker cp "${PostgresContainer}:${PostgresContainerPath}" $PostgresHostPath
    if ($LASTEXITCODE -ne 0) {
        throw "Could not copy the PostgreSQL backup to Windows."
    }
    docker exec $PostgresContainer rm -f $PostgresContainerPath

    Write-Host "[2/3] Backing up MinIO..."
    docker stop $MinioContainer | Out-Null
    try {
        docker cp "${MinioContainer}:/data/." $MinioBackupDir
        if ($LASTEXITCODE -ne 0) {
            throw "MinIO backup failed."
        }
    }
    finally {
        docker start $MinioContainer | Out-Null
    }

    Write-Host "[3/3] Backing up configuration..."
    Copy-Item "docker-compose.yml" $ConfigurationDir
    Copy-Item ".env.example" $ConfigurationDir
    if (Test-Path ".env") {
        Copy-Item ".env" (Join-Path $ConfigurationDir ".env")
    }
    if (Test-Path "server/.env") {
        Copy-Item "server/.env" (Join-Path $ConfigurationDir "server.env")
    }
    docker inspect $PostgresContainer $MinioContainer | Set-Content `
        -Path (Join-Path $ConfigurationDir "containers-inspect.json") `
        -Encoding UTF8

    $Commit = "not available"
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $ResolvedCommit = git rev-parse HEAD 2>$null
        if ($LASTEXITCODE -eq 0) {
            $Commit = $ResolvedCommit
        }
    }

    $DatabaseHash = (Get-FileHash -Algorithm SHA256 $PostgresHostPath).Hash
    @"
WFC Backup
==========
Created: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Git commit: $Commit
PostgreSQL file: $PostgresFileName
PostgreSQL SHA256: $DatabaseHash
PostgreSQL container: $PostgresContainer
MinIO container: $MinioContainer
MinIO data: minio-data
Configuration: configuration

The configuration folder contains secrets. Keep this backup private.
"@ | Set-Content -Path (Join-Path $BackupDir "backup-info.txt") -Encoding UTF8

    Write-Host "Backup completed: $BackupDir"
    explorer.exe $BackupDir
}
finally {
    Pop-Location
}
