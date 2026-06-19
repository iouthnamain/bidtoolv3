@echo off
REM ============================================================
REM  Helper for run.bat - waits until the dev server starts
REM  listening, then opens it in the default browser. Not meant
REM  to be run directly.
REM
REM  We probe the TCP port (not an HTTP 200) because Next.js with
REM  Turbopack binds the port immediately but only answers HTTP
REM  after the first route compiles, which can take a minute on a
REM  cold start. Opening as soon as the port is up lets the user
REM  watch the "compiling" page instead of staring at a frozen
REM  console window.
REM ============================================================
setlocal

set "APP_URL=%~1"
if "%APP_URL%"=="" set "APP_URL=http://localhost:3000"

REM Pull the host:port out of the URL so we can do a raw TCP probe.
set "HOSTPORT=%APP_URL%"
set "HOSTPORT=%HOSTPORT:http://=%"
set "HOSTPORT=%HOSTPORT:https://=%"
for /f "tokens=1 delims=/" %%H in ("%HOSTPORT%") do set "HOSTPORT=%%H"
for /f "tokens=1,2 delims=:" %%H in ("%HOSTPORT%") do (
    set "PROBE_HOST=%%H"
    set "PROBE_PORT=%%I"
)
if "%PROBE_HOST%"=="" set "PROBE_HOST=localhost"
if "%PROBE_PORT%"=="" set "PROBE_PORT=3000"

set /a "TRIES=0"
:wait
REM Fast TCP connect test. Succeeds the moment Next.js binds the port.
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('%PROBE_HOST%', %PROBE_PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready

set /a "TRIES+=1"
if %TRIES% geq 90 (
    REM Give up waiting after ~3 minutes; open anyway so the user sees
    REM whatever state the server is in (or an error page).
    goto ready
)
timeout /t 2 /nobreak >nul
goto wait

:ready
REM Small grace delay so the server is ready to accept the first request.
timeout /t 1 /nobreak >nul
start "" "%APP_URL%"
endlocal
