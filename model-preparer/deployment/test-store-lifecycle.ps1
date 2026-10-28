[CmdletBinding()]
param([string]$Image = 'node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskNonce = [guid]::NewGuid().ToString()
$taskPrefix = "preparer-stage3-store-$taskNonce"
$taskVolume = "$taskPrefix-state"
$taskProjectRoot = Split-Path $PSScriptRoot -Parent
$taskCreatedContainers = [System.Collections.Generic.List[string]]::new()
$taskReport = [ordered]@{ schemaVersion=1; startedAt=[DateTime]::UtcNow.ToString('o'); image=$Image; volume=$taskVolume; checks=@(); result='FAIL' }
function Docker-Result([string[]]$Arguments) {
    $taskResult = @(& docker @Arguments)
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Docker store fixture command failed.' }
    return $taskResult
}
function Start-Fixture([string]$Name,[string]$Mode,[bool]$Detached) {
    $taskArgs = @('run','--network','none','--hostname','routings-preparer','--label',"codex.stage3.store-fixture=$taskNonce",'--name',$Name,'--mount',"type=volume,source=$taskVolume,target=/state",'--mount',"type=bind,source=$taskProjectRoot,target=/opt/preparer,readonly",'--workdir','/opt/preparer','--entrypoint','node')
    if ($Detached) { $taskArgs += '--detach' }
    $taskArgs += @($Image,'deployment/store-lifecycle.mjs',$Mode)
    $taskCreatedContainers.Add($Name)
    $taskLines = Docker-Result -Arguments $taskArgs
    if ($Detached) {
        for ($taskAttempt=0;$taskAttempt -lt 60;$taskAttempt++) {
            $taskLines = Docker-Result -Arguments @('logs',$Name)
            if (@($taskLines | Where-Object { $_ -match '"ready":true' }).Count) { return ($taskLines | Where-Object { $_ -match '"ready":true' } | Select-Object -Last 1 | ConvertFrom-Json) }
            Start-Sleep -Milliseconds 100
        }
        throw 'Isolated owner fixture did not become ready.'
    }
    return ($taskLines | Select-Object -Last 1 | ConvertFrom-Json)
}
function Check([string]$Name,[bool]$Pass,$Details) {
    $taskReport.checks += [ordered]@{ name=$Name; status=$(if($Pass){'PASS'}else{'FAIL'}); details=$Details }
    if (-not $Pass) { throw "Store lifecycle check failed: $Name" }
}
try {
    Docker-Result -Arguments @('volume','create','--label',"codex.stage3.store-fixture=$taskNonce",$taskVolume) | Out-Null
    $taskFirst = "$taskPrefix-owner1"
    $taskOwner1 = Start-Fixture $taskFirst 'hold' $true
    $taskContender = Docker-Result -Arguments @('exec',$taskFirst,'node','deployment/store-lifecycle.mjs','contend') | Select-Object -Last 1 | ConvertFrom-Json
    Check 'actual live cross-process owner refusal' ($taskContender.error -eq 'LOCK_BUSY' -and -not $taskContender.acquired) $taskContender
    Docker-Result -Arguments @('stop','--time','10',$taskFirst) | Out-Null
    $taskExit = Docker-Result -Arguments @('inspect',$taskFirst,'--format','{{.State.ExitCode}}') | Select-Object -First 1
    $taskReleased = @(Docker-Result -Arguments @('logs',$taskFirst) | Where-Object { $_ -match '"released":true' }).Count -eq 1
    Check 'actual SIGTERM releases lease and preserves unknown WAL' ($taskExit -eq '0' -and $taskReleased) @{exitCode=$taskExit; owner=$taskOwner1}
    $taskGraceful = Start-Fixture "$taskPrefix-graceful" 'recover' $false
    Check 'new private namespace reuses durable state after graceful shutdown' ($taskGraceful.acquired -and $taskGraceful.previous.phase -eq 'submission-unknown' -and $taskGraceful.current.count -eq 2) $taskGraceful
    $taskAbrupt = "$taskPrefix-owner2"
    $taskOwner2 = Start-Fixture $taskAbrupt 'hold' $true
    $taskForeignLive = Start-Fixture "$taskPrefix-foreign-live" 'recover' $false
    Check 'actual foreign namespace refuses a still-live owner with the same PID' (-not $taskForeignLive.acquired -and $taskForeignLive.error -eq 'LOCK_BUSY' -and $taskForeignLive.pidNamespace -ne $taskOwner2.processIdentity.pidNamespace -and $taskForeignLive.pid -eq $taskOwner2.pid) $taskForeignLive
    Docker-Result -Arguments @('kill','--signal','KILL',$taskAbrupt) | Out-Null
    # Namespace inode numbers can be recycled. Occupy the newly allocated
    # namespace so this case observes a genuinely different namespace, rather
    # than labelling matching-inode PID reuse as a guard failure.
    $taskOccupier = Start-Fixture "$taskPrefix-namespace-occupier" 'idle' $true
    $taskRecreated = Start-Fixture "$taskPrefix-recreated" 'recover' $false
    Check 'actual reused PID from foreign namespace cannot authorize recovery' (-not $taskRecreated.acquired -and $taskRecreated.error -eq 'LOCK_BUSY' -and $taskRecreated.pidNamespace -ne $taskOwner2.processIdentity.pidNamespace -and $taskRecreated.pid -eq $taskOwner2.pid -and $taskRecreated.previous.phase -eq 'submission-unknown') @{oldOwner=$taskOwner2; namespaceOccupier=$taskOccupier; recreated=$taskRecreated}
    $taskReport.result = 'PASS'
} finally {
    $taskCleanupErrors = @()
    foreach ($taskName in $taskCreatedContainers) {
        $taskLabel = & docker inspect $taskName --format '{{index .Config.Labels "codex.stage3.store-fixture"}}' 2>$null
        if ($LASTEXITCODE -eq 0 -and $taskLabel -eq $taskNonce) { & docker rm --force $taskName | Out-Null; if ($LASTEXITCODE -ne 0) { $taskCleanupErrors += $taskName } }
    }
    $taskVolumeLabel = & docker volume inspect $taskVolume --format '{{index .Labels "codex.stage3.store-fixture"}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $taskVolumeLabel -eq $taskNonce -and $taskVolume -match '^preparer-stage3-store-[0-9a-f-]{36}-state$') { & docker volume rm $taskVolume | Out-Null; if ($LASTEXITCODE -ne 0) { $taskCleanupErrors += $taskVolume } }
    $taskReport.cleanup = @{ errors=$taskCleanupErrors; ownContainerNames=@($taskCreatedContainers) }
    $taskReport.completedAt = [DateTime]::UtcNow.ToString('o')
    $taskEvidenceBase = Join-Path $PSScriptRoot '.tests'
    if (-not (Test-Path -LiteralPath $taskEvidenceBase)) { New-Item -ItemType Directory -Path $taskEvidenceBase | Out-Null }
    $taskEvidencePath = Join-Path $taskEvidenceBase "store-lifecycle-$taskNonce.json"
    [System.IO.File]::WriteAllText($taskEvidencePath,($taskReport | ConvertTo-Json -Depth 12),[System.Text.UTF8Encoding]::new($false))
    Write-Output "Evidence: $taskEvidencePath"
}
if ($taskReport.result -ne 'PASS' -or $taskReport.cleanup.errors.Count) { exit 1 }
