#Requires -Version 5.1
<#
.SYNOPSIS
  Create a desktop + Startup shortcut that opens one AbleView operator view in Edge app mode.

.DESCRIPTION
  Run from a USB stick on an operator mini PC (not the show box). Does not install Node or
  AbleView. Copies Launch-AbleViewKiosk.ps1 into the local AbleViewKiosk profile and points
  desktop + Startup shortcuts at it, so the USB is not needed after setup.

.PARAMETER Station
  Operator view: band, visuals, lighting, or admin.

.PARAMETER ShowBoxHost
  Show box IP or hostname on the operator VLAN.

.PARAMETER HttpPort
  AbleView HTTP port (default 8080).

.EXAMPLE
  .\Install-AbleViewKiosk.ps1 -Station band
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('band', 'visuals', 'lighting', 'admin')]
    [string]$Station,

    [string]$ShowBoxHost = '10.45.2.107',

    [int]$HttpPort = 8080
)

$ErrorActionPreference = 'Stop'

$edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) {
    throw 'Microsoft Edge not found. Install Edge, then run this again.'
}

$map = @{
    band = @{
        Name = 'AbleView Band'
        Path = '/views/band'
        Icon = "$env:SystemRoot\System32\wmploc.dll,16"
    }
    visuals = @{
        Name = 'AbleView Visuals'
        Path = '/views/visuals'
        Icon = "$env:SystemRoot\System32\imageres.dll,18"
    }
    lighting = @{
        Name = 'AbleView Lighting'
        Path = '/views/lighting'
        Icon = "$env:SystemRoot\System32\imageres.dll,96"
    }
    admin = @{
        Name = 'AbleView Admin'
        Path = '/views/admin'
        Icon = "$env:SystemRoot\System32\imageres.dll,109"
    }
}

$info = $map[$Station]
$url = "http://${ShowBoxHost}:${HttpPort}$($info.Path)?kiosk=1"
$kioskDir = Join-Path $env:LOCALAPPDATA 'AbleViewKiosk'
New-Item -ItemType Directory -Force -Path $kioskDir | Out-Null

$launchSrc = Join-Path $PSScriptRoot 'Launch-AbleViewKiosk.ps1'
$launchPs1 = Join-Path $kioskDir 'Launch-AbleViewKiosk.ps1'
Copy-Item -Force $launchSrc $launchPs1

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launchArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launchPs1`" -Url `"$url`""

function Write-Shortcut([string]$Path) {
    $w = New-Object -ComObject WScript.Shell
    $s = $w.CreateShortcut($Path)
    $s.TargetPath = $powershell
    $s.Arguments = $launchArgs
    $s.WorkingDirectory = $kioskDir
    $s.WindowStyle = 7
    $s.Description = $info.Name
    $s.IconLocation = $info.Icon
    $s.Save()
}

$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$deskLnk = Join-Path $desktop ($info.Name + '.lnk')
$startLnk = Join-Path $startup ($info.Name + '.lnk')

Write-Shortcut $deskLnk
Copy-Item -Force $deskLnk $startLnk

try {
    powercfg /change monitor-timeout-ac 0 | Out-Null
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change monitor-timeout-dc 0 | Out-Null
    powercfg /change standby-timeout-dc 0 | Out-Null
} catch {
    Write-Warning "Could not disable sleep. Set Screen and sleep to Never in Windows Settings."
}

Write-Host "Station:  $($info.Name)"
Write-Host "URL:      $url"
Write-Host "Desktop:  $deskLnk"
Write-Host "Startup:  $startLnk"
Write-Host "Opening once to test..."
Start-Process $deskLnk
