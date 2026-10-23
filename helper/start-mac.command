#!/bin/bash
# Double-click this file to start the Schwab helper on a Mac.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python was not found. Install it from https://www.python.org/downloads/ and try again."
  read -r -p "Press Enter to close"
  exit 1
fi
if [ ! -d .venv ]; then
  echo "Setting up for the first time. This takes a minute..."
  python3 -m venv .venv || { read -r -p "Press Enter to close"; exit 1; }
fi
if ! .venv/bin/python -m pip install -q --disable-pip-version-check -r requirements.txt; then
  echo "Installing the helper's parts failed. Check your internet connection and try again."
  read -r -p "Press Enter to close"
  exit 1
fi
# Optional parts (portfolio maths, AI). If they fail, charts and prices still work.
.venv/bin/python -m pip install -q --disable-pip-version-check -r requirements-extra.txt || echo "Some optional parts didn't install (AI or portfolio maths may be unavailable). Charts and prices still work."
.venv/bin/python schwab_helper.py "$@"
read -r -p "Press Enter to close"
