[CmdletBinding()]
param([string]$TestRoot = 'D:\WFC-Test', [switch]$AppOnly)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$secretDir = Join-Path $env:LOCALAPPDATA 'WFC-AI\Secrets'
if (-not $env:WFC_OPENAI_KEY_FILE) { $env:WFC_OPENAI_KEY_FILE = Join-Path $secretDir 'openai-api-key' }
if (-not (Test-Path -LiteralPath $env:WFC_OPENAI_KEY_FILE -PathType Leaf)) { throw 'Configure the project API key using Set-WfcOpenAIKey.ps1.' }
$env:WFC_ASSISTANT_SOURCE = $repo.Replace('\','/')
$env:WFC_ASSISTANT_IMAGE_TAG = (git -C $repo rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the WFC build revision.' }
$env:WFC_ASSISTANT_TOKEN_FILE = Join-Path (Split-Path $env:WFC_OPENAI_KEY_FILE) 'assistant-service-token'
if (-not (Test-Path -LiteralPath $env:WFC_ASSISTANT_TOKEN_FILE)) {
  if ($AppOnly) { throw 'Cannot update only the app: the existing assistant service token file is missing.' }
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $stream = [IO.File]::Open($env:WFC_ASSISTANT_TOKEN_FILE, 'CreateNew', 'Write', 'None')
  $encoded = [Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String($bytes))
  try { $stream.Write($encoded,0,$encoded.Length) } finally { $stream.Dispose() }
}
$containerId = @(docker ps -aq --filter 'label=com.docker.compose.project=wfc-test-app' --filter 'label=com.docker.compose.service=api')
if ($LASTEXITCODE -ne 0 -or $containerId.Count -ne 1) { throw 'Expected one existing WFC test API container (running or stopped).' }
$existing = (docker inspect $containerId | ConvertFrom-Json)[0]
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the current test configuration.' }
$files = $existing.Config.Labels.'com.docker.compose.project.config_files' -split ','
if (-not $files -or -not ($files | Where-Object { (Split-Path $_ -Leaf) -eq 'compose.app.yml' })) { throw 'Cannot identify the existing WFC test Compose files.' }
$compose = @('compose','--project-name','wfc-test-app','--project-directory',$TestRoot)
foreach ($file in $files) {
  $file = $file.Trim()
  if ((Split-Path $file -Leaf) -in @('compose.project-assistant.test.yml','compose.github-main-20261117.yml','compose.github-main-20261117.rollback.yml')) { continue }
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Current deployment file missing: $file" }
  if ((Split-Path $file -Leaf) -in @('compose.deploy.yml','compose.rollback.yml') -and
      (Select-String -LiteralPath $file -Pattern 'environment:\s*!override.*WFC_AI_BASELINE_' -Quiet)) { continue }
  $compose += @('-f',$file)
}
$compose += @('-f',(Join-Path $repo 'compose.project-assistant.test.yml'))
$priorToken = $env:WFC_CAD_CONVERTER_TOKEN
try {
  if (-not $priorToken) {
    $cadId = @(docker ps -q --filter 'label=com.docker.compose.project=wfc-test-app' --filter 'label=com.docker.compose.service=cad-converter')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the test CAD converter.' }
    $tokenSource = $existing
    if ($cadId.Count -eq 1) {
      $tokenSource = (docker inspect $cadId | ConvertFrom-Json)[0]
      if ($LASTEXITCODE -ne 0) { throw 'Cannot read the test CAD converter configuration.' }
    }
    $entry = $tokenSource.Config.Env | Where-Object { $_ -cmatch '^WFC_CAD_CONVERTER_TOKEN=\S' } | Select-Object -First 1
    if (-not $entry) { throw 'The test CAD converter token is unavailable. Supply WFC_CAD_CONVERTER_TOKEN from the test deployment.' }
    $env:WFC_CAD_CONVERTER_TOKEN = $entry.Substring('WFC_CAD_CONVERTER_TOKEN='.Length)
  }
  # Validate the effective values in memory. The rendered config contains secrets.
  $json = & docker @compose config --format json
  if ($LASTEXITCODE -ne 0) { throw 'Invalid test Compose configuration.' }
  $services = ($json | Out-String | ConvertFrom-Json).services
  foreach ($name in @('DATABASE_URL','JWT_SECRET','MINIO_ENDPOINT','MINIO_ACCESS_KEY','MINIO_SECRET_KEY','WFC_CAD_CONVERTER_TOKEN','WFC_ASSISTANT_URL')) {
    if ([string]::IsNullOrWhiteSpace($services.api.environment.$name)) { throw "Missing test API setting: $name. Check the test Compose files and app.env." }
  }
  foreach ($service in @($services.api,$services.web)) {
    if ($null -eq $service.environment) { continue }
    $pathOverride = $service.environment.PSObject.Properties['PATH']
    if ($null -ne $pathOverride -and '/usr/local/bin' -notin ($pathOverride.Value -split ':')) { throw 'Invalid Linux PATH override in the test Compose configuration.' }
  }
  if ($services.api.build.target -ne 'api-runtime' -or $services.web.build.target -ne 'web-runtime') { throw 'Unexpected WFC test image build target.' }
  $targets = @('api','web')
  if (-not $AppOnly) { $targets += 'project-assistant' }
  & docker @compose build @targets
  if ($LASTEXITCODE -ne 0) { throw 'Assistant build failed.' }
  & docker @compose up -d --pull never --no-deps --wait @targets
  if ($LASTEXITCODE -ne 0) { throw 'The test stack did not pass its readiness checks.' }
} finally { $env:WFC_CAD_CONVERTER_TOKEN = $priorToken }
