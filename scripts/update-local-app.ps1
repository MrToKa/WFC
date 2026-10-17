[CmdletBinding()]
param([switch]$BuildOnly, [string]$VerifiedApiImage, [string]$VerifiedWebImage)
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
if (!$BuildOnly -and (!$existing.State.Running -or !$web.State.Running)) {
  throw 'Deployment requires both existing application services running; restore their intended state first.'
}
$oldApiImage = $existing.Image
$oldWebImage = $web.Image
$deploymentStarted = $false
$rollbackPinned = $false
$rollbackSuffix = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$rollbackApiTag = "wfc-rollback-api:$rollbackSuffix"
$rollbackWebTag = "wfc-rollback-web:$rollbackSuffix"
$names = @('DATABASE_URL','JWT_SECRET','CLIENT_ORIGIN','BCRYPT_ROUNDS','MINIO_ENDPOINT','MINIO_PORT',
  'MINIO_ACCESS_KEY','MINIO_SECRET_KEY','MINIO_USE_SSL','MINIO_BUCKET_PROJECTS','MINIO_BUCKET_TEMPLATES',
  'MINIO_URL_EXPIRY_SECONDS','API_USE_HTTPS','WFC_MODEL_BUCKET')
$previous = @{}
try {
  foreach ($name in $names) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    $entry = @($existing.Config.Env | Where-Object { $_.StartsWith("${name}=") })
    if ($entry.Count -eq 1) { [Environment]::SetEnvironmentVariable($name, ($entry[0] -split '=',2)[1], 'Process') }
  }
  Push-Location -LiteralPath $repository
  try {
    if (!$BuildOnly) {
      # A stopped source container can be replaced during recreation. Keep its exact old image reachable for rollback.
      docker tag $oldApiImage $rollbackApiTag
      if ($LASTEXITCODE -ne 0) { throw 'Could not preserve the previous API image.' }
      docker tag $oldWebImage $rollbackWebTag
      if ($LASTEXITCODE -ne 0) { throw 'Could not preserve the previous web image.' }
      $rollbackPinned = $true
      Write-Output "Previous images retained for operator acceptance: $rollbackApiTag $rollbackWebTag"
    }
    if ($VerifiedApiImage -or $VerifiedWebImage) {
      if (!$VerifiedApiImage -or !$VerifiedWebImage -or $BuildOnly) { throw 'Provide both verified images for deployment.' }
      foreach ($imageName in @($VerifiedApiImage, $VerifiedWebImage)) {
        if ($imageName -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Use an exact verified image ID.' }
        docker image inspect --format '{{.Id}}' $imageName
        if ($LASTEXITCODE -ne 0) { throw 'Verified image is not available locally.' }
      }
      docker tag $VerifiedApiImage wfc/backend:local
      if ($LASTEXITCODE -ne 0) { throw 'Could not assign the verified API image.' }
      docker tag $VerifiedWebImage wfc/frontend:local
      if ($LASTEXITCODE -ne 0) { throw 'Could not assign the verified web image.' }
    } else {
      docker compose --project-name wfc-app --file docker-compose.app.yml build backend frontend
      if ($LASTEXITCODE -ne 0) { throw 'Application build failed; running services were not replaced.' }
    }
    if (!$BuildOnly) {
      $deploymentStarted = $true
      # Existing containers may predate stop_grace_period; explicitly exceed the API's 30-second deadline.
      docker compose --project-name wfc-app --file docker-compose.app.yml stop --timeout 45 frontend backend
      if ($LASTEXITCODE -ne 0) { throw 'Application drain failed.' }
      docker compose --project-name wfc-app --file docker-compose.app.yml up --detach --no-deps --no-build --pull never --wait --wait-timeout 180 backend frontend
      if ($LASTEXITCODE -ne 0) { throw 'Application recreation or readiness failed.' }
    }
  } finally { Pop-Location }
} catch {
  if ($rollbackPinned) {
    Push-Location -LiteralPath $repository
    try {
      docker tag $oldApiImage wfc/backend:local
      if ($LASTEXITCODE -ne 0) { throw 'Rollback API image is unavailable.' }
      docker tag $oldWebImage wfc/frontend:local
      if ($LASTEXITCODE -ne 0) { throw 'Rollback web image is unavailable.' }
      if ($deploymentStarted) {
        docker compose --project-name wfc-app --file docker-compose.app.yml stop --timeout 45 frontend backend
        docker compose --project-name wfc-app --file docker-compose.app.yml up --detach --no-deps --no-build --pull never --wait --wait-timeout 180 backend frontend
        if ($LASTEXITCODE -ne 0) { throw 'Application rollback failed; inspect existing service health.' }
      }
    } finally { Pop-Location }
  }
  throw
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
  $existing = $null
  $web = $null
}
