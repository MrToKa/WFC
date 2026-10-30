#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ConfigPath,
    [switch]$Apply,
    [switch]$RetryFailed,
    [switch]$FailIfBusy
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
$taskStateRoot = [IO.Path]::GetFullPath($taskConfig.stateDirectory)
$null = New-Item -ItemType Directory -Path $taskStateRoot -Force
# One lock covers both applications, including simultaneous Task Scheduler and
# manual invocations. A surviving pending record requires operator inspection.
try { $taskLock = [IO.File]::Open((Join-Path $taskStateRoot 'deployment.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch [IO.IOException] { if ($FailIfBusy) { throw 'Another updater owns the lock; retry the deployment job later.' }; Write-Output 'Another updater owns the deployment lock.'; exit 0 }

function Save-State([string]$Path, [hashtable]$Value) {
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary, $Path, $true)
}
function Invoke-Docker([string[]]$DockerArguments) {
    $result = & docker @DockerArguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed: $($DockerArguments[0]) (exit $LASTEXITCODE). Inspect Docker locally; raw configuration is not logged." }
    return $result
}
function Read-Container([string]$Name) {
    # Never print inspect output: it includes production credentials.
    $value = @(Invoke-Docker -DockerArguments @('inspect', $Name) | ConvertFrom-Json -AsHashtable)
    if ($value.Count -ne 1) { throw 'Container identity is ambiguous.' }
    return $value[0]
}
function Assert-Container($App, [string]$Service, [hashtable]$Container) {
    if ($Container.Config.Labels['com.docker.compose.project'] -ne $App.project -or
        $Container.Config.Labels['com.docker.compose.service'] -ne $Service -or
        -not $Container.State.Running) { throw "Unexpected or stopped container for $($App.name)/$Service." }
    if ($Container.State.ContainsKey('Health') -and $Container.State.Health.Status -ne 'healthy') { throw 'Existing container is unhealthy; repair it before updating.' }
    if (@($Container.Mounts | Where-Object { $_.Type -eq 'volume' -and -not $_.Name }).Count) { throw 'Unidentified persistent volume.' }
}
function Assert-Health($App) {
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $App.healthUrl -TimeoutSec 10
            foreach ($key in $App.healthExpected.Keys) {
                $property = $health.PSObject.Properties[$key]
                if (-not $property -or $property.Value -ne $App.healthExpected[$key]) { throw 'Application readiness identity differs.' }
            }
            return
        } catch { if ($attempt -eq 11) { throw 'HTTP readiness did not pass.' }; Start-Sleep -Seconds 5 }
    }
}
function Read-GitHub([string]$Path) {
    $headers = @{ Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'WFC-Local-Deployment' }
    if ($env:WFC_DEPLOY_GITHUB_TOKEN) { $headers.Authorization = "Bearer $env:WFC_DEPLOY_GITHUB_TOKEN" }
    return Invoke-RestMethod -Uri "https://api.github.com/$Path" -Headers $headers -TimeoutSec 30
}
function Get-Candidate($App) {
    $head = Read-GitHub "repos/$($App.repository)/commits/$($App.branch)"
    if ($head.sha -notmatch '^[a-f0-9]{40}$') { throw 'Invalid main commit.' }
    $tag = "deploy-$($head.sha)"
    try { $release = Read-GitHub "repos/$($App.repository)/releases/tags/$tag" }
    catch {
        $responseProperty = $_.Exception.PSObject.Properties['Response']
        if ($responseProperty -and $responseProperty.Value -and $responseProperty.Value.StatusCode -eq [Net.HttpStatusCode]::NotFound) { return $null }
        throw
    }
    if ($release.draft -or $release.tag_name -ne $tag -or $release.target_commitish -ne $head.sha) { throw 'Release is not pinned to the current main commit.' }
    $assets = @($release.assets | Where-Object { $_.name -eq 'deployment.json' })
    if ($assets.Count -ne 1 -or $assets[0].size -gt 16384) { throw 'Missing or invalid deployment manifest.' }
    # These repositories are public. Do not forward a GitHub API bearer token
    # to the release-asset redirect host. Private repositories need a separate
    # authenticated asset transport before this updater can be used.
    $expected = "https://github.com/$($App.repository)/releases/download/$tag/deployment.json"
    if ($assets[0].browser_download_url -ne $expected) { throw 'Unexpected asset URL.' }
    $manifest = Invoke-RestMethod -Uri $expected -TimeoutSec 30
    if ($manifest -is [string]) { $manifest = $manifest | ConvertFrom-Json }
    if ($manifest.schemaVersion -ne 1 -or $manifest.repository -ne $App.repository -or
        $manifest.commit -ne $head.sha -or $manifest.compatibility -ne $App.compatibility) { throw 'Release identity or persistent-data compatibility requires manual review.' }
    $images = @{}
    $keys = @($manifest.images.PSObject.Properties.Name | Sort-Object)
    if (($keys -join ',') -ne (($App.images.Keys | Sort-Object) -join ',')) { throw 'Release service set differs.' }
    foreach ($key in $keys) {
        $image = [string]$manifest.images.$key
        if ($image -notmatch ('^' + [regex]::Escape($App.images[$key]) + '@sha256:[a-f0-9]{64}$')) { throw 'Release contains an unexpected image.' }
        $images[$key] = $image
    }
    return @{ commit = $manifest.commit; images = $images }
}
function Get-ComposeArguments($App, [string]$Override) {
    $arguments = @('compose', '--project-name', $App.project, '--project-directory', $App.workingDirectory,
        '--env-file', (Join-Path $App.workingDirectory $App.envFile))
    foreach ($file in $App.composeFiles) { $arguments += @('--file', (Join-Path $App.workingDirectory $file)) }
    return $arguments + @('--file', $Override)
}
function Start-Version($App, [hashtable]$Images, [string]$Override) {
    if ($App.kind -eq 'compose') {
        $services = @{}
        foreach ($service in $Images.Keys) {
            $services[$service] = @{ image = $Images[$service]; stop_grace_period = '150s' }
            if ($service -eq 'web') {
                $services[$service].healthcheck = @{ test = @('CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1/health'); interval = '10s'; timeout = '5s'; retries = 18; start_period = '10s' }
            }
        }
        [IO.File]::WriteAllText($Override, (@{ services = $services } | ConvertTo-Json -Depth 10))
        $arguments = Get-ComposeArguments $App $Override
        $null = Invoke-Docker -DockerArguments ($arguments + @('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '240') + @($Images.Keys))
    } elseif ($App.kind -eq 'preparer') {
        $parameters = @{} + $App.launcherParameters
        $parameters.Image = $Images.preparer
        $parameters.Recreate = $true
        & $App.launcher @parameters | Out-Null
        if (-not $?) { throw 'Preparer launcher failed.' }
    } else { throw 'Unknown deployment kind.' }
    Assert-Health $App
}
function Assert-SameMounts([hashtable]$Before, [hashtable]$After) {
    $identity = { param($container)
        @($container.Mounts | ForEach-Object { "$($_.Type)|$($_.Source)|$($_.Destination)|$($_.RW)" } | Sort-Object) -join "`n"
    }
    if ((& $identity $Before) -ne (& $identity $After)) { throw 'Persistent mounts changed. Inspect before accepting this deployment.' }
}

try {
    $null = Invoke-Docker -DockerArguments @('version', '--format', '{{.Server.Version}}')
    $taskFailures = @()
    foreach ($app in $taskConfig.applications) {
        try {
            if ($app.name -notmatch '^[a-z0-9-]{1,40}$' -or $app.repository -notmatch '^MrToKa/(WFC|routings-model-preparer)$' -or $app.branch -ne 'main') { throw 'Invalid local application identity.' }
            $statePath = Join-Path $taskStateRoot "$($app.name).json"
            $state = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
            if ($state.ContainsKey('pending')) { throw 'Interrupted deployment requires inspection of the pending state. Automatic updates remain blocked.' }
            $candidate = Get-Candidate $app
            if (-not $candidate) { Write-Output "$($app.name): main has no complete tested release yet."; continue }
            if ($state.ContainsKey('commit') -and $state.commit -eq $candidate.commit) { Write-Output "$($app.name): already current."; continue }
            if (-not $RetryFailed -and $state.ContainsKey('failedCommit') -and $state.failedCommit -eq $candidate.commit) { throw 'This candidate failed previously. Inspect and explicitly use -RetryFailed.' }
            Write-Output "$($app.name): candidate $($candidate.commit)."
            $before = @{}; $oldImages = @{}
            foreach ($service in $app.services.Keys) {
                $container = Read-Container $app.services[$service]
                Assert-Container $app $service $container
                $before[$service] = $container
                $oldImages[$service] = $container.Image
            }
            Assert-Health $app
            if (-not $Apply) { Write-Output "$($app.name): check only; no images pulled and no services changed."; continue }
            if (-not (Test-Path -LiteralPath $app.prepareHook -PathType Leaf) -or [IO.Path]::GetExtension($app.prepareHook) -ne '.ps1') { throw 'Configure a private preparation hook that drains activity and verifies a coherent backup. No deployment started.' }
            foreach ($image in $candidate.images.Values) {
                $null = Invoke-Docker -DockerArguments @('pull', '--quiet', $image)
                $revision = Invoke-Docker -DockerArguments @('image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', $image)
                if ([string]$revision -ne $candidate.commit) { throw 'Image revision differs from the tested commit.' }
            }
            # All downloads finish before the local maintenance/backup phase.
            # The hook must prevent new activity until this invocation ends.
            # Exit 75 means busy: postpone, without recording a failed release.
            & (Get-Process -Id $PID).Path -NoProfile -NonInteractive -File $app.prepareHook
            if ($LASTEXITCODE -eq 75) { if ($FailIfBusy) { throw 'Active work; retry the deployment job when maintenance is available.' }; Write-Output "$($app.name): active work; update postponed."; continue }
            if ($LASTEXITCODE -ne 0) { throw 'Preparation/backup hook failed. Existing application version retained.' }
            # A backup must not change service identity or configuration.
            foreach ($service in $app.services.Keys) {
                $current = Read-Container $app.services[$service]
                Assert-Container $app $service $current
                if ($current.Id -ne $before[$service].Id) { throw 'Container changed during preparation.' }
            }
            $nonce = [guid]::NewGuid().ToString('N')
            $oldTags = @{}
            foreach ($service in $oldImages.Keys) {
                $oldTags[$service] = "local/cicd-rollback:$($app.name)-$service-$nonce"
                $null = Invoke-Docker -DockerArguments @('tag', $oldImages[$service], $oldTags[$service])
            }
            $previousCommit = if ($state.ContainsKey('commit')) { $state.commit } else { $null }
            $previousVersions = if ($state.ContainsKey('workingVersions')) { @($state.workingVersions) } else { @() }
            $override = Join-Path $taskStateRoot "$($app.name).override.json"
            $state.pending = @{ commit = $candidate.commit; oldImages = $oldImages; newImages = $candidate.images; rollbackTags = $oldTags; startedAt = [DateTimeOffset]::UtcNow.ToString('o') }
            Save-State $statePath $state
            $rollbackState = $state | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable
            try {
                # Use an unbounded Docker stop wait: never SIGKILL a writer to
                # satisfy a deployment timeout. Task Scheduler must not kill it.
                $null = Invoke-Docker -DockerArguments (@('stop', '--time', '-1') + @($app.services.Values))
                Start-Version $app $candidate.images $override
                foreach ($service in $app.services.Keys) {
                    $after = Read-Container $app.services[$service]
                    Assert-Container $app $service $after
                    Assert-SameMounts $before[$service] $after
                    $expectedId = [string](Invoke-Docker -DockerArguments @('image', 'inspect', '--format', '{{.Id}}', $candidate.images[$service]))
                    if ($after.Image -ne $expectedId) { throw 'Started image differs from release.' }
                }
                $newTags = @{}
                foreach ($service in $candidate.images.Keys) {
                    $newTags[$service] = "local/cicd-rollback:$($app.name)-$service-$nonce-current"
                    $null = Invoke-Docker -DockerArguments @('tag', $candidate.images[$service], $newTags[$service])
                }
                # Rotate only after the complete candidate passed readiness.
                $state.workingVersions = @(
                    @{ commit = $candidate.commit; images = $candidate.images; tags = $newTags },
                    @{ commit = $previousCommit; images = $oldImages; tags = $oldTags }
                )
                $state.commit = $candidate.commit
                $state.previousImages = $oldImages
                $state.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
                $state.Remove('pending'); $state.Remove('failedCommit')
                Save-State $statePath $state
                Write-Output "$($app.name): deployed and HTTP readiness verified."
            } catch {
                # This is image rollback only. Never restore a database snapshot
                # automatically, because newer user writes could be destroyed.
                $null = Invoke-Docker -DockerArguments (@('stop', '--time', '-1') + @($app.services.Values))
                Start-Version $app $oldImages $override
                foreach ($service in $app.services.Keys) { Assert-SameMounts $before[$service] (Read-Container $app.services[$service]) }
                $state = $rollbackState
                $state.failedCommit = $candidate.commit
                $state.Remove('pending')
                Save-State $statePath $state
                throw 'Candidate failed readiness; previous images restored and readiness verified. Inspect before retrying.'
            }
            # Cleanup failures must never roll back an accepted deployment.
            # Untag only recorded updater-owned references, never prune or force.
            foreach ($version in $previousVersions) {
                if (-not $version.ContainsKey('tags')) { continue }
                foreach ($service in $version.tags.Keys) {
                    $tag = [string]$version.tags[$service]
                    $pattern = '^local/cicd-rollback:' + [regex]::Escape("$($app.name)-$service-") + '[a-f0-9]{32}(-current)?$'
                    if ($tag -notmatch $pattern) { Write-Warning 'Unrecognized retention tag left untouched.'; continue }
                    try { $null = Invoke-Docker -DockerArguments @('image', 'rm', $tag) }
                    catch { Write-Warning 'Older rollback tag could not be released; retained for local inspection.' }
                }
            }
        } catch {
            $taskFailures += $app.name
            Write-Warning "$($app.name): $($_.Exception.Message)"
        }
    }
    if ($taskFailures.Count) { throw "Deployment check failed for: $($taskFailures -join ', ')." }
} finally { $taskLock.Dispose() }
