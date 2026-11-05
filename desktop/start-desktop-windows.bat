@echo off
rem Double-click to open the Trading Platform desktop app: a start screen with a loading bar sets everything up,
rem checks for a newer version, then opens the app.
cd /d "%~dp0"
title Trading Platform desktop app
set "PY=python"
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
%PY% -c "import sys" >nul 2>nul || goto nopython
%PY% launch.py
if errorlevel 2 exit /b
if errorlevel 1 pause
exit /b

:nopython
echo.
echo Python was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
pause
exit /b 1
