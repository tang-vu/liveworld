@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or later, then run this file again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo LiveWorld needs Node.js 24 or later.
  pause
  exit /b 1
)
if not exist "node_modules\@meta-sam\parser\package.json" (
  call npm.cmd ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
node scripts/check-meta-config.mjs
if errorlevel 1 exit /b 1
if "%~1"=="--check" exit /b 0
echo.
echo Open http://127.0.0.1:4173 in your browser.
echo Demo video: http://127.0.0.1:4173/demo/
echo Keep this window open while using LiveWorld. Ctrl+C stops it.
echo.
node server.mjs
if errorlevel 1 pause
