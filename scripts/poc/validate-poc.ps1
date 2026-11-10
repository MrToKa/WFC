#requires -Version 5.1
[CmdletBinding()]
param([switch]$CheckCompose = $true, [switch]$CheckConverter = $true)
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
        npx vitest run --maxWorkers=1 --minWorkers=1 --testTimeout=15000 src/viewer/ViewerController.test.ts src/viewer/componentTransforms.test.ts src/viewer/pocConnectorCatalog.test.ts server/cadDesign/stepFileValidation.test.ts server/cadDesign/connectionGeometry.test.ts server/middleware.test.ts src/pages/ProjectDetails/RoutingsViewerTab.test.tsx src/ProjectAccess.test.tsx
    }
    Invoke-Checked 'Materials and pinned CAD revision tests' {
        npx vitest run --maxWorkers=1 --minWorkers=1 --testTimeout=15000 server/materialCad server/cadDesign/isolation.test.ts server/cadDesign/catalogReferences.test.ts server/cadDesign/instanceDeletion.test.ts src/pages/Materials/components/MaterialComponentsSection.test.tsx src/pages/ProjectDetails/CadComponentsPanel.test.tsx src/pages/ProjectDetails/CadPlacementPanel.test.tsx
    }
    Invoke-Checked 'Complete Materials navigation, filtering and return-state' {
        npx vitest run --maxWorkers=1 --minWorkers=1 --testTimeout=15000 src/pages/Materials.test.tsx
    }
    Invoke-Checked 'Isolated catalogue clone guards' {
        node --test scripts/poc/clone-materials-catalog.test.mjs
    }
    Invoke-Checked 'Strict protected Viewer CAD protocol tests' {
        node --test scripts/viewer-runtime/module-closure.test.mjs viewer-runtime/test/cad-protocol.node-test.mjs viewer-runtime/test/cad-scene.node-test.mjs
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
    if ($CheckConverter) {
        # New PoC-tagged image only. This does not stop or restart WFC services.
        Invoke-Checked 'Build isolated CAD converter image' {
            docker build -f Dockerfile.poc-converter -t wfc-aalborg-cad-test:local .
        }
        Invoke-Checked 'Run offline CAD two-solid export/readback smoke test' {
            docker run --rm --pull never --network none --read-only --tmpfs /tmp:size=64m --memory=1g --cpus=2 --entrypoint python wfc-aalborg-cad-test:local /app/smoke.py
        }
    }
    Write-Host 'All requested local static/worker validation checks PASSED.' -ForegroundColor Green
    Write-Host 'This does NOT prove Aalborg model restore, STEP import or Viewer scene rendering.'
} finally {
    Pop-Location
}
