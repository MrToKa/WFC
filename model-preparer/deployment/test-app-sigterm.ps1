[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$taskNonce=[guid]::NewGuid().ToString();$taskPrefix="preparer-stage3-app-$taskNonce";$taskImage="$taskPrefix`:test"
$taskRoot=Split-Path $PSScriptRoot -Parent;$taskPackage=Join-Path (Split-Path $taskRoot -Parent) 'routings-model-package'
$taskContainers=[System.Collections.Generic.List[string]]::new();$taskVolumes=[System.Collections.Generic.List[string]]::new()
$taskReport=[ordered]@{schemaVersion=1;startedAt=[DateTime]::UtcNow.ToString('o');nonce=$taskNonce;checks=@();result='FAIL'}
function Run-Docker([string[]]$Arguments){$taskLines=@(& docker @Arguments);if($LASTEXITCODE-ne 0){throw 'Isolated app SIGTERM fixture failed.'};return $taskLines}
function Check([string]$Name,[bool]$Pass,$Details){$taskReport.checks+=@{name=$Name;status=$(if($Pass){'PASS'}else{'FAIL'});details=$Details};if(-not $Pass){throw "App SIGTERM check failed: $Name"}}
try{
    $taskStageBase=Join-Path $PSScriptRoot '.build';if(-not(Test-Path -LiteralPath $taskStageBase)){New-Item -ItemType Directory -Path $taskStageBase|Out-Null}
    $taskStage=Join-Path $taskStageBase $taskNonce
    & node (Join-Path $PSScriptRoot 'prepare-build.mjs') $taskRoot $taskPackage $taskStage;if($LASTEXITCODE-ne 0){throw 'Fixture staging failed.'}
    Run-Docker -Arguments @('buildx','build','--load','--network=none','--build-context',"preparer=$(Join-Path $taskStage 'preparer')",'--build-context',"package=$(Join-Path $taskStage 'package')",'--tag',$taskImage,'--file',(Join-Path $PSScriptRoot 'test-recovery.Dockerfile'),$PSScriptRoot)|Out-Null
    foreach($taskPhase in @('capture','download','package')){
        $taskPhaseVolumes=@();foreach($taskKind in @('data','work','outputs')){$taskVolume="$taskPrefix-$taskPhase-$taskKind";Run-Docker -Arguments @('volume','create','--label',"codex.stage3.app-fixture=$taskNonce",$taskVolume)|Out-Null;$taskVolumes.Add($taskVolume);$taskPhaseVolumes+=@('--mount',"type=volume,source=$taskVolume,target=/var/lib/preparer/$taskKind")}
        $taskName="$taskPrefix-$taskPhase";$taskContainers.Add($taskName);$taskInstance=[guid]::NewGuid().ToString()
        Run-Docker -Arguments (@('run','--detach','--network','none','--hostname','routings-preparer','--name',$taskName,'--label',"codex.stage3.app-fixture=$taskNonce")+$taskPhaseVolumes+@($taskImage,'/opt/preparer/deployment/app-sigterm-fixture.mjs',$taskPhase,'run',$taskInstance))|Out-Null
        $taskReady=$null
        for($taskAttempt=0;$taskAttempt-lt 300;$taskAttempt++){$taskLines=@(Run-Docker -Arguments @('logs',$taskName)|Where-Object{$_-match '"ready":true'});if($taskLines.Count){$taskReady=$taskLines[-1]|ConvertFrom-Json;break};$taskRunning=Run-Docker -Arguments @('inspect',$taskName,'--format','{{.State.Running}}')|Select-Object -First 1;if($taskRunning-ne 'true'){throw "App fixture stopped before $taskPhase barrier."};Start-Sleep -Milliseconds 100}
        if(-not $taskReady){throw 'App fixture never reached its local-byte barrier.'}
        Run-Docker -Arguments @('stop','--time','20',$taskName)|Out-Null
        $taskState=Run-Docker -Arguments @('inspect',$taskName,'--format','{{json .State}}')|ConvertFrom-Json
        $taskStopped=@(Run-Docker -Arguments @('logs',$taskName)|Where-Object{$_-match '"stopped":true'}).Count-eq 1
        Check "$taskPhase actual SIGTERM drains app and exits normally" ($taskState.ExitCode-eq 0 -and $taskStopped) @{barrier=$taskReady;exitCode=$taskState.ExitCode}
        $taskInspect=Run-Docker -Arguments (@('run','--rm','--network','none','--hostname','routings-preparer')+$taskPhaseVolumes+@($taskImage,'/opt/preparer/deployment/app-sigterm-fixture.mjs',$taskPhase,'inspect',([guid]::NewGuid().ToString())))|Select-Object -Last 1|ConvertFrom-Json
        $taskCorrect=$taskInspect.operationStatus-eq 'interrupted' -and $taskInspect.remainingLocks-eq 0 -and $taskInspect.submitCalls-eq 0
        if($taskPhase-eq 'capture'){$taskCorrect=$taskCorrect -and $taskInspect.jobCount-eq 0 -and $taskInspect.acceptedCount-eq 0 -and $taskReady.capturedTemporaryBytes-gt 0}
        elseif($taskPhase-eq 'download'){$taskCorrect=$taskCorrect -and $taskInspect.beforeStatus-eq 'interrupted' -and $taskInspect.beforeCompleted-eq 1 -and $taskInspect.acceptedCount-eq 1 -and $taskReady.partialBytes-gt 0}
        else{$taskCorrect=$taskCorrect -and $taskInspect.beforeStatus-eq 'interrupted' -and -not $taskInspect.hasPackage -and $taskInspect.acceptedCount-eq 1 -and $taskReady.zipStagingBytes-gt 0}
        Check "$taskPhase restart preserves conservative local state" $taskCorrect $taskInspect
        if($taskPhase-ne 'capture'){
            $taskResume=Run-Docker -Arguments (@('run','--rm','--network','none','--hostname','routings-preparer')+$taskPhaseVolumes+@($taskImage,'/opt/preparer/deployment/app-sigterm-fixture.mjs',$taskPhase,'resume',([guid]::NewGuid().ToString())))|Select-Object -Last 1|ConvertFrom-Json
            $taskResumePass=$taskResume.acceptedCount-eq 1 -and $taskResume.submitCalls-eq 0 -and $taskResume.remainingLocks-eq 0 -and $taskResume.resumedStatus-eq 'succeeded'
            if($taskPhase-eq 'download'){$taskResumePass=$taskResumePass -and $taskResume.afterCompleted-eq 3 -and $taskResume.afterStatus-eq 'downloaded'}else{$taskResumePass=$taskResumePass -and $taskResume.hasPackage -and $taskResume.afterStatus-eq 'packaged'}
            Check "$taskPhase explicit local continuation performs no extra submit" $taskResumePass $taskResume
        }
    }
    $taskReport.result='PASS'
}finally{
    $taskErrors=@()
    foreach($taskName in $taskContainers){$taskLabels=& docker inspect $taskName --format '{{json .Config.Labels}}' 2>$null|ConvertFrom-Json;if($LASTEXITCODE-eq 0 -and $taskLabels.'codex.stage3.app-fixture'-eq $taskNonce){& docker rm --force $taskName|Out-Null;if($LASTEXITCODE-ne 0){$taskErrors+=$taskName}}}
    foreach($taskVolume in $taskVolumes){$taskLabels=& docker volume inspect $taskVolume --format '{{json .Labels}}' 2>$null|ConvertFrom-Json;if($LASTEXITCODE-eq 0 -and $taskLabels.'codex.stage3.app-fixture'-eq $taskNonce){& docker volume rm $taskVolume|Out-Null;if($LASTEXITCODE-ne 0){$taskErrors+=$taskVolume}}}
    & docker image rm $taskImage 2>$null|Out-Null
    $taskReport.cleanup=@{errors=$taskErrors;containers=@($taskContainers);volumes=@($taskVolumes)};$taskReport.completedAt=[DateTime]::UtcNow.ToString('o')
    $taskEvidenceBase=Join-Path $PSScriptRoot '.tests';if(-not(Test-Path -LiteralPath $taskEvidenceBase)){New-Item -ItemType Directory -Path $taskEvidenceBase|Out-Null};$taskEvidencePath=Join-Path $taskEvidenceBase "app-sigterm-$taskNonce.json"
    [System.IO.File]::WriteAllText($taskEvidencePath,($taskReport|ConvertTo-Json -Depth 20),[System.Text.UTF8Encoding]::new($false));Write-Output "Evidence: $taskEvidencePath"
}
if($taskReport.result-ne 'PASS' -or $taskReport.cleanup.errors.Count){exit 1}
