[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ContainerId,[Parameter(Mandatory=$true)][string]$HelperImage,[string]$EvidenceDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($ContainerId -notmatch '^[a-f0-9]{12,64}$' -or $HelperImage -notmatch '^[a-z0-9][a-z0-9._/:@-]+$') { throw 'Invalid recovery identity.' }
function Docker-Read([string[]]$Arguments) {
    $taskOutput = @(& docker @Arguments)
    if ($LASTEXITCODE -ne 0) { throw 'Stopped-container identity could not be verified.' }
    return ($taskOutput -join "`n")
}
function Docker-Label([string]$Id,[string]$Name,[bool]$Volume=$false) {
    $taskArgs=if($Volume){@('volume','inspect',$Id,'--format','{{json .Labels}}')}else{@('inspect',$Id,'--format','{{json .Config.Labels}}')}
    $taskLabels= Docker-Read -Arguments $taskArgs | ConvertFrom-Json
    $taskProperty=$taskLabels.PSObject.Properties[$Name]
    if(-not $taskProperty){return ''}; return [string]$taskProperty.Value
}
function Attest-Stopped {
    $taskId = Docker-Read -Arguments @('inspect',$ContainerId,'--format','{{.Id}}')
    $taskImage = Docker-Read -Arguments @('inspect',$taskId,'--format','{{.Image}}')
    $taskState = Docker-Read -Arguments @('inspect',$taskId,'--format','{{json .State}}') | ConvertFrom-Json
    $taskProject = Docker-Label $taskId 'com.docker.compose.project'
    $taskService = Docker-Label $taskId 'com.docker.compose.service'
    $taskInstance = Docker-Label $taskId 'routings.preparer.instance'
    $taskMode = Docker-Label $taskId 'routings.preparer.mode'
    $taskHostname = Docker-Read -Arguments @('inspect',$taskId,'--format','{{.Config.Hostname}}')
    if ($taskProject -ne 'routings-preparer' -or $taskService -ne 'preparer' -or $taskHostname -ne 'routings-preparer' -or $taskMode -notin @('closed','simulation','live') -or $taskInstance -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' -or $taskState.Running -or $taskState.Pid -ne 0) { throw 'Recovery requires an exact own instance proven stopped by Docker.' }
    if ((Docker-Read -Arguments @('image','inspect',$taskImage,'--format','{{.Id}}')) -ne $taskImage) { throw 'Original stopped image identity is ambiguous.' }
    $taskMounts = Docker-Read -Arguments @('inspect',$taskId,'--format','{{json .Mounts}}') | ConvertFrom-Json
    $taskData = @($taskMounts | Where-Object { $_.Destination -eq '/var/lib/preparer/data' -and $_.Type -eq 'volume' })
    $taskWork = @($taskMounts | Where-Object { $_.Destination -eq '/var/lib/preparer/work' -and $_.Type -eq 'volume' })
    if ($taskData.Count -ne 1 -or $taskWork.Count -ne 1 -or $taskData[0].Name -eq $taskWork[0].Name) { throw 'Stopped own persistent mounts are ambiguous.' }
    foreach ($taskVolume in @($taskData[0].Name,$taskWork[0].Name)) {
        if ($taskVolume -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]+$' -or (Docker-Label $taskVolume 'com.docker.compose.project' $true) -ne 'routings-preparer') { throw 'Persistent volume does not belong to this project.' }
    }
    $taskRunning = @((Docker-Read -Arguments @('ps','--format','{{.ID}}')) -split "`n" | Where-Object { $_ })
    foreach ($taskOtherId in $taskRunning) {
        $taskOtherMounts = Docker-Read -Arguments @('inspect',$taskOtherId,'--format','{{json .Mounts}}') | ConvertFrom-Json
        if (@($taskOtherMounts | Where-Object { $_.Type -eq 'volume' -and $_.Name -in @($taskData[0].Name,$taskWork[0].Name) }).Count) { throw 'A running container still mounts the preserved state; recovery is refused.' }
    }
    return [ordered]@{ attestation=[ordered]@{schemaVersion=1;containerId=$taskId;imageId=$taskImage;instanceId=$taskInstance;project=$taskProject;service=$taskService;running=$false;pid=0;exclusiveVolumes=$true};mode=$taskMode;dataVolume=$taskData[0].Name;workVolume=$taskWork[0].Name }
}
$taskFirst = Attest-Stopped
$taskMountArguments = @('--mount',"type=volume,source=$($taskFirst.dataVolume),target=/var/lib/preparer/data,readonly",'--mount',"type=volume,source=$($taskFirst.workVolume),target=/var/lib/preparer/work,readonly")
$taskSnapshotText = Docker-Read (@('run','--rm','--network','none','--read-only','--hostname','routings-preparer','--entrypoint','node') + $taskMountArguments + @($HelperImage,'/opt/preparer/lib/docker-recovery-cli.mjs','snapshot-base64',$taskFirst.mode,$taskFirst.attestation.instanceId))
$taskTransport = $taskSnapshotText | ConvertFrom-Json
$taskSnapshot = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($taskTransport.snapshotBase64)) | ConvertFrom-Json
$taskSecond = Attest-Stopped
if (($taskFirst | ConvertTo-Json -Depth 10 -Compress) -ne ($taskSecond | ConvertTo-Json -Depth 10 -Compress)) { throw 'Docker stopped-container identity changed between checks.' }
$taskInput = @{snapshotBase64=$taskTransport.snapshotBase64;attestation=$taskSecond.attestation} | ConvertTo-Json -Depth 100 -Compress
$taskWritableMounts = @('--mount',"type=volume,source=$($taskFirst.dataVolume),target=/var/lib/preparer/data",'--mount',"type=volume,source=$($taskFirst.workVolume),target=/var/lib/preparer/work,readonly")
$taskResult = $taskInput | & docker run --rm --interactive --network none --read-only --hostname routings-preparer --entrypoint node @taskWritableMounts $HelperImage /opt/preparer/lib/docker-recovery-cli.mjs recover
if ($LASTEXITCODE -ne 0) { throw 'Controlled recovery refused the pinned state; no reset is permitted.' }
$taskResultObject = ($taskResult -join "`n") | ConvertFrom-Json
if (-not $EvidenceDirectory) { $EvidenceDirectory = Join-Path $PSScriptRoot '.tests' }
if (-not (Test-Path -LiteralPath $EvidenceDirectory)) { New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null }
$taskEvidencePath = Join-Path $EvidenceDirectory ("stopped-recovery-" + [guid]::NewGuid().ToString() + '.json')
[System.IO.File]::WriteAllText($taskEvidencePath,(@{schemaVersion=1;checkedAt=[DateTime]::UtcNow.ToString('o');docker=$taskSecond;snapshot=$taskSnapshot;result=$taskResultObject} | ConvertTo-Json -Depth 100),[System.Text.UTF8Encoding]::new($false))
Write-Output "Controlled stopped-container recovery evidence: $taskEvidencePath"
