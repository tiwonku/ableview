#Requires -Version 5.1
<#
.SYNOPSIS
  Remove the AbleView Windows service (NSSM).

.PARAMETER ServiceName
  Windows service name (default: AbleView).
#>
param(
    [string]$ServiceName = 'AbleView'
)

$ErrorActionPreference = 'Stop'

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
    Write-Error "nssm not found on PATH."
    exit 1
}

Write-Host "Stopping service: $ServiceName"
& nssm stop $ServiceName 2>$null | Out-Null

Write-Host "Removing service: $ServiceName"
& nssm remove $ServiceName confirm
if ($LASTEXITCODE -ne 0) {
    Write-Error "nssm remove failed (is the service installed? run elevated?)"
    exit 1
}

Write-Host "AbleView service removed." -ForegroundColor Green
Write-Host "Config, .env, and logs were not deleted."
