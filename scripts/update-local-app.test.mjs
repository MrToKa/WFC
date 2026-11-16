import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Execute the actual updater under PowerShell with a function replacing Docker.
// No container, image, database, credential or deployment is accessed.
const updater = fileURLToPath(new URL('./update-local-app.ps1', import.meta.url));
const image = value => 'sha256:' + value.repeat(64);
const apiEnv = { DATABASE_URL: 'postgres://fixture', JWT_SECRET: 'fixture-jwt', MINIO_ENDPOINT: 'fixture-storage',
  MINIO_ACCESS_KEY: 'fixture-key', MINIO_SECRET_KEY: 'fixture-secret', WFC_CAD_DESIGN_ENABLED: 'true',
  WFC_CAD_CONVERTER_TOKEN: 'old-canonical-'.repeat(4), WFC_CAD_CONVERTER_URL: 'http://cad-converter:8090/convert',
  WFC_VIEWER_ALLOWED_ORIGINS: 'http://fixture.invalid', PF_PREPARATION_CAPACITY_PROFILE: 'fixture-profile',
  WFC_PREPARER_INTERNAL_ORIGIN: 'http://preparer:8080', WFC_PREPARER_PUBLIC_ORIGIN: 'http://fixture.invalid:8083' };
const original = (converter = 'running', legacy = false) => ({
  backend: { image: image('a'), running: true, environment: legacy ? Object.fromEntries(Object.entries(apiEnv).filter(([name]) => !name.startsWith('WFC_CAD_'))) : { ...apiEnv } },
  frontend: { image: image('b'), running: true, environment: { FIXTURE_FRONTEND: 'retained' } },
  converter: converter === 'absent' ? null : { image: image('c'), running: converter === 'running',
    environment: legacy ? { POC_CONVERTER_TOKEN: 'legacy-converter-'.repeat(3), PYTHONUNBUFFERED: '1' }
      : { WFC_CAD_CONVERTER_TOKEN: apiEnv.WFC_CAD_CONVERTER_TOKEN, PYTHONUNBUFFERED: '1' } },
});
const harness = String.raw`
param([string]$FixturePath,[string]$UpdaterPath,[string]$OutputPath)
$ErrorActionPreference='Stop'
$fixture=Get-Content -LiteralPath $FixturePath -Raw | ConvertFrom-Json
$global:Events=New-Object 'System.Collections.Generic.List[object]'
$global:State=@{backend=$fixture.original.backend;frontend=$fixture.original.frontend;converter=$fixture.original.converter}
$global:Images=@{'wfc/backend:local'=$fixture.original.backend.image;'wfc/frontend:local'=$fixture.original.frontend.image;'wfc/cad-converter:local'='sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'}
$global:InjectedFailure=$false
$global:BackendHealthy=$true
$global:SecretFreeOverrides=$true
$env:WFC_CAD_CONVERTER_TOKEN=$null
$env:WFC_CAD_DESIGN_ENABLED='process-original'
$env:WFC_PREPARER_INTERNAL_ORIGIN='http://process-original.invalid:8083'
$env:WFC_PREPARER_PUBLIC_ORIGIN='http://process-original.invalid:8083'
function global:docker {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$DockerArgs)
  [void]$global:Events.Add(@{args=$DockerArgs;token=$env:WFC_CAD_CONVERTER_TOKEN;cadEnabled=$env:WFC_CAD_DESIGN_ENABLED})
  $global:LASTEXITCODE=0
  if($DockerArgs[0] -eq 'ps'){if($global:State.converter){Write-Output 'converter-old'};return}
  if($DockerArgs[0] -eq 'inspect'){
    $service=switch($DockerArgs[1]){'wfc-app-backend-1'{'backend'} 'wfc-app-frontend-1'{'frontend'} 'converter-old'{'converter'} default{throw 'Unexpected inspect'}}
    $item=$global:State[$service];$label=if($service -eq 'converter'){'cad-converter'}else{$service}
    $entries=@($item.environment.PSObject.Properties | ForEach-Object {$_.Name+'='+[string]$_.Value})
    Write-Output (@{Image=$item.image;State=@{Running=$item.running;Paused=$false;Restarting=$false};Config=@{Env=$entries;Labels=@{'com.docker.compose.project'='wfc-app';'com.docker.compose.service'=$label}}}|ConvertTo-Json -Depth 9 -Compress);return
  }
  if($DockerArgs[0] -eq 'tag'){
    $source=$DockerArgs[1];$global:Images[$DockerArgs[2]]=if($global:Images.ContainsKey($source)){$global:Images[$source]}else{$source};return
  }
  if($DockerArgs[0] -eq 'image'){Write-Output $DockerArgs[-1];return}
  if($DockerArgs[0] -ne 'compose'){throw 'Unexpected Docker command'}
  $files=@();for($i=0;$i -lt $DockerArgs.Count-1;$i++){if($DockerArgs[$i] -eq '--file'){$files+=,$DockerArgs[$i+1]}}
  $rollback=$files.Count -gt 1
  if($DockerArgs -contains 'config'){if($rollback -and $fixture.failure -eq 'unsupported-override'){$global:LASTEXITCODE=1};return}
  if($DockerArgs -contains 'build'){
    if($fixture.failure -eq 'build'){$global:LASTEXITCODE=1;return}
    if($DockerArgs -contains 'backend'){$global:Images['wfc/backend:local']='sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'}
    if($DockerArgs -contains 'frontend'){$global:Images['wfc/frontend:local']='sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'}
    $global:Images['wfc/cad-converter:local']='sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';return
  }
  $op=@('up','stop','create','rm')|Where-Object {$DockerArgs -contains $_}|Select-Object -First 1
  if(!$op){throw 'Unexpected Compose operation'}
  $services=@('cad-converter','backend','frontend')|Where-Object {$DockerArgs -contains $_}
  if($op -eq 'up' -and $services -contains 'frontend' -and (!$global:BackendHealthy -or $services -contains 'backend')){
    throw 'Frontend started before an independently completed backend health wait'
  }
  foreach($name in $services){
    $key=if($name -eq 'cad-converter'){'converter'}else{$name}
    if($op -eq 'rm'){$global:State[$key]=$null;continue}
    if($op -eq 'stop'){if($global:State[$key]){$global:State[$key].running=$false};if($key -eq 'backend'){$global:BackendHealthy=$false};continue}
    if($rollback){
      $text=Get-Content -LiteralPath $files[-1] -Raw
      if($text.Contains('fixture-secret') -or $text.Contains('old-canonical') -or $text.Contains('legacy-converter')){$global:SecretFreeOverrides=$false}
      $pattern='(?m)^  '+[regex]::Escape($name)+':\r?\n    image: ([^\r\n]+)\r?\n    environment: !override ([^\r\n]+)'
      $match=[regex]::Match($text,$pattern);if(!$match.Success){throw 'Missing rollback service'}
      $refs=$match.Groups[2].Value|ConvertFrom-Json;$values=@{}
      foreach($entry in $refs.PSObject.Properties){
        if([string]$entry.Value -notmatch '^\$\{([^}]+)\}$'){throw 'Rollback file contains a literal value'}
        $values[$entry.Name]=[Environment]::GetEnvironmentVariable($matches[1],'Process')
      }
      $global:State[$key]=@{image=$global:Images[$match.Groups[1].Value];environment=$values;running=$op -eq 'up'}
    }else{
      $target=switch($name){'cad-converter'{'wfc/cad-converter:local'} 'backend'{'wfc/backend:local'} 'frontend'{'wfc/frontend:local'}}
      $values=@{WFC_CAD_CONVERTER_TOKEN=$env:WFC_CAD_CONVERTER_TOKEN;WFC_CAD_DESIGN_ENABLED=$env:WFC_CAD_DESIGN_ENABLED}
      if($key -eq 'backend'){$values.WFC_PREPARER_INTERNAL_ORIGIN=$env:WFC_PREPARER_INTERNAL_ORIGIN;$values.WFC_PREPARER_PUBLIC_ORIGIN=$env:WFC_PREPARER_PUBLIC_ORIGIN}
      $global:State[$key]=@{image=$global:Images[$target];environment=$values;running=$true}
    }
  }
  if(!$rollback -and !$global:InjectedFailure -and (($fixture.failure -eq 'converter' -and $services -contains 'cad-converter' -and $op -eq 'up') -or
      ($fixture.failure -eq 'api' -and $services -contains 'backend' -and $op -eq 'up'))){$global:InjectedFailure=$true;$global:LASTEXITCODE=1}
  if($op -eq 'up' -and $services -contains 'backend'){$global:BackendHealthy=$global:LASTEXITCODE -eq 0}
}
$failure=$null
try{
  $parameters=@{};if($fixture.buildOnly){$parameters.BuildOnly=$true}
  if($fixture.verified){$parameters.VerifiedApiImage=$fixture.verified.api;$parameters.VerifiedWebImage=$fixture.verified.web
    if($fixture.verified.converter){$parameters.VerifiedConverterImage=$fixture.verified.converter}}
  & $UpdaterPath @parameters
}catch{$failure=$_.Exception.Message}
@{failure=$failure;state=$global:State;events=@($global:Events.ToArray());secretFreeOverrides=$global:SecretFreeOverrides;
  processToken=$env:WFC_CAD_CONVERTER_TOKEN;processFlag=$env:WFC_CAD_DESIGN_ENABLED;
  processPreparerInternal=$env:WFC_PREPARER_INTERNAL_ORIGIN;processPreparerPublic=$env:WFC_PREPARER_PUBLIC_ORIGIN;
  temporaryVariables=@([Environment]::GetEnvironmentVariables('Process').Keys|Where-Object {[string]$_ -like 'WFC_UPDATER_ROLLBACK_*'})
}|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $OutputPath
`;
function run(input = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfc-updater-mock-'));
  try {
    const source = { original: original(), failure: null, ...input };
    fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify(source));
    fs.writeFileSync(path.join(root, 'harness.ps1'), harness);
    const result = spawnSync(process.env.WFC_UPDATER_TEST_PWSH || 'pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'harness.ps1'),
      '-FixturePath', path.join(root, 'fixture.json'), '-UpdaterPath', updater, '-OutputPath', path.join(root, 'out.json')], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const value = JSON.parse(fs.readFileSync(path.join(root, 'out.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(value.processToken || null, null); assert.equal(value.processFlag, 'process-original');
    assert.equal(value.processPreparerInternal, 'http://process-original.invalid:8083');
    assert.equal(value.processPreparerPublic, 'http://process-original.invalid:8083');
    assert.deepEqual(value.temporaryVariables, []); assert.equal(value.secretFreeOverrides, true);
    return { ...value, stdout: result.stdout, original: source.original };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('converter readiness failure restores its exact old image, running state and token before touching the application', () => {
  const value = run({ failure: 'converter' });
  assert.match(value.failure, /converter readiness/i); assert.deepEqual(value.state, value.original);
  assert.equal(value.events.some(event => event.args.includes('stop') && event.args.includes('backend')), false);
});
test('late API readiness failure restores all three images and exact old environments', () => {
  const value = run({ failure: 'api' }); assert.match(value.failure, /recreation or readiness/i);
  assert.deepEqual(value.state, value.original);
});
test('rollback preserves a converter that was intentionally stopped', () => {
  const value = run({ failure: 'api', original: original('stopped') });
  assert.deepEqual(value.state, value.original);
  assert.ok(value.events.some(event => event.args.includes('create') && event.args.includes('cad-converter')));
});
test('rollback removes a newly introduced converter and restores a legacy API without CAD environment keys', () => {
  const value = run({ failure: 'api', original: original('absent', true) }); assert.deepEqual(value.state, value.original);
  assert.ok(value.events.some(event => event.args.includes('rm') && event.args.includes('cad-converter')));
});
test('rollback restores legacy-only converter token presence without leaving an empty canonical override', () => {
  const value = run({ failure: 'api', original: original('running', true) }); assert.deepEqual(value.state, value.original);
  assert.equal(value.state.converter.environment.WFC_CAD_CONVERTER_TOKEN, undefined);
});
test('BuildOnly builds without image pins or running-state changes', () => {
  const value = run({ buildOnly: true }); assert.equal(value.failure, null); assert.deepEqual(value.state, value.original);
  assert.equal(value.events.some(event => event.args.some(arg => ['up', 'stop', 'create', 'rm', 'tag'].includes(arg))), false);
});
test('unsupported safe environment override fails before builds or service mutations', () => {
  const value = run({ failure: 'unsupported-override' }); assert.match(value.failure, /safe rollback requires/i);
  assert.deepEqual(value.state, value.original); assert.equal(value.events.some(event => event.args.includes('build') || event.args.includes('up')), false);
});
test('all three verified image IDs avoid builds and deploy exactly those images', () => {
  const verified = { api: image('1'), web: image('2'), converter: image('3') }, value = run({ verified });
  assert.equal(value.failure, null); assert.equal(value.events.some(event => event.args.includes('build')), false);
  assert.equal(value.state.backend.image, verified.api); assert.equal(value.state.frontend.image, verified.web); assert.equal(value.state.converter.image, verified.converter);
});

test('ordinary updates retain both configured preparer gateway origins', () => {
  const value = run(); assert.equal(value.failure, null);
  assert.equal(value.state.backend.environment.WFC_PREPARER_INTERNAL_ORIGIN, apiEnv.WFC_PREPARER_INTERNAL_ORIGIN);
  assert.equal(value.state.backend.environment.WFC_PREPARER_PUBLIC_ORIGIN, apiEnv.WFC_PREPARER_PUBLIC_ORIGIN);
});
test('verified API/web without a converter ID explicitly builds only the converter', () => {
  const value = run({ verified: { api: image('1'), web: image('2') } }); assert.equal(value.failure, null);
  const builds = value.events.filter(event => event.args.includes('build')); assert.equal(builds.length, 1);
  assert.ok(builds[0].args.includes('cad-converter')); assert.equal(builds[0].args.includes('backend'), false);
  assert.match(value.stdout, /converter is being built from current source/);
});
test('first activation generates the same unpredictable 64-hex token for both new services', () => {
  const value = run({ original: original('absent', true) }); assert.equal(value.failure, null);
  const token = value.state.backend.environment.WFC_CAD_CONVERTER_TOKEN; assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(value.state.converter.environment.WFC_CAD_CONVERTER_TOKEN, token);
});
test('deployment starts and waits for converter, backend, then frontend in separate operations', () => {
  const value = run(); assert.equal(value.failure, null);
  const starts = value.events.filter(event => event.args.includes('up'));
  assert.deepEqual(starts.map(event => event.args.at(-1)), ['cad-converter', 'backend', 'frontend']);
  assert.ok(starts.every(event => event.args.includes('--wait')));
});
test('rollback also waits for the restored backend before creating its frontend', () => {
  const value = run({ failure: 'api' }); assert.deepEqual(value.state, value.original);
  const starts = value.events.filter(event => event.args.includes('up'));
  assert.deepEqual(starts.map(event => event.args.at(-1)), ['cad-converter', 'backend', 'cad-converter', 'backend', 'frontend']);
  assert.ok(starts.every(event => event.args.includes('--wait')));
});
