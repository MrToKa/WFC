[CmdletBinding()]
param(
    [string]$SourceModel = 'D:/OneDrive - ACS/R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC/3D/Aalborg_ACS_CABLETRAY_30_03_26.nwd',
    [string]$InstallDirectory = 'D:/Programs/Navisworks Manage 2027',
    [ValidateRange(30, 300)][int]$TimeoutSeconds = 300
)
# A separate alternative to the failed COM constructor; never changes registration.
$ErrorActionPreference = 'Stop'
$pfEngine = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$pfWorktree = [IO.Path]::GetFullPath((Join-Path $pfEngine '..'))
$pfScratch = [IO.Path]::GetFullPath((Join-Path $pfEngine '.scratch/pf2-native'))
if (-not $pfScratch.StartsWith($pfEngine + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Scratch escaped isolated engine.' }
$pfRunId = 'native-cli-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$pfRun = Join-Path $pfScratch $pfRunId
$pfEvidenceRoot = Join-Path $pfWorktree 'docs/pathfinder/evidence/pf2'
$pfInputRoot = Join-Path $pfScratch 'input'
New-Item -ItemType Directory -Force -Path $pfRun,$pfInputRoot,$pfEvidenceRoot | Out-Null
$pfSource = (Get-Item -LiteralPath $SourceModel).FullName
$pfSourceHash = (Get-FileHash -LiteralPath $pfSource -Algorithm SHA256).Hash.ToLowerInvariant()
$pfCopy = Join-Path $pfInputRoot ($pfSourceHash + '.nwd')
if (-not (Test-Path -LiteralPath $pfCopy)) { Copy-Item -LiteralPath $pfSource -Destination $pfCopy }
if ((Get-FileHash -LiteralPath $pfCopy -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pfSourceHash) { throw 'Owned model copy integrity failure.' }
$pfHost = [IO.Path]::GetFullPath((Join-Path $InstallDirectory 'Roamer.exe'))
$pfPlugin = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'bin/Release/Wfc.PathFinder.NativeOracle.Plugin.dll'))
foreach ($pfInput in @($pfHost,$pfPlugin)) { if (-not (Test-Path -LiteralPath $pfInput)) { throw "Missing required input: $pfInput" } }
$pfExisting = @(Get-CimInstance Win32_Process -Filter "Name='Roamer.exe'")
if (@($pfExisting | Where-Object { [string]::IsNullOrWhiteSpace($_.ExecutablePath) -or $_.ExecutablePath.Equals($pfHost,[StringComparison]::OrdinalIgnoreCase) }).Count -ne 0) { throw 'Existing Manage or unknown Roamer session preserved; no new attempt started.' }
$pfSpec = Join-Path $pfRun 'specification.json'
$pfSpecification = [ordered]@{schemaVersion='native-oracle.specification.v1';routes=@(
    [ordered]@{caseId='nwd-lookup-01';connectionGapMeters=1.0;routeText='/BC002/BC001/C001/C101/C106/C107-1/C107-2/C107-3/C107-4/C107-5/C138-1/C138-2/C138-3/C139/BC027/SECONDARY'},
    [ordered]@{caseId='nwd-lookup-02';connectionGapMeters=1.0;routeText='/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY'}
)}
[IO.File]::WriteAllText($pfSpec,($pfSpecification|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$pfOutput = Join-Path $pfRun 'capture.json'
$pfNativeLog = Join-Path $pfRun 'roamer.log'
$pfStdout = Join-Path $pfRun 'roamer.stdout.log'
$pfStderr = Join-Path $pfRun 'roamer.stderr.log'
$pfArguments = @('-HideGui','-DisableProgress','-NoCache','-log',$pfNativeLog,'-OpenFile',$pfCopy,
    '-AddPluginAssembly',$pfPlugin,'-ExecuteAddInPlugin','PathFinderNativeOracle.PF2L',$pfOutput,$pfSpec,'-Exit')
foreach ($pfArgument in $pfArguments) { if ($pfArgument.Contains('"') -or $pfArgument.EndsWith('\')) { throw 'Invalid native CLI argument.' } }
$pfArgumentLine = ($pfArguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$pfStartedUtc = [DateTime]::UtcNow
$pfProcess = Start-Process -FilePath $pfHost -ArgumentList $pfArgumentLine -WorkingDirectory $InstallDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $pfStdout -RedirectStandardError $pfStderr
$pfTimer = [Diagnostics.Stopwatch]::StartNew()
$pfTimedOut = $false
$pfOwnership = $null
$pfTerminated = $false
$pfExitCode = $null
try {
    while (-not $pfProcess.WaitForExit(500)) {
        if ($null -eq $pfOwnership) {
            $pfCandidate = Get-CimInstance Win32_Process -Filter "ProcessId=$($pfProcess.Id)" -ErrorAction SilentlyContinue
            if ($null -ne $pfCandidate -and -not [string]::IsNullOrWhiteSpace($pfCandidate.ExecutablePath) -and
                $pfCandidate.ExecutablePath.Equals($pfHost,[StringComparison]::OrdinalIgnoreCase) -and
                $pfCandidate.CreationDate.ToUniversalTime() -ge $pfStartedUtc -and
                $pfCandidate.CommandLine.IndexOf($pfOutput,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                $pfCandidate.CommandLine.IndexOf($pfSpec,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                $pfCandidate.CommandLine.IndexOf($pfPlugin,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $pfOwnership = [ordered]@{processId=$pfProcess.Id;executablePath=$pfCandidate.ExecutablePath;createdUtc=$pfCandidate.CreationDate.ToUniversalTime().ToString('o');commandLine=$pfCandidate.CommandLine}
            }
        }
        if ($pfTimer.Elapsed.TotalSeconds -ge $TimeoutSeconds) { $pfTimedOut=$true; break }
    }
    if ($pfTimedOut -and -not $pfProcess.HasExited) {
        $pfCandidate = Get-CimInstance Win32_Process -Filter "ProcessId=$($pfProcess.Id)" -ErrorAction SilentlyContinue
        if ($null -eq $pfOwnership -or $null -eq $pfCandidate -or
            -not $pfCandidate.ExecutablePath.Equals($pfHost,[StringComparison]::OrdinalIgnoreCase) -or
            $pfCandidate.CreationDate.ToUniversalTime().ToString('o') -ne $pfOwnership.createdUtc -or
            $pfCandidate.CommandLine -ne $pfOwnership.commandLine) {
            throw 'Timeout reached but full process ownership could not be revalidated; no process terminated.'
        }
        Stop-Process -Id $pfProcess.Id -Force
        $pfTerminated=$true
    }
    $pfProcess.WaitForExit()
    $pfExitCode=$pfProcess.ExitCode
} finally { $pfProcess.Dispose() }
$pfCapture=$null
$pfCaptureParseError=$null
$pfCaptureHash=$null
if (Test-Path -LiteralPath $pfOutput) {
    $pfCaptureHash=(Get-FileHash -LiteralPath $pfOutput -Algorithm SHA256).Hash.ToLowerInvariant()
    try { $pfCapture=Get-Content -LiteralPath $pfOutput -Raw | ConvertFrom-Json -Depth 100 }
    catch { $pfCaptureParseError=$_.Exception.Message }
}
$pfSourceAfter=(Get-FileHash -LiteralPath $pfSource -Algorithm SHA256).Hash.ToLowerInvariant()
$pfCopyAfter=(Get-FileHash -LiteralPath $pfCopy -Algorithm SHA256).Hash.ToLowerInvariant()
$pfPinned = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-provenance.json') -Raw | ConvertFrom-Json
$pfPinnedMatch=@($pfPinned.files | Where-Object {(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $_.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $_.sha256}).Count -eq 0
$pfReceipt=[ordered]@{schemaVersion=1;check='owned-native-cli-reference-capture';runId=$pfRunId;observedAtUtc=[DateTime]::UtcNow.ToString('o');
    startedUtc=$pfStartedUtc.ToString('o');elapsedMilliseconds=$pfTimer.ElapsedMilliseconds;exitCode=$pfExitCode;timedOut=$pfTimedOut;terminatedOwnedProcess=$pfTerminated;
    processOwnership=$pfOwnership;commandArguments=$pfArguments;officialSwitchReference='https://help.autodesk.com/cloudhelp/2022/ENU/Navisworks/files/GUID-3891FB9F-7BF1-4510-A1EE-121E975C0ACE.htm';
    switchVerificationScope='Primary Autodesk command-line documentation; actual installed2027 execution outcome is recorded separately.';
    nativeHost=$pfHost;hostFileVersion=(Get-Item -LiteralPath $pfHost).VersionInfo.FileVersion;plugin=$pfPlugin;pluginSha256=(Get-FileHash -LiteralPath $pfPlugin -Algorithm SHA256).Hash.ToLowerInvariant();
    sourceModel=$pfSource;sourceSha256Before=$pfSourceHash;sourceSha256After=$pfSourceAfter;sourcePreserved=($pfSourceHash -eq $pfSourceAfter);
    ownedCopiedModel=$pfCopy;copySha256After=$pfCopyAfter;copyPreserved=($pfSourceHash -eq $pfCopyAfter);pinnedSourceCount=$pfPinned.files.Count;pinnedSourcesMatch=$pfPinnedMatch;
    ownedRunDirectory=$pfRun;stdout=$pfStdout;stderr=$pfStderr;nativeLog=$pfNativeLog;
    capture=$pfOutput;captureSha256=$pfCaptureHash;captureParseError=$pfCaptureParseError;captureStatus=$pfCapture.status;
    capturedRequests=@($pfCapture.requests | Where-Object {$null -ne $_} | ForEach-Object {[ordered]@{caseId=$_.caseId;lookupSuccess=$_.lookup.success;lengthMetersR=$_.lookup.lengthMetersR;diagnostics=$_.diagnostics;
        automaticCases=@($_.automaticCases | Where-Object {$null -ne $_} | ForEach-Object {[ordered]@{caseId=$_.caseId;success=$_.route.success;lengthMetersR=$_.route.lengthMetersR;fromRequiresSecondary=$_.route.fromRequiresSecondary;toRequiresSecondary=$_.route.toRequiresSecondary;design=$_.design}})}});
    parityClaim=$false;sourceModelSaved=$false;installedPluginChanged=$false;registryOrStartupChanged=$false;
    status=if($pfCapture.status -eq 'captured' -and $pfExitCode -eq 0 -and -not $pfTimedOut -and $pfSourceAfter -eq $pfSourceHash -and $pfCopyAfter -eq $pfSourceHash -and $pfPinnedMatch){'CAPTURED'}else{'BLOCKED'}}
$pfReceiptPath=Join-Path $pfEvidenceRoot ($pfRunId+'.json')
[IO.File]::WriteAllText($pfReceiptPath,($pfReceipt|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))
Write-Output ($pfReceipt|ConvertTo-Json -Depth 16)
if($pfReceipt.status -ne 'CAPTURED'){exit 1}
