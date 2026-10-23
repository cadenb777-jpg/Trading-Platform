#!/bin/bash
# Double-click this file to start the Schwab helper on a Mac.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python was not found. Install it from https://www.python.org/downloads/ and try again."
  read -r -p "Press Enter to close"
  exit 1
fi
PIP=(.venv/bin/python -m pip install --disable-pip-version-check --prefer-binary --timeout 20 --retries 2 --progress-bar on)
python3 splash.py banner
if [ ! -x .venv/bin/python ]; then
  python3 splash.py step 1 3 "Setting up Python for the helper - this can take a minute..."
  python3 -m venv .venv || { read -r -p "Press Enter to close"; exit 1; }
fi
# Skip installing when the parts list hasn't changed since the last successful install.
if ! cmp -s requirements.txt .venv/installed-core.txt; then
  python3 splash.py step 2 3 "Downloading the helper's main parts..."
  if ! "${PIP[@]}" -r requirements.txt; then
    echo "Downloading the helper's parts failed. Check your internet connection (a work network may block pypi.org) and try again."
    read -r -p "Press Enter to close"
    exit 1
  fi
  cp requirements.txt .venv/installed-core.txt
fi
if ! cmp -s requirements-extra.txt .venv/installed-extra.txt; then
  python3 splash.py step 3 3 "Downloading the AI and portfolio maths parts - about 100 MB, a few minutes..."
  if "${PIP[@]}" -r requirements-extra.txt; then
    cp requirements-extra.txt .venv/installed-extra.txt
  else
    python3 splash.py warn "Some optional parts didn't install - the AI or portfolio maths may be unavailable. Charts and prices still work."
  fi
fi
python3 splash.py ok "Ready. Starting the helper..."
.venv/bin/python schwab_helper.py "$@"
read -r -p "Press Enter to close"
