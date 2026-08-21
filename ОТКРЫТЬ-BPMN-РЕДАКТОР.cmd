@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if /I "%~1"=="--help" goto launcher_help
if /I "%~1"=="-h" goto launcher_help

where node >nul 2>nul
if errorlevel 1 goto node_missing

node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)"
if errorlevel 1 goto node_version_unsupported

pushd "%~dp0tools\bpmn"
node "%~dp0tools\bpmn\verify-studio-dependencies.mjs" --check >nul 2>nul
if not errorlevel 1 goto dependencies_ready

where npm >nul 2>nul
if errorlevel 1 goto npm_missing

set "STUDIO_MESSAGE=%~dp0tools\bpmn\studio-dependencies-installing.ru.txt"
powershell.exe -NoProfile -Command "Get-Content -Raw -Encoding UTF8 -LiteralPath $env:STUDIO_MESSAGE"

call npm ci
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"
if not "%INSTALL_EXIT_CODE%"=="0" goto install_failed

node "%~dp0tools\bpmn\verify-studio-dependencies.mjs" --write-stamp
if errorlevel 1 goto install_invalid

:dependencies_ready
node "%~dp0tools\bpmn\launch-studio-background.mjs" %*
set "STUDIO_EXIT_CODE=%ERRORLEVEL%"
popd
if "%STUDIO_EXIT_CODE%"=="0" goto finished
echo.
pause
goto finished

:install_failed
set "STUDIO_EXIT_CODE=%INSTALL_EXIT_CODE%"
popd
set "STUDIO_MESSAGE=%~dp0tools\bpmn\studio-dependency-install-failed.ru.txt"
powershell.exe -NoProfile -Command "Get-Content -Raw -Encoding UTF8 -LiteralPath $env:STUDIO_MESSAGE"
echo.
pause
goto finished

:install_invalid
set "STUDIO_EXIT_CODE=1"
popd
set "STUDIO_MESSAGE=%~dp0tools\bpmn\studio-dependency-install-invalid.ru.txt"
powershell.exe -NoProfile -Command "Get-Content -Raw -Encoding UTF8 -LiteralPath $env:STUDIO_MESSAGE"
echo.
pause
goto finished

:npm_missing
set "STUDIO_EXIT_CODE=1"
popd
set "STUDIO_MESSAGE=%~dp0tools\bpmn\npm-required.ru.txt"
powershell.exe -NoProfile -Command "Get-Content -Raw -Encoding UTF8 -LiteralPath $env:STUDIO_MESSAGE"
echo.
pause
goto finished

:node_missing
set "NODE_REQUIRED_MESSAGE=%~dp0tools\bpmn\node-required.ru.txt"
powershell.exe -NoProfile -Command "Get-Content -Raw -Encoding UTF8 -LiteralPath $env:NODE_REQUIRED_MESSAGE"
echo.
pause
exit /b 1

:node_version_unsupported
set "NODE_REQUIRED_MESSAGE=%~dp0tools\bpmn\node-version-required.ru.txt"
powershell.exe -NoProfile -Command "Get-Content -Raw -Encoding UTF8 -LiteralPath $env:NODE_REQUIRED_MESSAGE"
echo.
pause
exit /b 1

:launcher_help
set "STUDIO_MESSAGE=%~dp0tools\bpmn\studio-launcher-help.ru.txt"
powershell.exe -NoProfile -Command "Get-Content -Raw -Encoding UTF8 -LiteralPath $env:STUDIO_MESSAGE"
exit /b 0

:finished
exit /b %STUDIO_EXIT_CODE%
