@echo off
rem Trading Platform desktop app: sets up its own Python environment the first time, then opens the app.
cd /d "%~dp0"
if not exist .venv (
  echo Setting up the desktop app the first time - this takes a few minutes...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\python -m pip install -q -r ..\helper\requirements.txt -r requirements.txt
)
.venv\Scripts\python -m tp_desktop
