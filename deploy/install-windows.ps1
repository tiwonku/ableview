#Requires -Version 5.1
<#
.SYNOPSIS
  Install AbleView as a Windows service (NSSM) with boot start and crash restart.

.DESCRIPTION
  Run elevated from the AbleView install directory (or pass -InstallDir).
  Preflight checks, optional smoke test, then registers NSSM to run deploy/run-production.mjs.

.PARAMETER InstallDir
  AbleView install path (default: C:\AbleView).

.PARAMETER NodePath
  Path to node.exe (default: auto-detect via Get-Command).

.PARAMETER ServiceName
  Windows service name (default: AbleView).

.PARAMETER SkipSmokeTest
  Skip pre-install /health smoke test.

.EXAMPLE
  cd C:\AbleView
  .\deploy\install-windows.ps1
#>
param(
    [string]$InstallDir = 'C:\AbleView',
    [string]$NodePath = '',
    [string]$ServiceName = 'AbleView',
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Error $msg; exit 1 }

function Get-DotEnvValue {
    param([string]$Path, [string]$Key)
    if (-not (Test-Path $Path)) { return $null }
    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Resolve-InstallPath {
    param([string]$Base, [string]$Relative)
    if ([System.IO.Path]::IsPathRooted($Relative)) { return $Relative }
    return Join-Path $Base $Relative
}

function Get-LanIp {
    $addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -ne '127.0.0.1' -and
            $_.PrefixOrigin -ne 'WellKnown'
        } |
        Sort-Object InterfaceMetric
    if ($addrs) { return $addrs[0].IPAddress }
    return 'localhost'
}

Write-Step "AbleView Windows service install"
Write-Step "Install directory: $InstallDir"

$InstallDir = $InstallDir.TrimEnd('\')
if (Test-Path $InstallDir) {
    $InstallDir = (Resolve-Path $InstallDir).Path
}
if (-not (Test-Path $InstallDir)) { Fail "Install directory not found: $InstallDir" }

# NSSM
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
    Fail "nssm not found on PATH. Download from https://nssm.cc/download and add nssm.exe to PATH."
}

# Node
if (-not $NodePath) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) { Fail "node not found on PATH. Install Node.js >= 20 from https://nodejs.org/" }
    $NodePath = $nodeCmd.Source
}
if (-not (Test-Path $NodePath)) { Fail "Node path not found: $NodePath" }

$nodeVersion = & $NodePath -v
if ($nodeVersion -notmatch '^v(\d+)') { Fail "Could not parse node version: $nodeVersion" }
if ([int]$Matches[1] -lt 20) { Fail "Node.js >= 20 required (found $nodeVersion)" }

Write-Step "Node: $NodePath ($nodeVersion)"

# Preflight files
$envFile = Join-Path $InstallDir '.env'
$configFile = Join-Path $InstallDir 'config\config.json'
if (-not (Test-Path $envFile)) { Fail "Missing .env — copy .env.example to .env and configure." }
if (-not (Test-Path $configFile)) { Fail "Missing config\config.json — copy from config\config.example.json." }

$config = Get-Content $configFile -Raw | ConvertFrom-Json
if ($config.sim.enabled -eq $true) {
    Fail "sim.enabled is true in config.json — set to false for show production."
}

$keyPath = Get-DotEnvValue -Path $envFile -Key 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH'
$sheetId = Get-DotEnvValue -Path $envFile -Key 'SHEET_ID'
$httpPort = Get-DotEnvValue -Path $envFile -Key 'HTTP_PORT'
if (-not $httpPort) { $httpPort = '8080' }

if (-not $sheetId) { Fail "SHEET_ID is not set in .env" }
if (-not $keyPath) { Fail "GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set in .env" }

$keyFull = Resolve-InstallPath -Base $InstallDir -Relative $keyPath
if (-not (Test-Path $keyFull)) { Fail "Service account key not found: $keyFull" }

Write-Step "Preflight OK (.env, config.json, secrets path)"

# npm install
Push-Location $InstallDir
try {
    Write-Step "Running npm install --omit=dev"
    & npm install --omit=dev
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }

    $logsDir = Join-Path $InstallDir 'logs'
    if (-not (Test-Path $logsDir)) {
        New-Item -ItemType Directory -Path $logsDir | Out-Null
    }

    $wrapper = Join-Path $InstallDir 'deploy\run-production.mjs'
    if (-not (Test-Path $wrapper)) { Fail "Missing deploy\run-production.mjs" }

    if (-not $SkipSmokeTest) {
        Write-Step "Smoke test: starting AbleView briefly and checking /health"
        $job = Start-Job -ScriptBlock {
            param($Node, $Wrapper, $Dir)
            Set-Location $Dir
            & $Node $Wrapper 2>&1
        } -ArgumentList $NodePath, $wrapper, $InstallDir

        $healthy = $false
        $deadline = (Get-Date).AddSeconds(45)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
            try {
                $health = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/health" -TimeoutSec 3
                if ($health.status) {
                    $healthy = $true
                    Write-Host "Smoke test: /health returned status=$($health.status)" -ForegroundColor Green
                    break
                }
            } catch {
                # server still starting
            }
            if ($job.State -eq 'Failed') {
                Receive-Job $job
                Fail "Smoke test: process exited before /health responded"
            }
        }

        Stop-Job $job -ErrorAction SilentlyContinue
        Remove-Job $job -Force -ErrorAction SilentlyContinue
        Get-Process -Name node -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $NodePath } |
            Stop-Process -Force -ErrorAction SilentlyContinue

        if (-not $healthy) {
            Fail "Smoke test timed out — fix errors with 'npm run start:production' before installing service"
        }
    }

    Write-Step "Registering NSSM service: $ServiceName"
    $existing = & nssm status $ServiceName 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Service $ServiceName already exists — stopping and reconfiguring" -ForegroundColor Yellow
        & nssm stop $ServiceName 2>$null | Out-Null
    } else {
        & nssm install $ServiceName $NodePath 'deploy\run-production.mjs'
        if ($LASTEXITCODE -ne 0) { Fail "nssm install failed (run elevated?)" }
    }

    & nssm set $ServiceName Application $NodePath
    & nssm set $ServiceName AppParameters 'deploy\run-production.mjs'
    & nssm set $ServiceName AppDirectory $InstallDir
    & nssm set $ServiceName AppEnvironmentExtra NODE_ENV=production
    & nssm set $ServiceName AppStdout (Join-Path $logsDir 'stdout.log')
    & nssm set $ServiceName AppStderr (Join-Path $logsDir 'stderr.log')
    & nssm set $ServiceName AppRotateFiles 1
    & nssm set $ServiceName AppRotateOnline 1
    & nssm set $ServiceName AppRotateBytes 10485760
    & nssm set $ServiceName AppExit Default Restart
    & nssm set $ServiceName AppRestartDelay 3000
    & nssm set $ServiceName Start SERVICE_AUTO_START
    & nssm set $ServiceName DisplayName 'AbleView'
    & nssm set $ServiceName Description 'Live show now-playing board (read-only Ableton OSC)'

    Write-Step "Starting service"
    & nssm start $ServiceName
    if ($LASTEXITCODE -ne 0) { Fail "nssm start failed" }

    Start-Sleep -Seconds 3
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$httpPort/health" -TimeoutSec 5
        Write-Host "Service health: status=$($health.status)" -ForegroundColor Green
    } catch {
        Write-Host "Service started but /health not yet reachable — check logs in $logsDir" -ForegroundColor Yellow
    }

    $ip = Get-LanIp
    Write-Host ""
    Write-Host "AbleView service installed successfully." -ForegroundColor Green
    Write-Host "Reboot this machine to verify auto-start."
    Write-Host ""
    Write-Host "Operator URLs (fill in RUNBOOK.md):"
    Write-Host "  Band:     http://${ip}:${httpPort}/views/band"
    Write-Host "  Visuals:  http://${ip}:${httpPort}/views/visuals"
    Write-Host "  Lighting: http://${ip}:${httpPort}/views/lighting"
    Write-Host "  Admin:    http://${ip}:${httpPort}/views/admin"
    Write-Host "  Health:   http://${ip}:${httpPort}/health"
    Write-Host ""
    Write-Host "Logs: $logsDir\stdout.log"
    Write-Host "Runbook: $InstallDir\deploy\RUNBOOK.md"
    Write-Host "Uninstall: .\deploy\uninstall-windows.ps1 -InstallDir $InstallDir"
}
finally {
    Pop-Location
}
