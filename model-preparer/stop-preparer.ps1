[CmdletBinding()]
param([ValidateRange(5,120)][int]$TimeoutSeconds = 45)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskContainerIds = @(& docker ps -a --filter 'label=com.docker.compose.project=routings-preparer' --filter 'label=com.docker.compose.service=preparer' --format '{{.ID}}')
if ($LASTEXITCODE -ne 0 -or $taskContainerIds.Count -gt 1) { throw 'Own Preparer container identity is ambiguous or Docker is unavailable.' }
foreach ($taskContainerId in $taskContainerIds) {
    & docker stop --time $TimeoutSeconds $taskContainerId
    if ($LASTEXITCODE -ne 0) { throw "Own Preparer stop failed (exit $LASTEXITCODE)." }
}
Write-Output 'Preparer stopped. Persistent data, work, outputs and other applications are preserved.'
