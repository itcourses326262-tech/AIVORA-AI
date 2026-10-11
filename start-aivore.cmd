@echo off
setlocal enabledelayedexpansion
rem AIVORE: double-click this file to update the site and start it.
rem Closing this window stops the site. Open http://localhost:3000 in the browser.
rem Everything below sits in ONE parenthesised block on purpose: cmd reads a block once, so git
rem pull replacing this very file in the middle of a run cannot break the run.
cd /d "%~dp0"
(
  echo.
  echo === AIVORE: getting the latest version ===
  rem npm may rewrite package-lock.json on this computer; that would make the next git pull refuse.
  git checkout -- package-lock.json >nul 2>&1
  git pull
  if errorlevel 1 (
    echo.
    echo The update failed. Take a screenshot of this window and send it.
    pause
    exit /b 1
  )
  echo.
  echo === Checking the packages ===
  set NEEDCI=0
  if not exist node_modules\@google-cloud\storage\package.json set NEEDCI=1
  if not exist node_modules\@firebase\auth\package.json set NEEDCI=1
  if not exist node_modules\jose\package.json set NEEDCI=1
  if "!NEEDCI!"=="1" (
    echo Some packages are missing: doing a clean install ^(a few minutes; do not click inside this window^).
    call npm.cmd ci
  ) else (
    call npm.cmd install
  )
  if errorlevel 1 (
    echo.
    echo Installing the packages failed. Take a screenshot of this window and send it.
    pause
    exit /b 1
  )
  if not exist node_modules\@google-cloud\storage\package.json (
    echo.
    echo The packages are still incomplete. Take a screenshot of this window and send it.
    pause
    exit /b 1
  )
  echo.
  echo === Starting the site: http://localhost:3000 ===
  call npm.cmd run dev
  pause
  exit /b 0
)
