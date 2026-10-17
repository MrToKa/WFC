[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [Parameter(Mandatory = $true)][string]$TargetRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^wfc-restore-[a-z0-9][a-z0-9-]{2,48}$')][string]$Project,
    [Parameter(Mandatory = $true)][ValidateRange(1024,65535)][int]$HttpPort,
    [Parameter(Mandatory = $true)][string]$PrivateConfig,
    [string]$HelperImage,
    [switch]$ReplaceExistingData
)
$ErrorActionPreference = 'Stop'
if ($ReplaceExistingData) { throw 'Replacement of existing data is disabled. Restore requires a new target directory, project, volumes and free loopback port.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 24 is required.' }
$entry = Join-Path $PSScriptRoot 'operations/wfc-ops.mjs'
$arguments = @($entry,'restore','--backup',$BackupPath,'--target-root',$TargetRoot,'--project',$Project,'--http-port',[string]$HttpPort,'--private-config',$PrivateConfig)
if ($HelperImage) { $arguments += @('--helper-image',$HelperImage) }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Restore failed its quarantine checks. No working WFC environment was replaced; retain the controlled target report for diagnosis.' }
