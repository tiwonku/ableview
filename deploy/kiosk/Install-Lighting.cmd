@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AbleViewKiosk.ps1" -Station lighting
if errorlevel 1 pause
pause
