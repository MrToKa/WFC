[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskNonce=[guid]::NewGuid().ToString(); $taskPrefix="preparer-stage3-recovery-$taskNonce"
$taskRoot=Split-Path $PSScriptRoot -Parent; $taskPackage=Join-Path (Split-Path $taskRoot -Parent) 'routings-model-package'
$taskImage="$taskPrefix`:test"; $taskData="$taskPrefix-data"; $taskWork="$taskPrefix-work"
$taskInstance=[guid]::NewGuid().ToString(); $taskOwner="$taskPrefix-owner"
$taskContainers=[System.Collections.Generic.List[string]]::new(); $taskVolumes=[System.Collections.Generic.List[string]]::new()
$taskReport=[ordered]@{schemaVersion=1;startedAt=[DateTime]::UtcNow.ToString('o');nonce=$taskNonce;checks=@();result='FAIL'}
function Run-Docker([string[]]$Arguments) {
    $taskLines=@(& docker @Arguments); if($LASTEXITCODE -ne 0){throw 'Isolated recovery fixture command failed.'}; return $taskLines
}
function Check([string]$Name,[bool]$Pass,$Details) {
    $taskReport.checks+=@{name=$Name;status=$(if($Pass){'PASS'}else{'FAIL'});details=$Details}; if(-not $Pass){throw "Recovery check failed: $Name"}
}
function Mounts([bool]$ReadOnly) {
    $taskSuffix=if($ReadOnly){',readonly'}else{''}
    return @('--mount',"type=volume,source=$taskData,target=/var/lib/preparer/data$taskSuffix",'--mount',"type=volume,source=$taskWork,target=/var/lib/preparer/work$taskSuffix")
}
function Fixture([string]$Action,[string]$Instance=$taskInstance) {
    return (Run-Docker -Arguments (@('run','--rm','--network','none','--hostname','routings-preparer')+(Mounts $false)+@($taskImage,'/opt/preparer/deployment/docker-recovery-fixture.mjs',$Action,$Instance)) | Select-Object -Last 1 | ConvertFrom-Json)
}
try {
    $taskStageBase=Join-Path $PSScriptRoot '.build'; if(-not(Test-Path -LiteralPath $taskStageBase)){New-Item -ItemType Directory -Path $taskStageBase|Out-Null}
    $taskStage=Join-Path $taskStageBase $taskNonce
    & node (Join-Path $PSScriptRoot 'prepare-build.mjs') $taskRoot $taskPackage $taskStage
    if($LASTEXITCODE -ne 0){throw 'Fixture source staging failed.'}
    Run-Docker -Arguments @('buildx','build','--load','--network=none','--build-context',"preparer=$(Join-Path $taskStage 'preparer')",'--build-context',"package=$(Join-Path $taskStage 'package')",'--tag',$taskImage,'--file',(Join-Path $PSScriptRoot 'test-recovery.Dockerfile'),$PSScriptRoot)|Out-Null
    foreach($taskVolume in @($taskData,$taskWork)) {
        Run-Docker -Arguments @('volume','create','--label',"codex.stage3.recovery-fixture=$taskNonce",'--label','com.docker.compose.project=routings-preparer',$taskVolume)|Out-Null; $taskVolumes.Add($taskVolume)
    }
    $taskContainers.Add($taskOwner)
    Run-Docker -Arguments (@('run','--detach','--network','none','--hostname','routings-preparer','--name',$taskOwner,'--label',"codex.stage3.recovery-fixture=$taskNonce",'--label','com.docker.compose.project=routings-preparer','--label','com.docker.compose.service=preparer','--label','routings.preparer.mode=simulation','--label',"routings.preparer.instance=$taskInstance")+(Mounts $false)+@($taskImage,'/opt/preparer/deployment/docker-recovery-fixture.mjs','hold-unknown',$taskInstance))|Out-Null
    $taskOwnerId=Run-Docker -Arguments @('inspect',$taskOwner,'--format','{{.Id}}')|Select-Object -First 1
    $taskReady=$null
    for($taskAttempt=0;$taskAttempt -lt 200;$taskAttempt++) {
        $taskReadyLines=@(Run-Docker -Arguments @('logs',$taskOwner)|Where-Object{$_ -match '"ready":true'})
        if($taskReadyLines.Count){$taskReady=$taskReadyLines[-1]|ConvertFrom-Json;break}; Start-Sleep -Milliseconds 100
    }
    if(-not $taskReady){throw 'Fixture did not commit its unknown ledger.'}
    $taskLiveRefused=$false
    try{& (Join-Path $PSScriptRoot 'recover-stopped.ps1') -ContainerId $taskOwnerId -HelperImage $taskImage}catch{$taskLiveRefused=$true}
    Check 'host refuses an actually running own container' $taskLiveRefused $taskReady
    Run-Docker -Arguments @('kill','--signal','KILL',$taskOwner)|Out-Null
    $taskStopped=Run-Docker -Arguments @('inspect',$taskOwner,'--format','{{json .State}}')|ConvertFrom-Json
    Check 'genuine SIGKILL preserves stopped container proof' (-not $taskStopped.Running -and $taskStopped.Pid -eq 0 -and $taskStopped.ExitCode -eq 137) @{exitCode=$taskStopped.ExitCode;jobId=$taskReady.jobId}
    $taskSnapshotText=(Run-Docker -Arguments (@('run','--rm','--network','none','--read-only','--hostname','routings-preparer')+(Mounts $true)+@($taskImage,'/opt/preparer/lib/docker-recovery-cli.mjs','snapshot','simulation',$taskInstance)))-join "`n"
    $taskSnapshot=$taskSnapshotText|ConvertFrom-Json
    Fixture 'foreign-lock'|Out-Null; $taskForeignRefused=$false
    try{& (Join-Path $PSScriptRoot 'recover-stopped.ps1') -ContainerId $taskOwnerId -HelperImage $taskImage}catch{$taskForeignRefused=$true}
    Check 'foreign lock instance is preserved and refused' $taskForeignRefused @{}
    Fixture 'restore-foreign'|Out-Null
    Fixture 'tamper'|Out-Null
    $taskContainerFull=Run-Docker -Arguments @('inspect',$taskOwner,'--format','{{.Id}}')|Select-Object -First 1
    $taskImageFull=Run-Docker -Arguments @('inspect',$taskOwner,'--format','{{.Image}}')|Select-Object -First 1
    $taskInput=@{snapshot=$taskSnapshot;attestation=@{schemaVersion=1;containerId=$taskContainerFull;imageId=$taskImageFull;instanceId=$taskInstance;project='routings-preparer';service='preparer';running=$false;pid=0;exclusiveVolumes=$true}}|ConvertTo-Json -Depth 100 -Compress
    $taskInput | & docker run --rm --interactive --network none --read-only --hostname routings-preparer @(Mounts $false) $taskImage /opt/preparer/lib/docker-recovery-cli.mjs recover
    Check 'changed pinned owner snapshot is refused without reset' ($LASTEXITCODE -eq 2) @{}
    Fixture 'restore-owner'|Out-Null
    & (Join-Path $PSScriptRoot 'recover-stopped.ps1') -ContainerId $taskOwnerId -HelperImage $taskImage
    $taskResumed=Fixture 'resume' ([guid]::NewGuid().ToString())
    Check 'new private namespace reuses same job and never repeats submit' ($taskResumed.jobId -eq $taskReady.jobId -and $taskResumed.failure -eq 'SUBMISSION_UNKNOWN' -and $taskResumed.phase -eq 'submission-unknown' -and $taskResumed.acceptedCount -eq 1 -and $taskResumed.submitCalls -eq 0 -and $taskResumed.sameFrozen) $taskResumed
    $taskReport.result='PASS'
} finally {
    $taskCleanup=@()
    foreach($taskName in $taskContainers){$taskLabels=& docker inspect $taskName --format '{{json .Config.Labels}}' 2>$null|ConvertFrom-Json;if($LASTEXITCODE -eq 0 -and $taskLabels.'codex.stage3.recovery-fixture' -eq $taskNonce){& docker rm --force $taskName|Out-Null;if($LASTEXITCODE -ne 0){$taskCleanup+=$taskName}}}
    foreach($taskVolume in $taskVolumes){$taskLabels=& docker volume inspect $taskVolume --format '{{json .Labels}}' 2>$null|ConvertFrom-Json;if($LASTEXITCODE -eq 0 -and $taskLabels.'codex.stage3.recovery-fixture' -eq $taskNonce){& docker volume rm $taskVolume|Out-Null;if($LASTEXITCODE -ne 0){$taskCleanup+=$taskVolume}}}
    & docker image rm $taskImage 2>$null|Out-Null
    $taskReport.cleanup=@{errors=$taskCleanup;containers=@($taskContainers);volumes=@($taskVolumes)}; $taskReport.completedAt=[DateTime]::UtcNow.ToString('o')
    $taskEvidenceBase=Join-Path $PSScriptRoot '.tests';if(-not(Test-Path -LiteralPath $taskEvidenceBase)){New-Item -ItemType Directory -Path $taskEvidenceBase|Out-Null}
    $taskEvidencePath=Join-Path $taskEvidenceBase "stopped-recovery-fixture-$taskNonce.json"
    [System.IO.File]::WriteAllText($taskEvidencePath,($taskReport|ConvertTo-Json -Depth 20),[System.Text.UTF8Encoding]::new($false)); Write-Output "Evidence: $taskEvidencePath"
}
if($taskReport.result -ne 'PASS' -or $taskReport.cleanup.errors.Count){exit 1}
