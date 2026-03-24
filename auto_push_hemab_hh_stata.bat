@echo off
cd /d D:\Git\nhrc-dashboard

echo =========================================> auto_push_log.txt
echo Auto push started at %date% %time% >> auto_push_log.txt
echo =========================================>> auto_push_log.txt

git status >> auto_push_log.txt 2>&1

REM Stage all changes in repo
git add -A >> auto_push_log.txt 2>&1

REM Check whether anything is staged
git diff --cached --quiet
if %errorlevel%==0 (
    echo No changes staged. Nothing to commit. >> auto_push_log.txt
    exit /b 0
)

REM Commit
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set DTS=%%i
git commit -m "Auto update from Stata run %DTS%" >> auto_push_log.txt 2>&1
if errorlevel 1 (
    echo Commit failed. Check auto_push_log.txt >> auto_push_log.txt
    exit /b 1
)

REM Push
git push >> auto_push_log.txt 2>&1
if errorlevel 1 (
    echo Push failed. Check auto_push_log.txt >> auto_push_log.txt
    exit /b 1
)

echo Push completed successfully. >> auto_push_log.txt
exit /b 0