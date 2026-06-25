<#
.SYNOPSIS
    BidTool v3 - one-click local startup for Windows (PowerShell).

.DESCRIPTION
    PowerShell equivalent of run.bat. Right-click > "Run with PowerShell",
    or run it from a terminal:  powershell -ExecutionPolicy Bypass -File run.ps1

    It will:
      1. Pull the latest code from git
      2. Make sure Docker Desktop is running
      3. Ensure .env exists, then refresh deps, start Postgres + SearXNG in
         Docker, and apply DB migrations (bun run dev:update)
      4. Prepare auth (host-tenant backfill) and show how to create the
         first admin when authentication is enabled
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
# Several steps below read .env (auth setup) and the dev workflow expects it
# to exist. Create it from the template on first run so a fresh checkout
# starts cleanly.
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "      Created .env from .env.example. Review it and add any"
        Write-Host "      required secrets (e.g. AUTH_BOOTSTRAP_TOKEN) if needed."
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
Write-Host "[3/5] Refreshing dependencies, Docker services (Postgres + SearXNG), and database migrations..."
bun run dev:update
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] `"bun run dev:update`" failed. See the messages above." -ForegroundColor Red
    Pause-Then-Exit 1
}
Write-Host ""

# --- 4. Prepare auth (only when AUTH_ENABLED=true) ---------------------------
# Reads AUTH_ENABLED + AUTH_BOOTSTRAP_TOKEN from .env, runs the idempotent
# host-tenant backfill, and prints how to create the first admin. Skipped
# entirely when auth is off, so the default no-auth experience is unchanged.
Write-Host "[4/5] Checking authentication setup..."

function Get-EnvValue($key) {
    if (-not (Test-Path ".env")) { return $null }
    foreach ($line in Get-Content ".env") {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $idx = $trimmed.IndexOf("=")
        if ($idx -lt 1) { continue }
        $name = $trimmed.Substring(0, $idx).Trim()
        if ($name -ieq $key) {
            $value = $trimmed.Substring($idx + 1).Trim()
            # Strip surrounding single or double quotes.
            if ($value.Length -ge 2 -and
                (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                 ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }
    return $null
}

$authEnabled = Get-EnvValue "AUTH_ENABLED"
$authToken   = Get-EnvValue "AUTH_BOOTSTRAP_TOKEN"

if ($authEnabled -and $authEnabled.ToLower() -eq "true") {
    Write-Host "      Authentication is ENABLED. Ensuring the host tenant exists..."
    bun run auth:backfill
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[WARNING] `"bun run auth:backfill`" did not complete cleanly." -ForegroundColor Yellow
        Write-Host "          The app will still start; re-run it later with"
        Write-Host "          `"bun run auth:backfill`" if customer data looks unscoped."
        Write-Host ""
    }
    Write-Host ""
    Write-Host "      ----------------------------------------------------------"
    Write-Host "      FIRST ADMIN ACCOUNT"
    Write-Host "      If no user exists yet, open this page to create the admin:"
    Write-Host "          $AppUrl/setup"
    if ($authToken) {
        Write-Host "      Setup token (from .env AUTH_BOOTSTRAP_TOKEN):"
        Write-Host "          $authToken"
    } else {
        Write-Host "      [!] AUTH_BOOTSTRAP_TOKEN is not set in .env - /setup is"
        Write-Host "          DISABLED until you set it. Generate one and add it."
    }
    Write-Host "      Once a user exists, /setup turns itself off. Manage further"
    Write-Host "      users and tenants under Settings after signing in at /login."
    Write-Host "      ----------------------------------------------------------"
} else {
    Write-Host "      Authentication is OFF (AUTH_ENABLED is not `"true`"). Skipping."
    Write-Host "      The app runs as the single-user tool with no login."
}
Write-Host ""

# --- 5. Open the browser once the server is listening ------------------------
# Runs as a background job so it can wait for the port while the dev server
# starts in this window. We probe the TCP port (not an HTTP 200) because
# next dev --turbo binds the port immediately but only answers HTTP after the
# first route compiles, which can take a minute on a cold start.
Write-Host "[5/5] Starting BidTool. The browser will open automatically when ready."

$openBrowser = {
    param($url)
    $uri = [System.Uri]$url
    $probeHost = $uri.Host
    $probePort = $uri.Port
    $tries = 0
    while ($tries -lt 90) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $client.Connect($probeHost, $probePort)
            $client.Close()
            break
        } catch {
            $tries++
            Start-Sleep -Seconds 2
        }
    }
    Start-Sleep -Seconds 1
    Start-Process $url
}
Start-Job -ScriptBlock $openBrowser -ArgumentList $AppUrl | Out-Null
Write-Host ""

# --- Start the dev server (blocks until you close it) ------------------------
Write-Host "      Keep this window open while you use the app."
Write-Host ""
bun run dev:run

Write-Host ""
Write-Host "BidTool dev server has stopped."
Pause-Then-Exit 0
