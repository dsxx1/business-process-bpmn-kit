@echo off
setlocal
pushd "%~dp0tools\bpmn"
call npm ci
if errorlevel 1 exit /b %errorlevel%
call npm run verify:all
set "BPMN_VERIFY_EXIT=%errorlevel%"
popd
exit /b %BPMN_VERIFY_EXIT%
