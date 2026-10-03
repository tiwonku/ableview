@echo off
setlocal EnableExtensions
set "EDGE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
)
if not defined EDGE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)
if not defined EDGE (
  echo Microsoft Edge not found.
  exit /b 1
)
set "URL=%~1"
if "%URL%"=="" (
  echo Usage: ableview-kiosk.cmd http://SHOW_BOX_IP:8080/views/band?kiosk=1
  exit /b 1
)
start "" "%EDGE%" --user-data-dir="%LOCALAPPDATA%\AbleViewKiosk" --start-fullscreen --start-maximized --app="%URL%" --no-first-run --no-default-browser-check --disable-features=Translate
