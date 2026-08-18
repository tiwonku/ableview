#Requires -Version 5.1
<#
.SYNOPSIS
  Remove AbleView operator kiosk shortcuts and the local kiosk Edge profile.

.DESCRIPTION
  Reverses Install-AbleViewKiosk.ps1 on this mini PC: desktop + Startup shortcuts for
  every station, the copied launcher, and %LOCALAPPDATA%\AbleViewKiosk.
  Does not uninstall Edge, Node, or AbleView on the show box. Does not restore sleep
  timeouts.

.EXAMPLE
  .\Uninstall-AbleViewKiosk.ps1
#>
$ErrorActionPreference = 'Stop'

$names = @(
    'AbleView Band.lnk',
    'AbleView Visuals.lnk',
    'AbleView Lighting.lnk',
    'AbleView Admin.lnk'
)

$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$kioskDir = Join-Path $env:LOCALAPPDATA 'AbleViewKiosk'
$removed = 0

function Remove-IfPresent([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Remove-Item -LiteralPath $Path -Force
    Write-Host "Removed $Path"
    $script:removed += 1
}

foreach ($name in $names) {
    Remove-IfPresent (Join-Path $desktop $name)
    Remove-IfPresent (Join-Path $startup $name)
}

if (Test-Path -LiteralPath $kioskDir) {
    Get-Process -Name msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
    try {
        Remove-Item -LiteralPath $kioskDir -Recurse -Force
        Write-Host "Removed $kioskDir"
        $removed += 1
    } catch {
        Write-Warning "Could not delete $kioskDir (Edge may still have files open). Close Edge and run this again."
        throw
    }
}

if ($removed -eq 0) {
    Write-Host 'Nothing to remove — this PC has no AbleView kiosk shortcuts or profile.'
} else {
    Write-Host 'AbleView kiosk uninstall complete.'
}
