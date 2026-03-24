@echo off
cd /d D:\Git\nhrc-dashboard

set LOGFILE=D:\Git\logs\auto_push_log.txt

if not exist D:\Git\logs mkdir D:\Git\logs

echo =========================================> "%LOGFILE%"
echo Auto push started at %date% %time% >> "%LOGFILE%"
echo =========================================>> "%LOGFILE%"

git status >> "%LOGFILE%" 2>&1

REM Stage all changes in repo
git add -A >> "%LOGFILE%" 2>&1

REM Check whether anything is staged
git diff --cached --quiet
if %errorlevel%==0 (
    echo No changes staged. Nothing to commit. >> "%LOGFILE%"
    exit /b 0
)

REM Commit
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set DTS=%%i
git commit -m "Auto update from Stata run %DTS%" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo Commit failed. Check log. >> "%LOGFILE%"
    exit /b 1
)

REM Push
git push >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo Push failed. Check log. >> "%LOGFILE%"
    exit /b 1
)

echo Push completed successfully. >> "%LOGFILE%"
exit /b 0