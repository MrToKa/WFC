[CmdletBinding()]
param(
    [ValidateRange(1024,65535)][int]$Port = 8083,
    [string]$ListenAddress = '127.0.0.1',
    [ValidateSet('closed','simulation','live')][string]$Mode = 'closed',
    [string]$EnvFilePath = 'C:\Users\todor.chankov\Documents\Codex\2026-10-15\https-get-started-aps-autodesk-com\outputs\aps-local-viewer\.env',
    [string]$ImportRoot = 'C:\Users\todor.chankov\Documents\Codex\2026-10-16\routings-model-package-output',
    [string]$SourceDirectory = 'D:\OneDrive - ACS\R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC\3D',
    [string]$PriceProofPath,
    [string]$PriceProofSha256,
    [switch]$AllowNewCloudPreparation,
    [string]$Image = 'routings-model-preparer:stage3',
    [string]$PackageRoot,
    [string]$SdkSource = 'C:\Users\todor.chankov\Documents\Codex\2026-10-15\https-get-started-aps-autodesk-com\outputs\aps-local-viewer\offline\vendor\viewer\7.130.0',
    [string]$NodeBase = 'node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5',
    [switch]$Build,
    [switch]$Recreate,
    [switch]$RecoverStoppedContainer,
    [string]$ExportImagePath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PackageRoot)) { $PackageRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'routings-model-package' }
$taskProject = 'routings-preparer'
$taskCompose = Join-Path $PSScriptRoot 'deployment\compose.yaml'
$taskListenIp = [System.Net.IPAddress]::None
if (-not [System.Net.IPAddress]::TryParse($ListenAddress,[ref]$taskListenIp) -or
    $taskListenIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    $taskListenIp.ToString() -ne $ListenAddress) { throw 'ListenAddress must be a canonical IPv4 address.' }
$taskListenBytes = $taskListenIp.GetAddressBytes()
$taskPrivateAddress = $taskListenBytes[0] -eq 10 -or
    ($taskListenBytes[0] -eq 172 -and $taskListenBytes[1] -ge 16 -and $taskListenBytes[1] -le 31) -or
    ($taskListenBytes[0] -eq 192 -and $taskListenBytes[1] -eq 168)
if ($ListenAddress -ne '127.0.0.1' -and -not $taskPrivateAddress) { throw 'ListenAddress must be 127.0.0.1 or an RFC 1918 private IPv4 address; wildcard/public binding is refused.' }
if ($ListenAddress -ne '127.0.0.1') {
    $taskLocalAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $ListenAddress -ErrorAction SilentlyContinue)
    if ($taskLocalAddresses.Count -ne 1) { throw 'ListenAddress must identify one IPv4 address assigned to this computer.' }
}
$taskPublicOrigin = "http://${ListenAddress}:$Port"
if ($AllowNewCloudPreparation -and ($Mode -ne 'live' -or -not $PriceProofPath -or $PriceProofSha256 -notmatch '^[a-f0-9]{64}$')) { throw '-AllowNewCloudPreparation requires explicit live mode and a pinned current operator price proof.' }

function Assert-NewPreparationReview([string]$FilePath,[string]$ExpectedSha) {
    try {
        $taskResolved = (Resolve-Path -LiteralPath $FilePath).ProviderPath
        $taskItem = Get-Item -LiteralPath $taskResolved
        if ($taskItem.PSIsContainer -or ($taskItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or $taskItem.Length -gt 262144 -or $taskItem.Name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.json$') { throw 'Unsupported review input.' }
        if ((Get-FileHash -LiteralPath $taskResolved -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha) { throw 'Review hash differs.' }
        $taskUtf8 = [System.Text.UTF8Encoding]::new($false,$true)
        $taskProofText = $taskUtf8.GetString([System.IO.File]::ReadAllBytes($taskResolved))
        # PowerShell 7.5 otherwise converts ISO strings to local DateTime values;
        # preserve the source spelling for the UTC guard, including on 5.1.
        if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { $taskProof = $taskProofText | ConvertFrom-Json -DateKind String -ErrorAction Stop }
        else { $taskProof = $taskProofText | ConvertFrom-Json -ErrorAction Stop }
        $taskNow = [DateTimeOffset]::UtcNow; $taskChecked = [DateTimeOffset]::MinValue; $taskExpires = [DateTimeOffset]::MinValue; $taskAuthorized = [DateTimeOffset]::MinValue
        foreach ($taskDate in @($taskProof.checkedAt,$taskProof.expiresAt,$taskProof.authorization.confirmedAt)) { if ($taskDate -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$') { throw 'Review dates must be canonical UTC.' } }
        if (-not [DateTimeOffset]::TryParse($taskProof.checkedAt,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind,[ref]$taskChecked) -or -not [DateTimeOffset]::TryParse($taskProof.expiresAt,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind,[ref]$taskExpires) -or -not [DateTimeOffset]::TryParse($taskProof.authorization.confirmedAt,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind,[ref]$taskAuthorized)) { throw 'Review dates are invalid.' }
        if ($taskProof.schemaVersion -ne 1 -or $taskProof.kind -ne 'autodesk-account-operator-review' -or $taskProof.account.offering -ne 'Free' -or $taskProof.account.paidFallback -isnot [bool] -or $taskProof.account.paidFallback -ne $false -or $taskProof.authorization.explicitUserAuthorized -isnot [bool] -or $taskProof.authorization.explicitUserAuthorized -ne $true -or $taskChecked -gt $taskNow -or $taskExpires -le $taskNow -or $taskExpires -le $taskChecked -or ($taskExpires-$taskChecked).TotalMinutes -gt 30 -or $taskAuthorized -gt $taskNow -or $taskAuthorized -ge $taskExpires) { throw 'Review is expired or lacks explicit zero-cost operator authorization.' }
        if (@($taskProof.approvedSources).Count -lt 1 -or $taskProof.supportProfile -ne 'svf-local-7.130.0-v1' -or $taskProof.conversion.format -ne 'svf' -or @($taskProof.conversion.views).Count -ne 1 -or $taskProof.conversion.views[0] -ne '3d' -or $taskProof.conversion.xAdsForce -isnot [bool] -or $taskProof.conversion.xAdsForce -ne $false) { throw 'Review does not approve a bounded supported source preparation.' }
        foreach ($taskOperation in @('storage','upload','submit')) {
            $taskAllowance = $taskProof.operations.PSObject.Properties[$taskOperation].Value
            if ($taskAllowance.zero -isnot [bool] -or $taskAllowance.zero -ne $true -or ($taskAllowance.count -isnot [int] -and $taskAllowance.count -isnot [long]) -or $taskAllowance.count -lt 1) { throw 'Review lacks a required positive zero-cost operation allowance.' }
        }
        # This local preflight never grants cloud authority. The server still
        # validates the complete pinned proof/artifacts, exact source/account,
        # HMAC evidence, expiry and durable global usage before each operation.
        return $taskResolved
    } catch { throw '-AllowNewCloudPreparation requires a valid current pinned operator review with explicit source-bound zero-cost authorization.' }
}
if ($AllowNewCloudPreparation) { $null = Assert-NewPreparationReview $PriceProofPath $PriceProofSha256 }

function Assert-ConfigurationFile([string]$FilePath) {
    $taskResolved = (Resolve-Path -LiteralPath $FilePath).ProviderPath
    $taskFile = Get-Item -LiteralPath $taskResolved
    if ($taskFile.PSIsContainer -or ($taskFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or $taskFile.Length -gt 65536) { throw 'Configuration file is unsafe or unsupported.' }
    $taskValues = @{}
    try {
        foreach ($taskLine in [System.IO.File]::ReadAllLines($taskResolved)) {
            if ($taskLine -match '^\s*(?:export\s+)?(APS_CLIENT_ID|APS_CLIENT_SECRET|APS_REGION|APS_BUCKET)\s*=\s*(.*?)\s*$') {
                $taskName = $Matches[1]; $taskValue = $Matches[2]
                if ($taskValues.ContainsKey($taskName)) { throw "Duplicate setting: $taskName" }
                if ($taskValue.Length -ge 2 -and (($taskValue.StartsWith('"') -and $taskValue.EndsWith('"')) -or ($taskValue.StartsWith("'") -and $taskValue.EndsWith("'")))) { $taskValue = $taskValue.Substring(1,$taskValue.Length-2) }
                else { $taskValue = [regex]::Replace($taskValue,'\s+#.*$','') }
                $taskValues[$taskName] = $taskValue
            }
        }
        foreach ($taskName in @('APS_CLIENT_ID','APS_CLIENT_SECRET','APS_REGION','APS_BUCKET')) {
            if (-not $taskValues.ContainsKey($taskName) -or [string]::IsNullOrWhiteSpace($taskValues[$taskName])) { throw "Missing setting: $taskName" }
        }
        if ($taskValues['APS_CLIENT_ID'] -notmatch '^[A-Za-z0-9_-]{8,256}$') { throw 'Invalid setting: APS_CLIENT_ID' }
        if ($taskValues['APS_CLIENT_SECRET'].Length -lt 8 -or $taskValues['APS_CLIENT_SECRET'].Length -gt 1024 -or $taskValues['APS_CLIENT_SECRET'] -match '[\s\x00-\x1f]' -or $taskValues['APS_CLIENT_SECRET'].Contains('${')) { throw 'Invalid setting: APS_CLIENT_SECRET' }
        if ($taskValues['APS_REGION'] -notin @('EMEA','US')) { throw 'Invalid setting: APS_REGION' }
        if ($taskValues['APS_BUCKET'] -notmatch '^[a-z0-9_-]{3,128}$') { throw 'Invalid setting: APS_BUCKET' }
        return $taskResolved
    } finally { $taskValues.Clear() }
}
function Invoke-Docker([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed (exit $LASTEXITCODE)." }
}
function Docker-Label([string]$Id,[string]$Name) {
    $taskLabels = & docker inspect $Id --format '{{json .Config.Labels}}' | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Own container labels are unavailable.' }
    $taskProperty = $taskLabels.PSObject.Properties[$Name]
    if (-not $taskProperty) { return '' }; return [string]$taskProperty.Value
}
function Path-Identity([string]$Value) {
    $taskHasher = [System.Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($taskHasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value))).Replace('-','').ToLowerInvariant() }
    finally { $taskHasher.Dispose() }
}

$taskEnvPath = Assert-ConfigurationFile $EnvFilePath
$taskImportPath = (Resolve-Path -LiteralPath $ImportRoot).ProviderPath
if (-not (Get-Item -LiteralPath $taskImportPath).PSIsContainer) { throw 'ImportRoot must be a directory.' }
$taskSourcePath = (Resolve-Path -LiteralPath $SourceDirectory).ProviderPath
if (-not (Get-Item -LiteralPath $taskSourcePath).PSIsContainer) { throw 'SourceDirectory must be a directory.' }
$taskProofPath = $null
if ($PriceProofPath -or $PriceProofSha256) {
    if ($Mode -ne 'live' -or -not $PriceProofPath -or $PriceProofSha256 -notmatch '^[a-f0-9]{64}$') { throw 'A pinned price proof path and SHA-256 may only be supplied together for explicit live mode.' }
    $taskProofPath = (Resolve-Path -LiteralPath $PriceProofPath).ProviderPath
    $taskProofItem = Get-Item -LiteralPath $taskProofPath
    if ($taskProofItem.PSIsContainer -or ($taskProofItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or $taskProofItem.Length -gt 262144 -or $taskProofItem.Name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.json$') { throw 'Invalid pinned price proof input.' }
    if ((Get-FileHash -LiteralPath $taskProofPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PriceProofSha256) { throw 'Pinned price proof SHA-256 differs.' }
}
$taskConfigurationSha = (Get-FileHash -LiteralPath $taskEnvPath -Algorithm SHA256).Hash.ToLowerInvariant()
$taskLiveReuseOnly = if ($AllowNewCloudPreparation) { 'false' } else { 'true' }
$taskRuntimeConfigurationSha = Path-Identity ("configuration-sha256=$taskConfigurationSha;live-reuse-only=$taskLiveReuseOnly")
if ($ListenAddress -ne '127.0.0.1') {
    $taskRuntimeConfigurationSha = Path-Identity ("configuration-sha256=$taskConfigurationSha;live-reuse-only=$taskLiveReuseOnly;origin=$taskPublicOrigin")
}
$taskImportIdentity = Path-Identity $taskImportPath
$taskSourceIdentity = Path-Identity $taskSourcePath
$taskExpectedProofSha = if ($taskProofPath) { $PriceProofSha256 } else { 'none' }
if ($Image -notmatch '^[a-z0-9][a-z0-9._/:@-]+$') { throw 'Invalid image name.' }
if ($NodeBase -notmatch '^node:(?:24[\w.:-]*)$|^node@sha256:[a-f0-9]{64}$') { throw 'NodeBase must be an explicit Node 24 tag or verified digest.' }
& docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker engine is unavailable.' }

$taskContainerIds = @(& docker ps -a --filter "label=com.docker.compose.project=$taskProject" --filter 'label=com.docker.compose.service=preparer' --format '{{.ID}}')
if ($LASTEXITCODE -ne 0 -or $taskContainerIds.Count -gt 1) { throw 'Own service identity is ambiguous.' }
$taskListeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($taskListeners.Count) {
    $taskOwnPort = $false
    if ($taskContainerIds.Count -eq 1 -and ((& docker inspect $taskContainerIds[0] --format '{{.State.Running}}') -eq 'true')) {
        $taskBinding = & docker inspect $taskContainerIds[0] --format '{{json .HostConfig.PortBindings}}' | ConvertFrom-Json
        $taskPortProperty = $taskBinding.PSObject.Properties['8080/tcp']
        $taskExistingListenAddress = Docker-Label $taskContainerIds[0] 'routings.preparer.listen-address'
        if ([string]::IsNullOrEmpty($taskExistingListenAddress)) { $taskExistingListenAddress = '127.0.0.1' }
        if ($taskPortProperty) {
            $taskBindings = @($taskPortProperty.Value)
            $taskOwnPort = $taskBindings.Count -eq 1 -and $taskBindings[0].HostIp -eq $taskExistingListenAddress -and $taskBindings[0].HostPort -eq "$Port"
        }
    }
    if (-not $taskOwnPort) { throw "Preparer port $Port is already occupied by another service." }
}

if ($Build) {
    & node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(2)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 24 is required for explicit build preparation.' }
    $taskPreview = Join-Path $PSScriptRoot 'deployment\preview-runtime'
    & node (Join-Path $PSScriptRoot 'deployment\prepare-runtime.mjs') --source $SdkSource --target $taskPreview
    if ($LASTEXITCODE -ne 0) { throw 'Trusted preview runtime preparation failed.' }
    $taskBuildBase = Join-Path $PSScriptRoot 'deployment\.build'
    if (-not (Test-Path -LiteralPath $taskBuildBase)) { New-Item -ItemType Directory -Path $taskBuildBase | Out-Null }
    $taskStaging = Join-Path $taskBuildBase ([guid]::NewGuid().ToString())
    & node (Join-Path $PSScriptRoot 'deployment\prepare-build.mjs') $PSScriptRoot $PackageRoot $taskStaging
    if ($LASTEXITCODE -ne 0) { throw 'Explicit source build preparation failed.' }
    Invoke-Docker -Arguments @('buildx','build','--load','--network=none','--build-context',"preparer=$(Join-Path $taskStaging 'preparer')",'--build-context',"package=$(Join-Path $taskStaging 'package')",'--build-context',"preview=$taskPreview",'--build-arg',"NODE_BASE=$NodeBase",'--tag',$Image,'--file',(Join-Path $PSScriptRoot 'deployment\Dockerfile'),(Join-Path $PSScriptRoot 'deployment'))
    Write-Output "Build inventory: $(Join-Path $taskStaging 'build-input-inventory.json')"
}
$taskImageId = & docker image inspect $Image --format '{{.Id}}'
if ($LASTEXITCODE -ne 0) { throw 'Delivered image is unavailable. Use -Build once or load the offline image archive.' }
$taskInstanceId = [guid]::NewGuid().ToString()
if ($taskContainerIds.Count -eq 1 -and -not $Recreate -and -not $RecoverStoppedContainer) {
    $taskInstanceId = Docker-Label $taskContainerIds[0] 'routings.preparer.instance'
    if ($taskInstanceId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$') { throw 'Preserved legacy container has no verifiable instance identity. Gracefully stop it and use -Recreate.' }
}
if ($RecoverStoppedContainer) {
    if ($taskContainerIds.Count -ne 1) { throw 'Explicit recovery requires exactly one preserved own stopped container.' }
    & (Join-Path $PSScriptRoot 'deployment\recover-stopped.ps1') -ContainerId $taskContainerIds[0] -HelperImage $Image
    if ($LASTEXITCODE -ne 0) { throw 'Explicit stopped-container recovery failed; persistent state was not reset.' }
    $Recreate = $true
}
if ($taskContainerIds.Count -eq 1 -and -not $Recreate) {
    $taskExistingMode = Docker-Label $taskContainerIds[0] 'routings.preparer.mode'
    $taskExistingPort = Docker-Label $taskContainerIds[0] 'routings.preparer.port'
    $taskExistingImage = & docker inspect $taskContainerIds[0] --format '{{.Image}}'
    $taskExistingListenAddress = Docker-Label $taskContainerIds[0] 'routings.preparer.listen-address'
    if ([string]::IsNullOrEmpty($taskExistingListenAddress)) { $taskExistingListenAddress = '127.0.0.1' }
    if ($taskExistingMode -ne $Mode -or $taskExistingPort -ne "$Port" -or $taskExistingImage -ne $taskImageId -or $taskExistingListenAddress -ne $ListenAddress) { throw 'Requested mode, listen address, port or image differs from the preserved container. Use -Recreate explicitly to apply the change.' }
    foreach ($taskCheck in @(@('routings.preparer.configuration-sha256',$taskConfigurationSha),@('routings.preparer.runtime-configuration-sha256',$taskRuntimeConfigurationSha),@('routings.preparer.live-reuse-only',$taskLiveReuseOnly),@('routings.preparer.proof-sha256',$taskExpectedProofSha),@('routings.preparer.import-root-hash',$taskImportIdentity),@('routings.preparer.source-root-hash',$taskSourceIdentity))) {
        $taskExisting = Docker-Label $taskContainerIds[0] $taskCheck[0]
        if ($taskExisting -ne $taskCheck[1]) { throw 'Requested configuration, proof or permitted roots differ. Use -Recreate explicitly to apply the change.' }
    }
}
if ($ExportImagePath) {
    if (Test-Path -LiteralPath $ExportImagePath) { throw 'ExportImagePath must be a new file.' }
    Invoke-Docker -Arguments @('image','save','--output',$ExportImagePath,$Image)
}

$taskRuntimeVariables = @{
    PREPARER_ENV_FILE_PATH = $taskEnvPath
    PREPARER_IMPORT_ROOT = $taskImportPath
    PREPARER_SOURCE_DIRECTORY = $taskSourcePath
    PREPARER_HOST_PORT = "$Port"
    PREPARER_LISTEN_ADDRESS = $ListenAddress
    PREPARER_DEPLOY_MODE = $Mode
    PREPARER_INSTANCE_ID = $taskInstanceId
    PREPARER_IMAGE = $Image
    PREPARER_CONFIGURATION_SHA256 = $taskConfigurationSha
    PREPARER_RUNTIME_CONFIGURATION_SHA256 = $taskRuntimeConfigurationSha
    PREPARER_LIVE_REUSE_ONLY = $taskLiveReuseOnly
    PREPARER_IMPORT_ROOT_HASH = $taskImportIdentity
    PREPARER_SOURCE_ROOT_HASH = $taskSourceIdentity
    PREPARER_PRICE_PROOF_SHA256 = $taskExpectedProofSha
}
if ($taskProofPath) {
    $taskRuntimeVariables['PREPARER_PRICE_PROOF_DIRECTORY'] = Split-Path $taskProofPath -Parent
    $taskRuntimeVariables['PREPARER_PRICE_PROOF_BASENAME'] = Split-Path $taskProofPath -Leaf
    $taskRuntimeVariables['PREPARER_PRICE_PROOF_SHA256'] = $PriceProofSha256
}
$taskPreviousVariables = @{}
try {
    foreach ($taskName in $taskRuntimeVariables.Keys) { $taskPreviousVariables[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process'); [Environment]::SetEnvironmentVariable($taskName,$taskRuntimeVariables[$taskName],'Process') }
    $taskUp = @('compose','--project-name',$taskProject,'--file',$taskCompose)
    if ($taskProofPath) { $taskUp += @('--file',(Join-Path $PSScriptRoot 'deployment\compose-live.yaml')) }
    $taskUp += @('up','--detach','--no-build','--pull','never','--wait','--wait-timeout','90')
    if ($Recreate) { $taskUp += '--force-recreate' } else { $taskUp += '--no-recreate' }
    Invoke-Docker -Arguments $taskUp
    $taskHealth = Invoke-RestMethod -Uri "$taskPublicOrigin/health" -TimeoutSec 10
    $taskObservedMode = if ($taskHealth.PSObject.Properties['requestedMode']) { $taskHealth.requestedMode } else { $taskHealth.mode }
    if ($taskHealth.status -ne 'ok' -or $taskObservedMode -ne $Mode) { throw 'Started application identity or requested mode differs.' }
    $taskPreparationPolicy = if ($AllowNewCloudPreparation) { 'new preparation explicitly enabled; every operation requires current source-bound zero-cost proof' } else { 'existing-artifact reuse only' }
    Write-Output "Preparer: $taskPublicOrigin/ (requested mode: $Mode; live policy: $taskPreparationPolicy)"
} finally {
    foreach ($taskName in $taskPreviousVariables.Keys) { [Environment]::SetEnvironmentVariable($taskName,$taskPreviousVariables[$taskName],'Process') }
}
