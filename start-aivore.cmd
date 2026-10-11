@echo off
rem AIVORE: double-click this file to update the site and start it.
rem Closing this window stops the site. Open http://localhost:3000 in the browser.
cd /d "%~dp0"
echo.
echo === AIVORE: getting the latest version ===
rem npm may rewrite package-lock.json on this computer; that would make the next git pull refuse.
git checkout -- package-lock.json >/dev/null 2>&1
git pull
if errorlevel 1 goto pullfailed
echo.
echo === Installing packages (a minute the first time) ===
call npm.cmd install
if errorlevel 1 goto installfailed
echo.
echo === Starting the site: http://localhost:3000 ===
call npm.cmd run dev
goto end
:pullfailed
echo.
echo The update failed. Take a screenshot of this window and send it.
goto end
:installfailed
echo.
echo Installing the packages failed. Take a screenshot of this window and send it.
:end
pause
