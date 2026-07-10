<#
.SYNOPSIS
    BidTool v3 - one-click local startup for Windows (PowerShell).

.DESCRIPTION
    PowerShell equivalent of run.bat. Right-click > "Run with PowerShell",
    or run it from a terminal:  powershell -ExecutionPolicy Bypass -File run.ps1

    It will:
      1. Pull the latest code from git
      2. Make sure Docker Desktop is running
      3. Refresh dependencies + database migrations (bun run dev:update)
      4. Run in single-user local mode (no sign-in or account setup)
      5. Start the app (bun run dev:run) and open http://localhost:3000

    Close this window (or press Ctrl+C) to stop the dev server.
#>

$ErrorActionPreference = "Stop"

# Always operate from the script's own directory.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ScriptDir

$AppUrl = "http://localhost:3000"

function Write-Section($text) {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host "  $text"
    Write-Host "============================================================"
    Write-Host ""
}

function Pause-Then-Exit($code) {
    Write-Host ""
    Read-Host "Press Enter to close"
    exit $code
}

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Section "BidTool v3 - starting local development environment"

# --- Check required tools are available --------------------------------------
foreach ($tool in @(
    @{ Name = "bun";    Help = "Install Bun from https://bun.sh and try again." },
    @{ Name = "docker"; Help = "Install Docker Desktop and try again." },
    @{ Name = "git";    Help = "Install Git from https://git-scm.com and try again." }
)) {
    if (-not (Test-Command $tool.Name)) {
        Write-Host "[ERROR] `"$($tool.Name)`" was not found on your PATH." -ForegroundColor Red
        Write-Host "        $($tool.Help)"
        Pause-Then-Exit 1
    }
}

# --- 1. Pull the latest code -------------------------------------------------
Write-Host "[1/5] Pulling latest code from git..."
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[WARNING] `"git pull`" did not complete cleanly." -ForegroundColor Yellow
    Write-Host "          This usually means you have local changes or a merge is needed."
    Write-Host "          The app will still start with the code you currently have."
    Write-Host ""
    $answer = Read-Host "Continue starting the app anyway? [Y/N]"
    if ($answer -notmatch '^(y|yes)$') {
        Write-Host "Aborted. Resolve the git issue, then run this file again."
        Pause-Then-Exit 1
    }
}
Write-Host ""

# --- Ensure .env exists ------------------------------------------------------
# The dev workflow reads .env for local database, search and AI settings.
# Create it from the template on first run so a fresh checkout starts cleanly.
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "      Created .env from .env.example. Review database, search and"
        Write-Host "      AI provider settings if you use those integrations."
    } else {
        Write-Host "[WARNING] No .env and no .env.example found. The app may fail to" -ForegroundColor Yellow
        Write-Host "          start until a .env file is provided."
    }
    Write-Host ""
}

# --- 2. Make sure Docker is running ------------------------------------------
Write-Host "[2/5] Checking Docker..."
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "      Docker daemon is not running. Launching Docker Desktop..."
    $dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe | Out-Null
    } else {
        Write-Host "      Could not find Docker Desktop at the default location."
        Write-Host "      Please start it manually."
    }
    Write-Host "      Waiting for Docker to be ready (this can take a minute)..."

    $dockerTries = 0
    do {
        Start-Sleep -Seconds 3
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { break }
        $dockerTries++
        if ($dockerTries -ge 40) {
            Write-Host ""
            Write-Host "[ERROR] Docker did not start within the expected time." -ForegroundColor Red
            Write-Host "        Open Docker Desktop manually, wait until it says `"running`","
            Write-Host "        then run this file again."
            Pause-Then-Exit 1
        }
    } while ($true)
}
Write-Host "      Docker is ready."
Write-Host ""

# --- 3. Refresh deps + DB migrations after the pull --------------------------
Write-Host "[3/5] Refreshing dependencies and database migrations..."
bun run dev:update
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] `"bun run dev:update`" failed. See the messages above." -ForegroundColor Red
    Pause-Then-Exit 1
}
Write-Host ""

# --- 4. Local single-user mode ------------------------------------------------
Write-Host "[4/5] Single-user local mode (no sign-in required)."
Write-Host ""

# --- 5. Open the browser once the server is listening ------------------------
# This runs in a separate window so it can wait while the dev server starts
# in this window.
Write-Host "[5/5] Starting BidTool. The browser will open automatically when ready."
$waitScript = Join-Path $ScriptDir "scripts\wait-and-open.bat"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$waitScript`"", $AppUrl -WindowStyle Minimized | Out-Null
Write-Host ""

# --- Start the dev server (blocks until you close it) ------------------------
Write-Host "      Keep this window open while you use the app."
Write-Host ""
bun run dev:run

Write-Host ""
Write-Host "BidTool dev server has stopped."
Pause-Then-Exit 0
