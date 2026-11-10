#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)
$ErrorActionPreference = 'Stop'
$envPath = Join-Path $Repository '.env.poc'
if (Test-Path -LiteralPath $envPath) {
    throw "Refusing to overwrite an existing .env.poc. Inspect it before continuing."
}
function New-RandomHex([int]$Bytes) {
    $value = New-Object byte[] $Bytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($value) } finally { $generator.Dispose() }
    return [System.BitConverter]::ToString($value).Replace('-', '').ToLowerInvariant()
}
# Only hexadecimal credentials so the constructed PostgreSQL URI is unambiguous.
$contents = @(
    '# Private to Aalborg PoC. Never commit or publish.'
    'POC_WEB_PORT=5181'
    "POC_POSTGRES_PASSWORD=$(New-RandomHex 24)"
    'POC_MINIO_USER=wfc_poc'
    "POC_MINIO_PASSWORD=$(New-RandomHex 24)"
    "POC_JWT_SECRET=$(New-RandomHex 48)"
    "POC_CONVERTER_TOKEN=$(New-RandomHex 32)"
) -join "`n"
# Windows: restrict created secrets to the current Windows account and SYSTEM.
[System.IO.File]::WriteAllText($envPath, $contents + "`n", (New-Object System.Text.UTF8Encoding($false)))
try {
    & icacls.exe $envPath /inheritance:r /grant:r "${env:USERNAME}:(R,W)" 'SYSTEM:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'icacls could not set private-file permissions.' }
} catch {
    Remove-Item -LiteralPath $envPath -Force -ErrorAction SilentlyContinue
    throw "Could not secure POC secrets. No env file retained. $($_.Exception.Message)"
}
Write-Output "Created private POC settings at $envPath. Values are not printed."
