@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer from https://nodejs.org first.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:3000 in your browser.
echo Keep this window open while using Countersign.
node server.mjs
pause
