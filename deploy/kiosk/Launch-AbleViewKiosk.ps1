#Requires -Version 5.1
<#
.SYNOPSIS
  Open an AbleView operator URL in Edge app mode, then fullscreen if needed.

.PARAMETER Url
  Full view URL, including ?kiosk=1.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = 'Stop'

$edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) { throw 'Microsoft Edge not found.' }

$profileDir = Join-Path $env:LOCALAPPDATA 'AbleViewKiosk'
$edgeArgs = @(
    "--user-data-dir=`"$profileDir`""
    '--start-fullscreen'
    '--start-maximized'
    "--app=`"$Url`""
    '--no-first-run'
    '--no-default-browser-check'
    '--disable-features=Translate'
) -join ' '

Start-Process -FilePath $edge -ArgumentList $edgeArgs

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AbleViewKioskWin {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

function Get-AbleViewWindow {
    $script:ableViewWindow = $null
    $callback = [AbleViewKioskWin+EnumProc] {
        param([IntPtr]$hWnd, [IntPtr]$lParam)
        if (-not [AbleViewKioskWin]::IsWindowVisible($hWnd)) { return $true }
        $sb = New-Object System.Text.StringBuilder 256
        [void][AbleViewKioskWin]::GetWindowText($hWnd, $sb, $sb.Capacity)
        $title = $sb.ToString()
        if ($title -like 'AbleView*') {
            $rect = New-Object AbleViewKioskWin+RECT
            [void][AbleViewKioskWin]::GetWindowRect($hWnd, [ref]$rect)
            $script:ableViewWindow = [pscustomobject]@{
                Title  = $title
                Width  = $rect.Right - $rect.Left
                Height = $rect.Bottom - $rect.Top
            }
            return $false
        }
        return $true
    }
    [AbleViewKioskWin]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return $script:ableViewWindow
}

$deadline = (Get-Date).AddSeconds(15)
$window = $null
while ((Get-Date) -lt $deadline) {
    $window = Get-AbleViewWindow
    if ($window) { break }
    Start-Sleep -Milliseconds 250
}
if (-not $window) { exit 0 }

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$covers = ($window.Height -ge ($screen.Height - 8)) -and ($window.Width -ge ($screen.Width - 8))
if ($covers) { exit 0 }

$shell = New-Object -ComObject WScript.Shell
if ($shell.AppActivate($window.Title)) {
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait('{F11}')
}
