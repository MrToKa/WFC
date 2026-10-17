[CmdletBinding()]
param(
    [ValidateNotNullOrEmpty()][string]$DestinationRoot = 'D:\WFC Back-ups',
    [Parameter(Mandatory = $true)][string]$PostgresContainer,
    [Parameter(Mandatory = $true)][string]$MinioContainer,
    [Parameter(Mandatory = $true)][string[]]$AppContainer,
    [Parameter(Mandatory = $true)][string[]]$WebContainer,
    [Parameter(Mandatory = $true)][string]$HelperImage,
    [Parameter(Mandatory = $true)][string]$PrivateConfigOut,
    [Parameter(Mandatory = $true)][string]$SourceInventory,
    [ValidateRange(40,600)][int]$StopTimeoutSeconds = 45,
    [string]$PostgresUser,
    [string]$PostgresDatabase
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 24 is required.' }
if (-not (Test-Path -LiteralPath $DestinationRoot)) { New-Item -ItemType Directory -Path $DestinationRoot | Out-Null }
$entry = Join-Path $PSScriptRoot 'operations/wfc-ops.mjs'
$arguments = @($entry,'backup','--destination-root',$DestinationRoot,'--postgres-container',$PostgresContainer,'--minio-container',$MinioContainer,'--helper-image',$HelperImage,'--private-config-out',$PrivateConfigOut,'--source-inventory',$SourceInventory,'--stop-timeout-seconds',[string]$StopTimeoutSeconds)
foreach ($name in $AppContainer) { $arguments += @('--app-container',$name) }
foreach ($name in $WebContainer) { $arguments += @('--web-container',$name) }
if ($PostgresUser) { $arguments += @('--postgres-user',$PostgresUser) }
if ($PostgresDatabase) { $arguments += @('--postgres-database',$PostgresDatabase) }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'The coherent backup did not complete. Inspect its controlled report; incomplete output is not restorable.' }
