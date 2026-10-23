@echo off
rem Double-click this file to start the Schwab helper on Windows.
cd /d "%~dp0"
rem Use the "py" launcher if it works, otherwise "python".
set "PY=python"
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
set "PIP=.venv\Scripts\python -m pip install --disable-pip-version-check --prefer-binary --timeout 20 --retries 2 --progress-bar on"
title Schwab Helper
%PY% splash.py banner

if not exist .venv\Scripts\python.exe (
  %PY% splash.py step 1 3 Setting up Python for the helper - this can take a minute...
  %PY% -m venv .venv || goto nopython
)

rem Skip installing when the parts list hasn't changed since the last successful install.
fc /b requirements.txt .venv\installed-core.txt >nul 2>nul && goto core_ready
%PY% splash.py step 2 3 Downloading the helper's main parts...
%PIP% -r requirements.txt || goto failed
copy /y requirements.txt .venv\installed-core.txt >nul
:core_ready

fc /b requirements-extra.txt .venv\installed-extra.txt >nul 2>nul && goto extra_ready
%PY% splash.py step 3 3 Downloading the AI and portfolio maths parts - about 100 MB, a few minutes...
%PIP% -r requirements-extra.txt && copy /y requirements-extra.txt .venv\installed-extra.txt >nul || %PY% splash.py warn Some optional parts did not install - the AI or portfolio maths may be unavailable. Charts and prices still work.
:extra_ready

%PY% splash.py ok Ready. Starting the helper...
.venv\Scripts\python schwab_helper.py %*
pause
exit /b

:nopython
echo.
echo Python was not found. Install it from https://www.python.org/downloads/
echo During install, tick the box "Add python.exe to PATH". Then try again.
pause
exit /b 1

:failed
echo.
echo Downloading the helper's parts failed.
echo Check your internet connection. On a work network, the download site (pypi.org) may be blocked:
echo try once on a home network or a phone hotspot. After that first install it won't need to download again.
pause
exit /b 1
