param([Parameter(Mandatory=$true)][string]$Worktree)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath($Worktree)
$cliPath = Join-Path $taskRoot 'pathfinder-engine/tools/PathFinder.ModelCheck/bin/Release/net9.0/PathFinder.ModelCheck.dll'
$scratch = Join-Path $taskRoot ('pathfinder-engine/.scratch/modelcheck-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$snapshotPath = Join-Path $scratch 'synthetic.snapshot.json'
$identity = @(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)
$snapshot = [ordered]@{
  schemaVersion='pathfinder.model.snapshot.v1'
  model=@{projectId='synthetic-cli-project';modelVersionId='synthetic-cli-model';contentSha256=('a' * 64);sourceContentSha256=$null}
  capture=@{adapterVersion='modelcheck-synthetic-smoke-v1';sourceKind='synthetic';inventoryComplete=$false;geometryComplete=$false;unitsVerified=$false;transformsVerified=$false;planningVisibilityKnown=$false;sourceLinkVerified=$false;evidenceSha256=@()}
  coordinates=@{vertexFrame='canonical-world-metres';sourceUnits='metres';metresPerSourceUnit=1;sourceToWorldMetres=$identity;globalOffsetMetres=@(0,0,0);displayToWorldMetres=$identity}
  objects=@(@{id='tray-1';parentId=$null;externalId=$null;dbId=1;name='STRAIGHT';geometryRole='routing-leaf';leafToRootNames=@('STRAIGHT','/BC001');properties=@();nativeHidden=$null;planningExcluded=$false;routeName='/BC001';shapeName='STRAIGHT';categoryAssignmentSource='unassigned';allowedCategories=@();bounds=@{minimum=@(0,-0.5,0);maximum=@(10,0.5,1)};fragments=@(@{id='fragment-1';vertices=@(@(0,-0.5,0),@(10,-0.5,0),@(0,0.5,0));triangleIndices=@(0,1,2);fragmentToWorldMetres=$identity;transformAlreadyApplied=$true})})
}
[System.IO.File]::WriteAllText($snapshotPath,($snapshot | ConvertTo-Json -Depth 30),[System.Text.UTF8Encoding]::new($false))
$cache = Join-Path $scratch 'cache'
$checks = [System.Collections.Generic.List[object]]::new()
function Invoke-Case([string]$Name,[string[]]$CliArguments,[int]$ExpectedExit) {
  $start = [System.Diagnostics.ProcessStartInfo]::new('dotnet')
  $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
  $start.ArgumentList.Add($cliPath)
  foreach($argument in $CliArguments){$start.ArgumentList.Add($argument)}
  $process = [System.Diagnostics.Process]::Start($start)
  $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
  if(-not $process.WaitForExit(10000)){ $process.Kill($true); throw 'CLI smoke exceeded 10 seconds.' }
  $resultText=$stdout.GetAwaiter().GetResult(); $errorText=$stderr.GetAwaiter().GetResult()
  $result=$resultText | ConvertFrom-Json
  $checks.Add(@{name=$Name;status=if($process.ExitCode -eq $ExpectedExit){'PASS'}else{'FAIL'};expectedExit=$ExpectedExit;actualExit=$process.ExitCode;output=$result;stderr=$errorText})
  $process.Dispose()
  return $result
}
function Arguments([string]$Route,[string]$Output,[string]$Budget='120000'){
  return @('--snapshot',$snapshotPath,'--cache',$cache,'--route',$Route,'--output',$Output,'--max-ms',$Budget,'--tolerance-metres','0.25')
}
$coldPath=Join-Path $scratch 'cold.json'; $warmPath=Join-Path $scratch 'warm.json'
$null=Invoke-Case 'cold-route' (Arguments '/BC001' $coldPath) 0
$null=Invoke-Case 'disk-route' (Arguments '/BC001' $warmPath) 0
$cold=Get-Content -LiteralPath $coldPath -Raw | ConvertFrom-Json
$warm=Get-Content -LiteralPath $warmPath -Raw | ConvertFrom-Json
$checks.Add(@{name='full-result-and-cache-readiness';status=if($cold.route.success -and $cold.route.lengthMetersR -eq '10' -and -not $cold.cache.firstReadWasDiskHit -and $warm.cache.firstReadWasDiskHit -and $cold.cache.sameRoute -and $cold.cache.sameSegments -and $cold.readiness -eq 'needs_review' -and -not $cold.readyForEngineeringWrites -and $null -eq $cold.designLength -and $cold.counts.unassignedCategoryObjects -eq 1){'PASS'}else{'FAIL'}})
$null=Invoke-Case 'no-path-label' (Arguments '/LIMIT1' (Join-Path $scratch 'no-path.json')) 3
$null=Invoke-Case 'invalid-route' (Arguments '/BAD;LABEL' (Join-Path $scratch 'invalid-route.json')) 2
$null=Invoke-Case 'invalid-budget' (Arguments '/BC001' (Join-Path $scratch 'invalid-budget.json') 'not-a-number') 2
$null=Invoke-Case 'hard-deadline' (Arguments '/BC001' (Join-Path $scratch 'deadline.json') '1') 4
$originalHash=(Get-FileHash -LiteralPath $coldPath -Algorithm SHA256).Hash
$null=Invoke-Case 'existing-receipt-rejected' (Arguments '/BC001' $coldPath) 2
$checks.Add(@{name='existing-receipt-preserved';status=if((Get-FileHash -LiteralPath $coldPath -Algorithm SHA256).Hash -eq $originalHash){'PASS'}else{'FAIL'}})
$failed=@($checks | Where-Object status -eq 'FAIL').Count
$receipt=@{stage='PF-2';scope='explicitly-synthetic-ModelCheck-CLI-smoke';observedAtUtc=[DateTimeOffset]::UtcNow.ToString('O');status=if($failed -eq 0){'PASS'}else{'FAIL'};checks=$checks;passedChecks=$checks.Count-$failed;failedChecks=$failed;scratchDirectory=$scratch;nativeConvertedParity='NOT_ESTABLISHED'}
$evidence=Join-Path $taskRoot ('docs/pathfinder/evidence/pf2/model-actual-cli-synthetic-smoke-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.json')
[System.IO.File]::WriteAllText($evidence,($receipt | ConvertTo-Json -Depth 30)+[Environment]::NewLine,[System.Text.UTF8Encoding]::new($false))
[pscustomobject]@{status=$receipt.status;passed=$receipt.passedChecks;failed=$failed;evidence=$evidence;scratch=$scratch}
if($failed -ne 0){exit 1}
