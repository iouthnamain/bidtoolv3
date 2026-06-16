@echo off
REM ============================================================
REM  Helper for run.bat - waits until the dev server responds,
REM  then opens it in the default browser. Not meant to be run
REM  directly.
REM ============================================================
setlocal

set "APP_URL=%~1"
if "%APP_URL%"=="" set "APP_URL=http://localhost:3000"

set /a "TRIES=0"
:wait
REM Probe the server. -UseBasicParsing keeps it working on older PowerShell.
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%' -TimeoutSec 3) ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready

set /a "TRIES+=1"
if %TRIES% geq 60 (
    REM Give up waiting after ~3 minutes; open anyway so the user sees the page/error.
    goto ready
)
timeout /t 3 /nobreak >nul
goto wait

:ready
start "" "%APP_URL%"
endlocal
