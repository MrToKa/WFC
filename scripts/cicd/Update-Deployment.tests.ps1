#Requires -Version 7.2
# Dependency-free integration tests. Every Docker/network call is replaced;
# these tests never contact the real daemon or production applications.
$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path (Get-Location) ('.cicd-test-evidence-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $taskRoot
$global:wfcTestcommit = 'b' * 40
$global:wfcTestoldId = 'sha256:' + ('a' * 64)
$global:wfcTestnewId = 'sha256:' + ('c' * 64)
$global:wfcTestnewReference = 'ghcr.io/mrtoka/wfc-api@sha256:' + ('d' * 64)
$global:wfcTestupdater = Join-Path $PSScriptRoot 'Update-Deployment.ps1'
$global:wfcTestbackup = Join-Path $taskRoot 'backup-fixture.ps1'
Set-Content -LiteralPath $global:wfcTestbackup -Value 'exit 0'
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Reset-Fixture([string]$Name) {
    $global:wfcTestevents = [Collections.Generic.List[string]]::new()
    $global:wfcTestrunning = $true; $global:wfcTestcurrent = $global:wfcTestoldId
    $global:wfcTestfailReadiness = $false; $global:wfcTestbadManifest = $false; $global:wfcTestpending = $false
    $global:wfcTestservice = 'api'; $global:wfcTestbadContract = $false; $global:wfcTestfailRollback = $false
    $global:wfcTestdirectory = Join-Path $taskRoot $Name
    $null = New-Item -ItemType Directory -Path $global:wfcTestdirectory
    $global:wfcTestconfiguration = Join-Path $global:wfcTestdirectory 'config.json'
    $config = @{
        stateDirectory = (Join-Path $global:wfcTestdirectory 'state')
        applications = @(@{
            name = 'wfc'; repository = 'MrToKa/WFC'; branch = 'main'; compatibility = 'wfc-v1'; kind = 'compose'; project = 'wfc'
            services = @{ api = 'wfc-api' }; images = @{ api = 'ghcr.io/mrtoka/wfc-api' }
            workingDirectory = $global:wfcTestdirectory; composeFiles = @('compose.yml'); envFile = '.env'
            healthUrl = 'http://127.0.0.1:5173/health'; healthExpected = @{ status = 'ok' }; prepareHook = $global:wfcTestbackup
        })
    }
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $global:wfcTestconfiguration
}
function docker {
    $arguments = @($args); $global:LASTEXITCODE = 0
    $global:wfcTestevents.Add([string]$arguments[0])
    switch ($arguments[0]) {
        version { '28.0'; return }
        inspect {
            ConvertTo-Json -Depth 10 -InputObject @(@{
                Id = 'container-1'; Image = $global:wfcTestcurrent
                Config = @{ Labels = @{ 'com.docker.compose.project' = 'wfc'; 'com.docker.compose.service' = $global:wfcTestservice } }
                State = @{ Running = $global:wfcTestrunning; Health = @{ Status = 'healthy' } }
                Mounts = @(@{ Type = 'volume'; Source = '/var/lib/docker/volumes/models'; Destination = '/models'; RW = $true; Name = 'models' })
            }); return
        }
        pull { return }
        tag { return }
        image {
            if ($arguments -contains '{{.Id}}') { $global:wfcTestnewId } else { $global:wfcTestcommit }; return
        }
        stop { $global:wfcTestrunning = $false; return }
        compose {
            $index = [array]::LastIndexOf($arguments, '--file')
            $override = Get-Content -LiteralPath $arguments[$index + 1] -Raw | ConvertFrom-Json
            $global:wfcTestcurrent = if ($override.services.api.image -eq $global:wfcTestnewReference) { $global:wfcTestnewId } else { $global:wfcTestoldId }
            $global:wfcTestrunning = $true; return
        }
        default { throw "Unexpected mock Docker command: $($arguments[0])" }
    }
}
function Invoke-RestMethod {
    param($Uri, $Headers, $TimeoutSec)
    if ($Uri -like '*/commits/main') { return [pscustomobject]@{ sha = $global:wfcTestcommit } }
    if ($Uri -like '*/releases/tags/*') {
        return [pscustomobject]@{ draft = $false; tag_name = "deploy-$global:wfcTestcommit"; target_commitish = $global:wfcTestcommit; assets = @([pscustomobject]@{
            name = 'deployment.json'; size = 1024; browser_download_url = "https://github.com/MrToKa/WFC/releases/download/deploy-$global:wfcTestcommit/deployment.json"
        }) }
    }
    if ($Uri -like '*/deployment.json') {
        $images = @{}; $images[$global:wfcTestservice] = if ($global:wfcTestbadManifest) { 'ghcr.io/attacker/api:latest' } else { $global:wfcTestnewReference }
        return [pscustomobject]@{ schemaVersion = 1; repository = 'MrToKa/WFC'; commit = $global:wfcTestcommit; compatibility = $(if ($global:wfcTestbadContract) { 'wfc-v2' } else { 'wfc-v1' }); images = [pscustomobject]$images }
    }
    if ($global:wfcTestfailReadiness -and $global:wfcTestcurrent -eq $global:wfcTestnewId) { throw 'Simulated failed candidate readiness.' }
    if ($global:wfcTestfailRollback -and $global:wfcTestevents.Contains('stop') -and $global:wfcTestcurrent -eq $global:wfcTestoldId) { throw 'Simulated rollback readiness failure.' }
    return [pscustomobject]@{ status = 'ok' }
}
function Start-Sleep { param($Seconds) }
try {
    Reset-Fixture 'check-only'
    & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration
    Assert (-not ($global:wfcTestevents -contains 'pull') -and -not ($global:wfcTestevents -contains 'stop')) 'Check-only changed Docker state.'
    Write-Output 'PASS: check-only does not pull or stop containers'

    Reset-Fixture 'successful-deployment'
    & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply
    $state = Get-Content -LiteralPath (Join-Path $global:wfcTestdirectory 'state/wfc.json') -Raw | ConvertFrom-Json -AsHashtable
    Assert ($state.commit -eq $global:wfcTestcommit -and -not $state.ContainsKey('pending') -and $global:wfcTestcurrent -eq $global:wfcTestnewId) 'Successful deployment was not accepted.'
    $count = $global:wfcTestevents.Count
    & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply
    Assert ($global:wfcTestevents.Count -eq $count + 1) 'Current commit caused another deployment.'
    Write-Output 'PASS: successful deployment records the version and repeated runs are idempotent'

    Reset-Fixture 'readiness-rollback'; $global:wfcTestfailReadiness = $true
    $failed = $false
    try { & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply } catch { $failed = $true }
    $state = Get-Content -LiteralPath (Join-Path $global:wfcTestdirectory 'state/wfc.json') -Raw | ConvertFrom-Json -AsHashtable
    Assert ($failed -and $global:wfcTestcurrent -eq $global:wfcTestoldId -and $global:wfcTestrunning -and $state.failedCommit -eq $global:wfcTestcommit -and -not $state.ContainsKey('pending')) 'Readiness failure did not restore the old running image.'
    $count = @($global:wfcTestevents | Where-Object { $_ -eq 'stop' }).Count
    try { & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply } catch {}
    Assert (@($global:wfcTestevents | Where-Object { $_ -eq 'stop' }).Count -eq $count) 'A failed release was automatically retried.'
    Write-Output 'PASS: readiness failure restores old images and blocks repeated automatic attempts'

    Reset-Fixture 'malicious-manifest'; $global:wfcTestbadManifest = $true
    $failed = $false
    try { & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply } catch { $failed = $true }
    Assert ($failed -and -not ($global:wfcTestevents -contains 'pull') -and -not ($global:wfcTestevents -contains 'stop')) 'Untrusted registry reference was not rejected before mutation.'
    Write-Output 'PASS: unexpected registry images are rejected before changing Docker'

    Reset-Fixture 'interrupted-deployment'
    $null = New-Item -ItemType Directory -Path (Join-Path $global:wfcTestdirectory 'state')
    Set-Content -LiteralPath (Join-Path $global:wfcTestdirectory 'state/wfc.json') -Value '{"pending":{"commit":"interrupted"}}'
    $failed = $false
    try { & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply } catch { $failed = $true }
    Assert ($failed -and -not ($global:wfcTestevents -contains 'stop')) 'An interrupted transaction was restarted automatically.'
    Write-Output 'PASS: interrupted deployment requires inspection and preserves pending state'

    Reset-Fixture 'incompatible-release'; $global:wfcTestbadContract = $true
    $failed = $false
    try { & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply } catch { $failed = $true }
    Assert ($failed -and -not ($global:wfcTestevents -contains 'pull')) 'Incompatible data contract was deployed.'
    Write-Output 'PASS: incompatible data contracts require manual rollout'

    Reset-Fixture 'busy-preparation'
    Set-Content -LiteralPath $global:wfcTestbackup -Value 'exit 75'
    & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply
    Assert (-not ($global:wfcTestevents -contains 'stop')) 'Busy application was stopped.'
    Set-Content -LiteralPath $global:wfcTestbackup -Value 'exit 0'
    Write-Output 'PASS: active work postpones deployment before any container stops'

    Reset-Fixture 'missing-backup'
    $config = Get-Content -LiteralPath $global:wfcTestconfiguration -Raw | ConvertFrom-Json -AsHashtable
    $config.applications[0].prepareHook = Join-Path $taskRoot 'nonexistent.ps1'
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $global:wfcTestconfiguration
    $failed = $false
    try { & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply } catch { $failed = $true }
    Assert ($failed -and -not ($global:wfcTestevents -contains 'pull')) 'Missing backup configuration did not block deployment.'
    Write-Output 'PASS: missing backup/maintenance configuration blocks deployment'

    Reset-Fixture 'rollback-failure'; $global:wfcTestfailReadiness = $true; $global:wfcTestfailRollback = $true
    $failed = $false
    try { & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply } catch { $failed = $true }
    $state = Get-Content -LiteralPath (Join-Path $global:wfcTestdirectory 'state/wfc.json') -Raw | ConvertFrom-Json -AsHashtable
    Assert ($failed -and $state.ContainsKey('pending')) 'Failed rollback did not preserve the transaction for inspection.'
    Write-Output 'PASS: failed rollback retains pending transaction and blocks unattended recovery'

    Reset-Fixture 'preparer-launcher'; $global:wfcTestservice = 'preparer'
    $launcher = Join-Path $taskRoot 'preparer-launcher-fixture.ps1'
    @'
param($Image, [switch]$Recreate)
if (-not $Recreate) { throw 'Expected explicit recreation.' }
$global:wfcTestcurrent = if ($Image -eq $global:wfcTestnewReference) { $global:wfcTestnewId } else { $global:wfcTestoldId }
$global:wfcTestrunning = $true
$global:wfcTestevents.Add('launcher')
'@ | Set-Content -LiteralPath $launcher
    $config = Get-Content -LiteralPath $global:wfcTestconfiguration -Raw | ConvertFrom-Json -AsHashtable
    $config.applications[0].kind = 'preparer'
    $config.applications[0].services = @{ preparer = 'preparer-1' }
    $config.applications[0].images = @{ preparer = 'ghcr.io/mrtoka/wfc-api' }
    $config.applications[0].launcher = $launcher
    $config.applications[0].launcherParameters = @{}
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $global:wfcTestconfiguration
    & $global:wfcTestupdater -ConfigPath $global:wfcTestconfiguration -Apply
    Assert ($global:wfcTestcurrent -eq $global:wfcTestnewId -and $global:wfcTestevents.Contains('launcher') -and -not $global:wfcTestevents.Contains('compose')) 'Preparer was not deployed using its reviewed launcher.'
    Write-Output 'PASS: Preparer uses its existing launcher with an immutable image and explicit recreation'
} finally {
    # Retain the small test directory for inspection. No recursive deletion.
    Write-Output "Isolated test evidence: $taskRoot"
}
