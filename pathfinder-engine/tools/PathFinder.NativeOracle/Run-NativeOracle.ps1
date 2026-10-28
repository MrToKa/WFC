[CmdletBinding()]
param(
    [string]$SourceModel = 'D:/OneDrive - ACS/R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC/3D/Aalborg_ACS_CABLETRAY_30_03_26.nwd',
    [string]$InstallDirectory = 'D:/Programs/Navisworks Manage 2027',
    [ValidateRange(30, 300)][int]$TimeoutSeconds = 300
)
$ErrorActionPreference = 'Stop'
$pfEngine = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$pfWorktree = [IO.Path]::GetFullPath((Join-Path $pfEngine '..'))
$pfScratch = [IO.Path]::GetFullPath((Join-Path $pfEngine '.scratch/pf2-native'))
if (-not $pfScratch.StartsWith($pfEngine + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Scratch escaped the isolated engine directory.' }
$pfRunId = 'native-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$pfRun = Join-Path $pfScratch $pfRunId
$pfInputRoot = Join-Path $pfScratch 'input'
$pfEvidenceRoot = Join-Path $pfWorktree 'docs/pathfinder/evidence/pf2'
New-Item -ItemType Directory -Force -Path $pfRun,$pfInputRoot,$pfEvidenceRoot | Out-Null
$pfSource = (Get-Item -LiteralPath $SourceModel).FullName
$pfSourceHash = (Get-FileHash -LiteralPath $pfSource -Algorithm SHA256).Hash.ToLowerInvariant()
$pfCopy = Join-Path $pfInputRoot ($pfSourceHash + '.nwd')
if (-not (Test-Path -LiteralPath $pfCopy)) { Copy-Item -LiteralPath $pfSource -Destination $pfCopy }
if ((Get-FileHash -LiteralPath $pfCopy -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pfSourceHash) { throw 'Owned model copy hash mismatch.' }
$pfRunnerPath = Join-Path $PSScriptRoot 'bin/Release/Wfc.PathFinder.NativeOracle.Runner.exe'
$pfPluginPath = Join-Path $PSScriptRoot 'bin/Release/Wfc.PathFinder.NativeOracle.Plugin.dll'
foreach ($pfRequired in @($pfRunnerPath,$pfPluginPath)) { if (-not (Test-Path -LiteralPath $pfRequired)) { throw "Build required: $pfRequired" } }
$pfExpectedHost = [IO.Path]::GetFullPath((Join-Path $InstallDirectory 'Roamer.exe'))
$pfExisting = @(Get-CimInstance Win32_Process -Filter "Name='Roamer.exe'")
if (@($pfExisting | Where-Object { [string]::IsNullOrWhiteSpace($_.ExecutablePath) -or $_.ExecutablePath.Equals($pfExpectedHost,[StringComparison]::OrdinalIgnoreCase) }).Count -ne 0) {
    throw 'Existing Manage or unknown Roamer session detected; preserved without launching another host.'
}
$pfSpec = Join-Path $pfRun 'specification.json'
$pfSpecValue = [ordered]@{schemaVersion='native-oracle.specification.v1';routes=@(
    [ordered]@{caseId='nwd-lookup-01';connectionGapMeters=1.0;routeText='/BC002/BC001/C001/C101/C106/C107-1/C107-2/C107-3/C107-4/C107-5/C138-1/C138-2/C138-3/C139/BC027/SECONDARY'},
    [ordered]@{caseId='nwd-lookup-02';connectionGapMeters=1.0;routeText='/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY'}
)}
[IO.File]::WriteAllText($pfSpec,($pfSpecValue | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$pfOutput = Join-Path $pfRun 'capture.json'
$pfArguments = @($InstallDirectory,$pfCopy,$pfPluginPath,$pfOutput,$pfSpec)
foreach ($pfArgument in $pfArguments) { if ($pfArgument.Contains('"') -or $pfArgument.EndsWith('\')) { throw 'Invalid runner path.' } }
$pfArgumentLine = ($pfArguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$pfStartedUtc = [DateTime]::UtcNow
$pfOwnedHosts = New-Object 'System.Collections.Generic.Dictionary[int,datetime]'
function Record-OwnedHosts {
    foreach ($pfCandidate in @(Get-CimInstance Win32_Process -Filter "Name='Roamer.exe'")) {
        if ([string]::IsNullOrWhiteSpace($pfCandidate.ExecutablePath)) { continue }
        if (-not $pfCandidate.ExecutablePath.Equals($pfExpectedHost,[StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($pfCandidate.CommandLine -notmatch '(?i)(?:^|\s)-Embedding(?:\s|$)') { continue }
        $pfCreated = $pfCandidate.CreationDate.ToUniversalTime()
        if ($pfCreated -lt $pfStartedUtc) { continue }
        $pfOwnedHosts[[int]$pfCandidate.ProcessId] = $pfCreated
    }
}
$pfStdout = Join-Path $pfRun 'runner.stdout.log'
$pfStderr = Join-Path $pfRun 'runner.stderr.log'
$pfRunner = Start-Process -FilePath $pfRunnerPath -ArgumentList $pfArgumentLine -WorkingDirectory $InstallDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $pfStdout -RedirectStandardError $pfStderr
$pfTimer = [Diagnostics.Stopwatch]::StartNew()
$pfTimedOut = $false
$pfRunnerExit = $null
try {
    while (-not $pfRunner.WaitForExit(500)) {
        Record-OwnedHosts
        if ($pfTimer.Elapsed.TotalSeconds -ge $TimeoutSeconds) { $pfTimedOut=$true; break }
    }
    if ($pfTimedOut -and -not $pfRunner.HasExited) { Stop-Process -Id $pfRunner.Id -Force }
    $pfRunner.WaitForExit()
    $pfRunnerExit = $pfRunner.ExitCode
} finally {
    Record-OwnedHosts
    foreach ($pfOwnedId in @($pfOwnedHosts.Keys)) {
        $pfCandidate = Get-CimInstance Win32_Process -Filter "ProcessId=$pfOwnedId" -ErrorAction SilentlyContinue
        if ($null -eq $pfCandidate -or [string]::IsNullOrWhiteSpace($pfCandidate.ExecutablePath)) { continue }
        if (-not $pfCandidate.ExecutablePath.Equals($pfExpectedHost,[StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($pfCandidate.CommandLine -notmatch '(?i)(?:^|\s)-Embedding(?:\s|$)' -or $pfCandidate.CreationDate.ToUniversalTime() -ne $pfOwnedHosts[$pfOwnedId]) { continue }
        $pfNativeProcess = Get-Process -Id $pfOwnedId -ErrorAction SilentlyContinue
        if ($null -ne $pfNativeProcess -and $pfNativeProcess.MainWindowHandle -eq [IntPtr]::Zero) { Stop-Process -Id $pfOwnedId -Force }
    }
    $pfRunner.Dispose()
}
$pfSourceHashAfter = (Get-FileHash -LiteralPath $pfSource -Algorithm SHA256).Hash.ToLowerInvariant()
$pfCopyHashAfter = (Get-FileHash -LiteralPath $pfCopy -Algorithm SHA256).Hash.ToLowerInvariant()
$pfCapture = $null
$pfCaptureHash = $null
if (Test-Path -LiteralPath $pfOutput) {
    $pfCapture = Get-Content -LiteralPath $pfOutput -Raw | ConvertFrom-Json -Depth 100
    $pfCaptureHash = (Get-FileHash -LiteralPath $pfOutput -Algorithm SHA256).Hash.ToLowerInvariant()
}
$pfReceipt = [ordered]@{schemaVersion=1;check='owned-native-reference-capture';runId=$pfRunId;startedUtc=$pfStartedUtc.ToString('o');elapsedMilliseconds=$pfTimer.ElapsedMilliseconds;
    runnerExitCode=$pfRunnerExit;timedOut=$pfTimedOut;captureStatus=$pfCapture.status;
    sourceModel=$pfSource;sourceBytes=(Get-Item -LiteralPath $pfSource).Length;sourceSha256Before=$pfSourceHash;sourceSha256After=$pfSourceHashAfter;
    copiedModel=$pfCopy;copiedSha256After=$pfCopyHashAfter;sourcePreserved=($pfSourceHash -eq $pfSourceHashAfter);copiedModelPreserved=($pfSourceHash -eq $pfCopyHashAfter);
    ownedRunDirectory=$pfRun;capture=$pfOutput;captureSha256=$pfCaptureHash;nativeHost=$pfExpectedHost;
    hostFileVersion=(Get-Item -LiteralPath $pfExpectedHost).VersionInfo.FileVersion;pluginSha256=(Get-FileHash -LiteralPath $pfPluginPath -Algorithm SHA256).Hash.ToLowerInvariant();
    provenanceSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'source-provenance.json') -Algorithm SHA256).Hash.ToLowerInvariant();
    capturedRequests=@($pfCapture.requests | Where-Object { $null -ne $_ } | ForEach-Object { [ordered]@{caseId=$_.caseId;lookupSuccess=$_.lookup.success;lengthMetersR=$_.lookup.lengthMetersR;diagnostics=$_.diagnostics;automaticCases=@($_.automaticCases | Where-Object { $null -ne $_ } | ForEach-Object {[ordered]@{caseId=$_.caseId;success=$_.route.success;lengthMetersR=$_.route.lengthMetersR;fromRequiresSecondary=$_.route.fromRequiresSecondary;toRequiresSecondary=$_.route.toRequiresSecondary;design=$_.design}})} });
    parityClaim=$false;notes='Actual selected-network native reference only; converted pairing and true equipment identities require separate verification.'}
$pfReceiptPath = Join-Path $pfEvidenceRoot ($pfRunId + '.json')
[IO.File]::WriteAllText($pfReceiptPath,($pfReceipt | ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
Write-Output ($pfReceipt | ConvertTo-Json -Depth 15)
if ($pfTimedOut -or $pfRunnerExit -ne 0 -or $pfCapture.status -ne 'captured' -or -not $pfReceipt.sourcePreserved -or -not $pfReceipt.copiedModelPreserved) { exit 1 }
