@echo off
cd /d D:\Git\nhrc-dashboard

echo ================================
echo NHRC Dashboard Auto Push Started
echo ================================

git add queries/HeMAB/household_members
git add js/projects.js

git diff --cached --quiet
if %errorlevel%==0 (
    echo No changes staged. Nothing to commit.
    goto end
)

git commit -m "Update HeMAB HH queries"
git push

:end
echo ================================
echo Done
echo ================================
pause