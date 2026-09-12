[CmdletBinding()]
param(
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvExamplePath = Join-Path $ProjectRoot ".env.example"
$EnvPath = Join-Path $ProjectRoot ".env"

function New-SecureHex {
    param([int]$ByteCount)

    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Install and start Docker Desktop first."
}

if (-not (Test-Path $EnvExamplePath)) {
    throw "Missing .env.example at $EnvExamplePath"
}

if (-not (Test-Path $EnvPath)) {
    $contents = Get-Content $EnvExamplePath -Raw
    $contents = $contents.Replace(
        "POSTGRES_PASSWORD=CHANGE_ME_WITH_A_RANDOM_PASSWORD",
        "POSTGRES_PASSWORD=$(New-SecureHex -ByteCount 24)"
    )
    $contents = $contents.Replace(
        "MINIO_ROOT_PASSWORD=CHANGE_ME_WITH_A_RANDOM_PASSWORD",
        "MINIO_ROOT_PASSWORD=$(New-SecureHex -ByteCount 24)"
    )
    $contents = $contents.Replace(
        "JWT_SECRET=CHANGE_ME_WITH_A_LONG_RANDOM_SECRET",
        "JWT_SECRET=$(New-SecureHex -ByteCount 64)"
    )

    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($EnvPath, $contents, $utf8WithoutBom)
    Write-Host "Created .env with new random secrets."
}
else {
    Write-Host ".env already exists; it was not overwritten."
}

foreach ($relativePath in @(".data/postgres", ".data/minio", "backups")) {
    New-Item -ItemType Directory -Path (Join-Path $ProjectRoot $relativePath) -Force | Out-Null
}

Push-Location $ProjectRoot
try {
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose configuration validation failed."
    }

    Write-Host "WFC configuration is valid."

    if ($Start) {
        docker compose up -d --build
        if ($LASTEXITCODE -ne 0) {
            throw "WFC startup failed."
        }

        docker compose ps
        Write-Host "WFC: http://localhost:5173"
        Write-Host "MinIO console: http://localhost:9001"
    }
    else {
        Write-Host "Run the script again with -Start to build and start the complete stack."
    }
}
finally {
    Pop-Location
}

