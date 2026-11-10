#requires -Version 5.1
[CmdletBinding()]
param([switch]$CheckCompose = $true)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$expected = 'feature/aalborg-step-routings-builder-poc-20261110'
$current = (& git -C $repo branch --show-current)
if ($LASTEXITCODE -ne 0 -or $current.Trim() -ne $expected) {
    throw "Wrong Git worktree; expected $expected."
}
if (-not (Test-Path (Join-Path $repo 'package-lock.json'))) {
    throw 'PoC repo is missing its lockfile.'
}
Push-Location $repo
try {
    $nodeMajor = (& node --version)
    if ($LASTEXITCODE -ne 0 -or $nodeMajor -notmatch '^v24\.') {
        throw "Node.js 24 is required by this WFC repo; detected: $nodeMajor"
    }
    function Invoke-Checked([string]$Label, [scriptblock]$Action) {
        Write-Host "Checking: $Label" -ForegroundColor Cyan
        & $Action
        if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)." }
    }
    Invoke-Checked 'Locked npm installation' { npm ci }
    Invoke-Checked 'Frontend/server TypeScript' { npm run typecheck }
    Invoke-Checked 'Lint' { npm run lint }
    Invoke-Checked 'CAD and Viewer focused unit tests' {
        npx vitest run --maxWorkers=1 --minWorkers=1 src/viewer/componentTransforms.test.ts src/viewer/pocConnectorCatalog.test.ts server/cadDesign/stepFileValidation.test.ts server/cadDesign/connectionGeometry.test.ts server/middleware.test.ts src/pages/ProjectDetails/RoutingsViewerTab.test.tsx src/ProjectAccess.test.tsx
    }
    Invoke-Checked 'Strict protected Viewer CAD protocol tests' {
        node --test viewer-runtime/test/cad-protocol.node-test.mjs
    }
    Invoke-Checked 'Build frontend' { npm run build }
    Invoke-Checked 'Build backend' { npm run server:build }
    if ($CheckCompose) {
        $private = Join-Path $repo '.env.poc'
        if (-not (Test-Path -LiteralPath $private)) {
            throw 'Run scripts/poc/initialize-poc-env.ps1 to create private .env.poc before checking Compose.'
        }
        # --quiet prevents secret-bearing output.
        Invoke-Checked 'Isolated PoC compose config (secrets hidden)' {
            docker compose --env-file .env.poc -f compose.poc.yaml -p wfc-aalborg-poc config --quiet
        }
    }
    Write-Host 'All requested local static validation checks PASSED.' -ForegroundColor Green
    Write-Host 'This does NOT prove Aalborg model restore, STEP import or Viewer scene rendering.'
} finally {
    Pop-Location
}
