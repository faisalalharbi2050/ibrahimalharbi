@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js, then run this file again.
  pause
  exit /b 1
)

echo Starting the local server without npm...
echo If port 4173 is busy, the server will choose the next available port.
echo.
node dev-server.js

echo.
echo Server stopped.
pause
