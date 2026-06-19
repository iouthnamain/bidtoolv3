@echo off
setlocal enableextensions enabledelayedexpansion

REM ============================================================
REM  BidTool v3 - one-click local startup for Windows
REM  Double-click this file after starting / restarting the PC.
REM  It will:
REM    1. Pull the latest code from git
REM    2. Make sure Docker Desktop is running
REM    3. Refresh dependencies + database migrations (bun run dev:update)
REM    4. Prepare auth (host-tenant backfill) and show how to create
REM       the first admin when authentication is enabled
REM    5. Start the app (bun run dev:run) and open http://localhost:3000
REM  Close this window (or press Ctrl+C) to stop the dev server.
REM ============================================================

title BidTool v3 - run
cd /d "%~dp0"

set "APP_URL=http://localhost:3000"

echo.
echo ============================================================
echo   BidTool v3 - starting local development environment
echo ============================================================
echo.

REM --- Check required tools are available ---------------------
where bun >nul 2>&1
if errorlevel 1 (
    echo [ERROR] "bun" was not found on your PATH.
    echo         Install Bun from https://bun.sh and try again.
    echo.
    pause
    exit /b 1
)

where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] "docker" was not found on your PATH.
    echo         Install Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] "git" was not found on your PATH.
    echo         Install Git from https://git-scm.com and try again.
    echo.
    pause
    exit /b 1
)

REM --- 1. Pull the latest code --------------------------------
echo [1/5] Pulling latest code from git...
git pull --ff-only
if errorlevel 1 (
    echo.
    echo [WARNING] "git pull" did not complete cleanly.
    echo           This usually means you have local changes or a merge is needed.
    echo           The app will still start with the code you currently have.
    echo.
    choice /c YN /n /m "Continue starting the app anyway? [Y/N] "
    if errorlevel 2 (
        echo Aborted. Resolve the git issue, then run this file again.
        echo.
        pause
        exit /b 1
    )
)
echo.

REM --- 2. Make sure Docker is running -------------------------
echo [2/5] Checking Docker...
docker info >nul 2>&1
if not errorlevel 1 goto dockerready

echo       Docker daemon is not running. Launching Docker Desktop...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
echo       Waiting for Docker to be ready ^(this can take a minute^)...
set /a "DOCKER_TRIES=0"

:waitdocker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto dockerready
set /a "DOCKER_TRIES+=1"
if %DOCKER_TRIES% geq 40 (
    echo.
    echo [ERROR] Docker did not start within the expected time.
    echo         Open Docker Desktop manually, wait until it says "running",
    echo         then run this file again.
    echo.
    pause
    exit /b 1
)
goto waitdocker

:dockerready
echo       Docker is ready.
echo.

REM --- 3. Refresh deps + DB migrations after the pull ---------
echo [3/5] Refreshing dependencies and database migrations...
call bun run dev:update
if errorlevel 1 (
    echo.
    echo [ERROR] "bun run dev:update" failed. See the messages above.
    echo.
    pause
    exit /b 1
)
echo.

REM --- 4. Prepare auth (only when AUTH_ENABLED=true) ----------
REM     Reads AUTH_ENABLED + AUTH_BOOTSTRAP_TOKEN from .env, runs the
REM     idempotent host-tenant backfill, and prints how to create the
REM     first admin. Skipped entirely when auth is off, so the default
REM     no-auth experience is unchanged.
echo [4/5] Checking authentication setup...
set "AUTH_ENABLED_VAL="
set "AUTH_TOKEN_VAL="
if exist ".env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
        if /i "%%A"=="AUTH_ENABLED" (
            set "AUTH_ENABLED_VAL=%%~B"
        )
        if /i "%%A"=="AUTH_BOOTSTRAP_TOKEN" (
            set "AUTH_TOKEN_VAL=%%~B"
        )
    )
)
REM Strip surrounding quotes/spaces that may remain from the .env value.
set "AUTH_ENABLED_VAL=%AUTH_ENABLED_VAL:"=%"
set "AUTH_TOKEN_VAL=%AUTH_TOKEN_VAL:"=%"

if /i "%AUTH_ENABLED_VAL%"=="true" (
    echo       Authentication is ENABLED. Ensuring the host tenant exists...
    call bun run auth:backfill
    if errorlevel 1 (
        echo.
        echo [WARNING] "bun run auth:backfill" did not complete cleanly.
        echo           The app will still start; re-run it later with
        echo           "bun run auth:backfill" if customer data looks unscoped.
        echo.
    )
    echo.
    echo       ----------------------------------------------------------
    echo       FIRST ADMIN ACCOUNT
    echo       If no user exists yet, open this page to create the admin:
    echo           %APP_URL%/setup
    if defined AUTH_TOKEN_VAL (
        echo       Setup token ^(from .env AUTH_BOOTSTRAP_TOKEN^):
        echo           %AUTH_TOKEN_VAL%
    ) else (
        echo       [!] AUTH_BOOTSTRAP_TOKEN is not set in .env - /setup is
        echo           DISABLED until you set it. Generate one and add it.
    )
    echo       Once a user exists, /setup turns itself off. Manage further
    echo       users and tenants under Settings after signing in at /login.
    echo       ----------------------------------------------------------
) else (
    echo       Authentication is OFF ^(AUTH_ENABLED is not "true"^). Skipping.
    echo       The app runs as the single-user tool with no login.
)
echo.

REM --- 5. Open the browser once the server is listening -------
REM     This runs in a separate window so it can wait while the
REM     dev server starts in this window.
echo [5/5] Starting BidTool. The browser will open automatically when ready.
start "BidTool open-browser" cmd /c "%~dp0scripts\wait-and-open.bat" "%APP_URL%"
echo.

REM --- Start the dev server (blocks until you close it) -------
echo       Keep this window open while you use the app.
echo.
call bun run dev:run

echo.
echo BidTool dev server has stopped.
pause
endlocal
