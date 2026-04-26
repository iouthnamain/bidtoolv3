param(
  [ValidateSet("Auto", "Update")]
  [string]$Mode = "Auto",
  [string]$Url = "http://localhost:3000/maintenance",
  [int]$MaxWaitSeconds = 180
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$nextModuleDir = Join-Path $rootDir "node_modules\next"

function Test-AppReady {
  param([string]$TargetUrl)

  try {
    $response = Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Start-DevWindow {
  param(
    [string]$WorkingDirectory,
    [string[]]$Commands
  )

  $escapedDirectory = $WorkingDirectory.Replace("'", "''")
  $commandBody = @(
    "Set-Location -LiteralPath '$escapedDirectory'"
    $Commands
  ) -join "; "

  Start-Process -FilePath "powershell.exe" -WorkingDirectory $WorkingDirectory -ArgumentList @(
    "-NoExit",
    "-Command",
    "& { $commandBody }"
  ) | Out-Null
}

if (Test-AppReady -TargetUrl $Url) {
  Start-Process $Url
  Write-Host "Opened $Url"
  exit 0
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error "Bun was not found on PATH. Install Bun from https://bun.sh first."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker was not found on PATH. Install Docker Desktop first."
}

$commands = if ($Mode -eq "Update") {
  @("bun run dev:update", "bun run dev:run")
} elseif (-not (Test-Path $nextModuleDir)) {
  @("bun run dev:one-time")
} else {
  @("bun run dev:run")
}

Start-DevWindow -WorkingDirectory $rootDir -Commands $commands
Write-Host "Starting BidTool in a separate PowerShell window..."

$deadline = (Get-Date).AddSeconds($MaxWaitSeconds)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  if (Test-AppReady -TargetUrl $Url) {
    Start-Process $Url
    Write-Host "Opened $Url"
    exit 0
  }
}

Write-Warning "The app is still starting. Keep the server window open, then open $Url manually."
