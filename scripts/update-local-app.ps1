<#
.SYNOPSIS
Build or update the existing wfc-app services without touching its database/storage.
.DESCRIPTION
Use -BuildOnly to build all three images without replacing services. To reuse
verified images, supply exact -VerifiedApiImage and -VerifiedWebImage IDs.
Supply -VerifiedConverterImage too to avoid all builds; otherwise the converter
is explicitly built from current source. Deployment pins all prior images and
restores exact environments plus converter running/stopped/absent state on failure.
.NOTES
Requires Docker Compose environment !override support (2.24.4 or later); the
rollback configuration is checked before changes. This is not a database backup.
#>
[CmdletBinding()]
param([switch]$BuildOnly, [string]$VerifiedApiImage, [string]$VerifiedWebImage, [string]$VerifiedConverterImage)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$existing = @(docker inspect wfc-app-backend-1 | ConvertFrom-Json)[0]
if ($LASTEXITCODE -ne 0 -or $existing.Config.Labels.'com.docker.compose.project' -ne 'wfc-app' -or
    $existing.Config.Labels.'com.docker.compose.service' -ne 'backend') {
  throw 'The existing wfc-app backend could not be verified.'
}
$web = @(docker inspect wfc-app-frontend-1 | ConvertFrom-Json)[0]
if ($LASTEXITCODE -ne 0 -or $web.Config.Labels.'com.docker.compose.project' -ne 'wfc-app' -or
    $web.Config.Labels.'com.docker.compose.service' -ne 'frontend') { throw 'The existing wfc-app frontend could not be verified.' }
$knownConverters = @(docker ps --all --filter name=^/wfc-app-cad-converter-1$ --format '{{.ID}}')
if ($LASTEXITCODE -ne 0 -or $knownConverters.Count -gt 1) { throw 'The prior CAD converter state is unknown.' }
$converter = $null
if ($knownConverters.Count -eq 1) {
  $converter = @(docker inspect $knownConverters[0] | ConvertFrom-Json)[0]
  if ($LASTEXITCODE -ne 0 -or $converter.Config.Labels.'com.docker.compose.project' -ne 'wfc-app' -or
      $converter.Config.Labels.'com.docker.compose.service' -ne 'cad-converter' -or $converter.State.Paused -or $converter.State.Restarting) {
    throw 'The existing CAD converter could not be verified in a stable state.'
  }
}
if (!$BuildOnly -and (!$existing.State.Running -or !$web.State.Running)) {
  throw 'Deployment requires both existing application services running; restore their intended state first.'
}
$oldApiImage = $existing.Image
$oldWebImage = $web.Image
$deploymentStarted = $false
$converterMutationStarted = $false
$rollbackPinned = $false
$rollbackSuffix = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$rollbackApiTag = "wfc-rollback-api:$rollbackSuffix"
$rollbackWebTag = "wfc-rollback-web:$rollbackSuffix"
$rollbackConverterTag = "wfc-rollback-converter:$rollbackSuffix"
$rollbackFile = $null
$temporaryNames = New-Object 'System.Collections.Generic.List[string]'
$names = @('DATABASE_URL','JWT_SECRET','CLIENT_ORIGIN','BCRYPT_ROUNDS','MINIO_ENDPOINT','MINIO_PORT',
  'MINIO_ACCESS_KEY','MINIO_SECRET_KEY','MINIO_USE_SSL','MINIO_BUCKET_PROJECTS','MINIO_BUCKET_TEMPLATES',
  'MINIO_URL_EXPIRY_SECONDS','API_USE_HTTPS','WFC_MODEL_BUCKET','WFC_CAD_DESIGN_ENABLED','WFC_CAD_CONVERTER_TOKEN','POC_CONVERTER_TOKEN','WFC_CAD_CONVERTER_URL','WFC_VIEWER_ALLOWED_ORIGINS',
  'WFC_VIEWER_ALLOW_HTTP_LOOPBACK','WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP','WFC_VIEWER_TRUST_PROXY','PF_PREPARATION_CAPACITY_PROFILE')
$previous = @{}

function Read-ContainerEnvironment($Container) {
  $values = @{}
  foreach ($entry in $Container.Config.Env) {
    $pair = $entry -split '=',2
    if ($pair.Count -ne 2 -or $values.ContainsKey($pair[0])) { throw 'The prior container environment is ambiguous.' }
    $values[$pair[0]] = $pair[1]
  }
  return $values
}
function New-RollbackService([string]$Service, [string]$Image, $Container) {
  $references = [ordered]@{}
  foreach ($entry in $Container.Config.Env) {
    $pair = $entry -split '=',2
    $name = 'WFC_UPDATER_ROLLBACK_' + $rollbackSuffix.Replace('-','_') + '_' + $temporaryNames.Count
    [Environment]::SetEnvironmentVariable($name, $pair[1], 'Process')
    [void]$temporaryNames.Add($name)
    $references[$pair[0]] = '${' + $name + '}'
  }
  # No secret values enter this file. !override removes newly introduced env
  # keys too, preserving a legacy API's absent/false CAD flag and exact tokens.
  return "  ${Service}:`n    image: ${Image}`n    environment: !override " + ($references | ConvertTo-Json -Compress -Depth 5) + "`n"
}
$backendEnvironment = Read-ContainerEnvironment $existing
$converterEnvironment = if ($converter) { Read-ContainerEnvironment $converter } else { @{} }
try {
  foreach ($name in $names) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($backendEnvironment.ContainsKey($name)) { [Environment]::SetEnvironmentVariable($name, $backendEnvironment[$name], 'Process') }
  }
  # Deployment enables ordinary CAD. Rollback uses the original complete env.
  $env:WFC_CAD_DESIGN_ENABLED = 'true'
  if ([string]::IsNullOrWhiteSpace($env:WFC_CAD_CONVERTER_TOKEN)) {
    $retainedToken = if ($backendEnvironment.ContainsKey('POC_CONVERTER_TOKEN')) { $backendEnvironment['POC_CONVERTER_TOKEN'] }
      elseif ($converterEnvironment.ContainsKey('WFC_CAD_CONVERTER_TOKEN')) { $converterEnvironment['WFC_CAD_CONVERTER_TOKEN'] }
      elseif ($converterEnvironment.ContainsKey('POC_CONVERTER_TOKEN')) { $converterEnvironment['POC_CONVERTER_TOKEN'] } else { $null }
    if (![string]::IsNullOrWhiteSpace($retainedToken)) { $env:WFC_CAD_CONVERTER_TOKEN = $retainedToken }
    else {
      # Compatible with Windows PowerShell 5.1 as well as PowerShell 7.
      $randomBytes = New-Object byte[] 32
      $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
      $env:WFC_CAD_CONVERTER_TOKEN = [BitConverter]::ToString($randomBytes).Replace('-','').ToLowerInvariant()
    }
  }
  if ($env:WFC_CAD_CONVERTER_TOKEN -notmatch '^[\x21-\x7e]{32,4096}$') { throw 'The CAD converter token is invalid.' }
  Push-Location -LiteralPath $repository
  try {
    docker compose --project-name wfc-app --file docker-compose.app.yml config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Application configuration is invalid; running services were not changed.' }
    if (!$BuildOnly) {
      $rollbackFile = Join-Path ([System.IO.Path]::GetTempPath()) ("wfc-update-rollback-$rollbackSuffix.yaml")
      $rollbackYaml = "services:`n" + (New-RollbackService backend $rollbackApiTag $existing) + (New-RollbackService frontend $rollbackWebTag $web)
      if ($converter) { $rollbackYaml += New-RollbackService cad-converter $rollbackConverterTag $converter }
      [System.IO.File]::WriteAllText($rollbackFile, $rollbackYaml)
      docker compose --project-name wfc-app --file docker-compose.app.yml --file $rollbackFile config --quiet
      if ($LASTEXITCODE -ne 0) { throw 'Safe rollback requires Docker Compose environment !override support; running services were not changed.' }
      # A stopped source container can be replaced during recreation. Keep its exact old image reachable for rollback.
      docker tag $oldApiImage $rollbackApiTag
      if ($LASTEXITCODE -ne 0) { throw 'Could not preserve the previous API image.' }
      docker tag $oldWebImage $rollbackWebTag
      if ($LASTEXITCODE -ne 0) { throw 'Could not preserve the previous web image.' }
      if ($converter) {
        docker tag $converter.Image $rollbackConverterTag
        if ($LASTEXITCODE -ne 0) { throw 'Could not preserve the previous converter image.' }
      }
      $rollbackPinned = $true
      Write-Output "Previous images retained for operator acceptance: $rollbackApiTag $rollbackWebTag"
      if ($converter) { Write-Output "Previous converter image retained: $rollbackConverterTag" }
    }
    if ($VerifiedApiImage -or $VerifiedWebImage -or $VerifiedConverterImage) {
      if (!$VerifiedApiImage -or !$VerifiedWebImage -or $BuildOnly) { throw 'Provide both verified images for deployment.' }
      $verifiedImages = @($VerifiedApiImage, $VerifiedWebImage)
      if ($VerifiedConverterImage) { $verifiedImages += $VerifiedConverterImage }
      foreach ($imageName in $verifiedImages) {
        if ($imageName -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Use an exact verified image ID.' }
        docker image inspect --format '{{.Id}}' $imageName
        if ($LASTEXITCODE -ne 0) { throw 'Verified image is not available locally.' }
      }
      if ($VerifiedConverterImage) {
        docker tag $VerifiedConverterImage wfc/cad-converter:local
        if ($LASTEXITCODE -ne 0) { throw 'Could not assign the verified converter image.' }
      } else {
        Write-Output 'API and web images are verified; the CAD converter is being built from current source.'
        docker compose --project-name wfc-app --file docker-compose.app.yml build cad-converter
        if ($LASTEXITCODE -ne 0) { throw 'CAD converter build failed.' }
      }
      docker tag $VerifiedApiImage wfc/backend:local
      if ($LASTEXITCODE -ne 0) { throw 'Could not assign the verified API image.' }
      docker tag $VerifiedWebImage wfc/frontend:local
      if ($LASTEXITCODE -ne 0) { throw 'Could not assign the verified web image.' }
    } else {
      docker compose --project-name wfc-app --file docker-compose.app.yml build cad-converter backend frontend
      if ($LASTEXITCODE -ne 0) { throw 'Application build failed; running services were not replaced.' }
    }
    if (!$BuildOnly) {
      # Recreation can replace the source container even when readiness fails.
      $converterMutationStarted = $true
      docker compose --project-name wfc-app --file docker-compose.app.yml up --detach --no-deps --no-build --pull never --wait --wait-timeout 180 cad-converter
      if ($LASTEXITCODE -ne 0) { throw 'CAD converter readiness failed.' }
      $deploymentStarted = $true
      # Existing containers may predate stop_grace_period; explicitly exceed the API's 30-second deadline.
      docker compose --project-name wfc-app --file docker-compose.app.yml stop --timeout 45 frontend backend
      if ($LASTEXITCODE -ne 0) { throw 'Application drain failed.' }
      # Nginx resolves the API alias on startup. Wait for that alias/backend to
      # exist and be healthy before creating the frontend, including with --no-deps.
      docker compose --project-name wfc-app --file docker-compose.app.yml up --detach --no-deps --no-build --pull never --wait --wait-timeout 180 backend
      if ($LASTEXITCODE -ne 0) { throw 'Application recreation or readiness failed.' }
      docker compose --project-name wfc-app --file docker-compose.app.yml up --detach --no-deps --no-build --pull never --wait --wait-timeout 180 frontend
      if ($LASTEXITCODE -ne 0) { throw 'Frontend recreation or readiness failed.' }
    }
  } finally { Pop-Location }
} catch {
  $originalFailure = $_
  if ($rollbackPinned) {
    Push-Location -LiteralPath $repository
    try {
      docker tag $oldApiImage wfc/backend:local
      if ($LASTEXITCODE -ne 0) { throw 'Rollback API image is unavailable.' }
      docker tag $oldWebImage wfc/frontend:local
      if ($LASTEXITCODE -ne 0) { throw 'Rollback web image is unavailable.' }
      if ($converter) {
        docker tag $converter.Image wfc/cad-converter:local
        if ($LASTEXITCODE -ne 0) { throw 'Rollback converter image is unavailable.' }
      }
      if ($converterMutationStarted) {
        if ($converter) {
          if ($converter.State.Running) {
            docker compose --project-name wfc-app --file docker-compose.app.yml --file $rollbackFile up --detach --no-deps --no-build --pull never --wait --wait-timeout 180 cad-converter
          } else {
            docker compose --project-name wfc-app --file docker-compose.app.yml --file $rollbackFile stop --timeout 45 cad-converter
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop the replacement converter during rollback.' }
            docker compose --project-name wfc-app --file docker-compose.app.yml --file $rollbackFile create --force-recreate --no-build --pull never cad-converter
          }
          if ($LASTEXITCODE -ne 0) { throw 'Converter rollback failed; inspect existing service health.' }
        } else {
          docker compose --project-name wfc-app --file docker-compose.app.yml rm --stop --force cad-converter
          if ($LASTEXITCODE -ne 0) { throw 'Could not remove the converter introduced by the failed update.' }
        }
      }
      if ($deploymentStarted) {
        docker compose --project-name wfc-app --file docker-compose.app.yml stop --timeout 45 frontend backend
        if ($LASTEXITCODE -ne 0) { throw 'Application rollback drain failed; inspect existing service health.' }
        docker compose --project-name wfc-app --file docker-compose.app.yml --file $rollbackFile up --detach --no-deps --no-build --pull never --wait --wait-timeout 180 backend
        if ($LASTEXITCODE -ne 0) { throw 'Application rollback failed; inspect existing service health.' }
        docker compose --project-name wfc-app --file docker-compose.app.yml --file $rollbackFile up --detach --no-deps --no-build --pull never --wait --wait-timeout 180 frontend
        if ($LASTEXITCODE -ne 0) { throw 'Frontend rollback failed; inspect existing service health.' }
      }
    } finally { Pop-Location }
  }
  throw $originalFailure
} finally {
  foreach ($name in $names) {
    if ($null -eq $previous[$name]) { Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue }
    else { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
  }
  $existing = $null
  $web = $null
  $converter = $null
  $backendEnvironment = $null
  $converterEnvironment = $null
  foreach ($name in $temporaryNames) { Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue }
  if ($rollbackFile -and [System.IO.File]::Exists($rollbackFile)) { [System.IO.File]::Delete($rollbackFile) }
}
