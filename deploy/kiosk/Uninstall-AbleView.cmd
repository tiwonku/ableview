@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-AbleViewKiosk.ps1"
if errorlevel 1 pause
pause
