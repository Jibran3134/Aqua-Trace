<#
.SYNOPSIS
  Start the AquaTrace stack for local integration.

.DESCRIPTION
  Brings up the backend (PostgreSQL + Redis + API via Docker) and the Vite dev
  server, then waits until the signature library is built.

  First run is slow: the API image installs WNTR/SciPy and the signature library
  runs hundreds of hydraulic simulations. The result is cached in a Docker volume,
  so later runs start quickly.

.PARAMETER Mocks
  Skip the backend entirely and run the frontend against the in-browser mock
  engine (the offline/airplane-mode demo).

.PARAMETER NoFrontend
  Start only the backend.

.EXAMPLE
  ./dev.ps1
.EXAMPLE
  ./dev.ps1 -Mocks
#>
[CmdletBinding()]
param(
    [switch]$Mocks,
    [switch]$NoFrontend
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$envLocal = Join-Path $root "frontend/.env.local"

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

if ($Mocks) {
    Write-Step "Mock mode: writing frontend/.env.local (VITE_USE_MOCKS=true)"
    Set-Content -Path $envLocal -Value @(
        "# Offline demo: in-browser mock engine, no backend required."
        "VITE_USE_MOCKS=true"
        "VITE_API_URL=http://localhost:8000"
    )
}
else {
    $backend = Join-Path $root "backend"

    if (-not (Test-Path (Join-Path $backend ".env"))) {
        Write-Step "Generating backend/.env (local credentials, gitignored)"
        python (Join-Path $backend "scripts/init_env.py")
    }

    Write-Step "Starting backend (this builds the image on first run)"
    Push-Location $backend
    try {
        docker compose up --build -d
        if ($LASTEXITCODE -ne 0) { throw "docker compose failed. Is Docker Desktop running?" }
    }
    finally { Pop-Location }

    Write-Step "Waiting for signatures (first build can take several minutes)"
    $deadline = (Get-Date).AddMinutes(25)
    while ((Get-Date) -lt $deadline) {
        try {
            $h = Invoke-RestMethod -Uri "http://localhost:8000/health" -TimeoutSec 5
            $pct = [math]::Round(($h.signatures_progress * 100), 0)
            Write-Host ("  signatures {0}%  db={1}  redis={2}" -f $pct, $h.database, $h.redis)
            if ($h.signatures_ready) { break }
        }
        catch { Write-Host "  API not answering yet..." }
        Start-Sleep -Seconds 10
    }

    Write-Step "Pointing the frontend at the real backend"
    Set-Content -Path $envLocal -Value @(
        "# Local integration run: real backend instead of the mock engine."
        "VITE_USE_MOCKS=false"
        "VITE_API_URL=http://localhost:8000"
    )
}

if ($NoFrontend) {
    Write-Step "Backend only. Start the UI with: cd frontend; npm run dev"
    return
}

Write-Step "Starting the frontend on http://localhost:5173"
Push-Location (Join-Path $root "frontend")
try {
    if (-not (Test-Path "node_modules")) { npm ci }
    npm run dev
}
finally { Pop-Location }
