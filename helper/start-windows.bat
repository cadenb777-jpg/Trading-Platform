@echo off
rem Double-click this file to start the Schwab helper on Windows.
cd /d "%~dp0"
title Trading Platform helper
rem Use the "py" launcher if it works, otherwise "python".
set "PY=python"
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
%PY% -c "import sys" >nul 2>nul || goto nopython

rem splash.py shows the start screen, installs anything missing behind a loading bar, then runs the helper.
%PY% splash.py run %*
if errorlevel 2 exit /b
if errorlevel 1 pause
exit /b

:nopython
echo.
echo Python was not found. Install it from https://www.python.org/downloads/
echo During install, tick the box "Add python.exe to PATH". Then try again.
pause
exit /b 1
