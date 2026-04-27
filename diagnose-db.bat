@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo  [1/4] Process listening on port 5432
echo ============================================================
powershell -NoProfile -Command ^
  "$c = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue;" ^
  "if (-not $c) { 'Nothing listening on 5432.'; exit }" ^
  "$c | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize | Out-String | Write-Host;" ^
  "Get-Process -Id ($c.OwningProcess | Select-Object -Unique) | Select-Object Id,ProcessName,Path | Format-Table -AutoSize | Out-String | Write-Host"

echo.
echo ============================================================
echo  [2/4] Docker containers and postgres volumes
echo ============================================================
docker ps -a
echo.
docker volume ls

echo.
echo ============================================================
echo  [3/4] DATABASE_URL in .env
echo ============================================================
if exist .env (
  findstr /B /C:"DATABASE_URL" .env
) else (
  echo .env not found in %cd%
)

echo.
echo ============================================================
echo  [4/4] Test password inside the container
echo ============================================================
docker exec bidtoolv3-postgres psql -U bidtool -d bidtoolv3 -c "select 1 as ok"

echo.
echo ============================================================
echo  Done. Copy this whole window and paste it back.
echo ============================================================
pause
endlocal
