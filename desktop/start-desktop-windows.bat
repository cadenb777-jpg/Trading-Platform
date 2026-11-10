@echo off
rem Double-click to open Trading Terminal (the desktop app): a start screen with a loading bar sets everything up,
rem checks for a newer version, then opens the app.
cd /d "%~dp0"
title Trading Terminal
set "PY=python"
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
rem Right after the installer adds Python, this window may not see it on PATH yet: look where it was installed.
%PY% -c "import sys" >nul 2>nul || if exist "%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" -3"
%PY% -c "import sys" >nul 2>nul || for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY="%%D\python.exe""
%PY% -c "import sys" >nul 2>nul || goto nopython
%PY% launch.py %*
if errorlevel 2 exit /b
if errorlevel 1 pause
exit /b

:nopython
echo.
echo Python was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
pause
exit /b 1
