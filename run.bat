@echo off
setlocal enableextensions

REM ============================================================
REM  BidTool v3 - one-click local startup for Windows
REM  Double-click this file after starting / restarting the PC.
REM  It will:
REM    1. Pull the latest code from git
REM    2. Make sure Docker Desktop is running
REM    3. Refresh dependencies + database migrations (bun run dev:update)
REM    4. Start the app (bun run dev:run) and open http://localhost:3000
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
echo [1/4] Pulling latest code from git...
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
echo [2/4] Checking Docker...
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
echo [3/4] Refreshing dependencies and database migrations...
call bun run dev:update
if errorlevel 1 (
    echo.
    echo [ERROR] "bun run dev:update" failed. See the messages above.
    echo.
    pause
    exit /b 1
)
echo.

REM --- 4. Open the browser once the server is listening -------
REM     This runs in a separate window so it can wait while the
REM     dev server starts in this window.
echo [4/4] Starting BidTool. The browser will open automatically when ready.
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
