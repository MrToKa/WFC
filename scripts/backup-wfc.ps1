[CmdletBinding()]
param(
    [string]$DestinationRoot = [Environment]::GetFolderPath("Desktop"),
    [string]$PostgresContainer,
    [string]$MinioContainer,
    [ValidateNotNullOrEmpty()]
    [string]$PostgresUser = "postgres",
    [ValidateNotNullOrEmpty()]
    [string]$PostgresDatabase = "wfc_app"
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

# Enumerate containers successfully instead of probing nonexistent names.
# Docker Desktop may show a Compose service name rather than the container name.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Install and start Docker Desktop first."
}

$ContainerRows = @(docker container ls --all --format '{{json .}}')
if ($LASTEXITCODE -ne 0) {
    throw "Could not list Docker containers. Check that Docker Desktop is running."
}
$AvailableContainers = @($ContainerRows | ForEach-Object { $_ | ConvertFrom-Json })
$ContainerSummary = ($AvailableContainers | ForEach-Object {
    "{0} [{1}; {2}]" -f $_.Names, $_.Image, $_.State
}) -join "; "

function Resolve-BackupContainer {
    param(
        [string]$ExplicitName,
        [string]$Service,
        [string[]]$KnownNames,
        [string]$ImagePattern,
        [string]$ParameterName
    )

    if ($ExplicitName) {
        $matches = @($AvailableContainers | Where-Object { $_.Names -ceq $ExplicitName })
        if ($matches.Count -ne 1) {
            throw "Container '$ExplicitName' was not found. Available: $ContainerSummary. Omit -$ParameterName for auto-detection or pass its exact name."
        }
        return $matches[0].Names
    }

    # Prefer the WFC Compose service, then established names, then image.
    # Never pick an arbitrary container when multiple candidates match.
    $matches = @($AvailableContainers | Where-Object {
        $labels = @($_.Labels -split ',')
        ($labels -contains 'com.docker.compose.project=wfc') -and
        ($labels -contains "com.docker.compose.service=$Service")
    })
    if ($matches.Count -eq 0) {
        $matches = @($AvailableContainers | Where-Object { $KnownNames -ccontains $_.Names })
    }
    if ($matches.Count -eq 0) {
        $matches = @($AvailableContainers | Where-Object { $_.Image -match $ImagePattern })
    }
    if ($matches.Count -ne 1) {
        throw "Cannot uniquely identify $Service. Pass -$ParameterName with the exact container name. Available: $ContainerSummary"
    }
    return $matches[0].Names
}

$PostgresContainer = Resolve-BackupContainer -ExplicitName $PostgresContainer -Service 'postgres' -KnownNames @('wfc-postgres', 'wfc_app') -ImagePattern '(^|/)postgres(:|@|$)' -ParameterName 'PostgresContainer'
$MinioContainer = Resolve-BackupContainer -ExplicitName $MinioContainer -Service 'minio' -KnownNames @('wfc-minio', 'minio') -ImagePattern '(^|/)minio/minio(:|@|$)' -ParameterName 'MinioContainer'

Write-Host "PostgreSQL container: $PostgresContainer"
Write-Host "MinIO container: $MinioContainer"

# Fail before creating a backup or stopping MinIO if the connection is invalid.
Write-Host "Checking database '$PostgresDatabase' as '$PostgresUser'..."
docker exec $PostgresContainer psql --no-password `
    "--username=$PostgresUser" "--dbname=$PostgresDatabase" `
    --set=ON_ERROR_STOP=1 --tuples-only --no-align --command='SELECT 1;'
if ($LASTEXITCODE -ne 0) {
    throw "Database connection failed. Check -PostgresUser and -PostgresDatabase."
}

Push-Location $ProjectRoot
try {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    New-Item -ItemType Directory -Path $ConfigurationDir -Force | Out-Null

    Write-Host "[1/3] Backing up PostgreSQL..."
    # Pass arguments directly; POSTGRES_USER/POSTGRES_DB need not exist in
    # containers created with the official image's initialization defaults.
    docker exec $PostgresContainer pg_dump --no-password `
        "--username=$PostgresUser" "--dbname=$PostgresDatabase" `
        --format=custom "--file=$PostgresContainerPath"
    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL backup failed."
    }

    docker exec $PostgresContainer pg_restore --list $PostgresContainerPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "The PostgreSQL archive could not be read. Backup aborted."
    }

    docker cp "${PostgresContainer}:${PostgresContainerPath}" $PostgresHostPath
    if ($LASTEXITCODE -ne 0) {
        throw "Could not copy the PostgreSQL backup to Windows."
    }
    docker exec $PostgresContainer rm -f $PostgresContainerPath

    Write-Host "[2/3] Backing up MinIO..."
    docker stop $MinioContainer | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not stop MinIO; backup aborted." }
    try {
        docker cp "${MinioContainer}:/data/." $MinioBackupDir
        if ($LASTEXITCODE -ne 0) {
            throw "MinIO backup failed."
        }
    }
    finally {
        docker start $MinioContainer | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not restart MinIO. Start it manually." }
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
PostgreSQL user: $PostgresUser
PostgreSQL database: $PostgresDatabase
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
