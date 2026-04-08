@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist node_modules (
  echo Installing dependencies...
  call npm ci
  if errorlevel 1 exit /b 1
)

echo Building userscript...
call npm run build
if errorlevel 1 exit /b 1

if not exist "dist\sin-inline.user.js" (
  echo Build output not found: dist\sin-inline.user.js
  exit /b 1
)

if not exist "dist\sin-inline.meta.js" (
  echo Build output not found: dist\sin-inline.meta.js
  exit /b 1
)

echo Copying userscript content to clipboard...
powershell -NoProfile -Command "Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 'dist\\sin-inline.user.js')"
if errorlevel 1 exit /b 1

echo Userscript content copied to clipboard from "dist\sin-inline.user.js"
echo Release bundle ready in "dist\releases"
echo Metadata file ready in "dist\sin-inline.meta.js"
echo Latest manifest ready in "dist\latest.json"
pause
endlocal
