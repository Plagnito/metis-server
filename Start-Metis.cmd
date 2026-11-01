@echo off
cd /d "%~dp0"
if not exist node_modules\express (
  call npm ci --omit=dev --ignore-scripts
  if errorlevel 1 exit /b 1
)
node --no-warnings src/main.cjs
pause
