@echo off
rem Trading Terminal in PRIVATE MODE: the whole platform from this copy of the code, on this computer only.
rem Use it while the GitHub repository is private. It gets the latest changes (git pull, your saved GitHub sign-in), builds the
rem website here (Node.js) and opens the Terminal app on it. See PRIVATE-MODE.md.
cd /d "%~dp0desktop"
title Trading Terminal (private)
set "PY=python"
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
%PY% -c "import sys" >nul 2>nul || if exist "%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" -3"
%PY% -c "import sys" >nul 2>nul || goto nopython
%PY% launch.py --private %*
if errorlevel 2 exit /b
if errorlevel 1 pause
exit /b

:nopython
echo.
echo Python was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
pause
exit /b 1
