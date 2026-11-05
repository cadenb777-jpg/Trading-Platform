#!/bin/bash
# Trading Platform desktop app: sets up its own Python environment the first time, then opens the app.
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Setting up the desktop app the first time - this takes a few minutes..."
  python3 -m venv .venv
  .venv/bin/python -m pip install -q --upgrade pip
  .venv/bin/python -m pip install -q -r ../helper/requirements.txt -r requirements.txt
fi
.venv/bin/python -m tp_desktop
