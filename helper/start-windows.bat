@echo off
rem Double-click this file to start the Schwab helper on Windows.
cd /d "%~dp0"
rem Use the "py" launcher if it works, otherwise "python".
set "PY=python"
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not exist .venv (
  echo Setting up for the first time. This takes a minute...
  %PY% -m venv .venv || goto nopython
)
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements.txt || goto failed
rem Optional parts (portfolio maths, AI). If they fail, charts and prices still work.
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements-extra.txt || echo Some optional parts did not install - the AI or portfolio maths may be unavailable. Charts and prices still work.
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
echo Installing the helper parts failed. Check your internet connection and try again.
pause
exit /b 1
