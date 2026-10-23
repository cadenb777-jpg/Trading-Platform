#!/bin/bash
# Double-click this file to start the Schwab helper on a Mac.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python was not found. Install it from https://www.python.org/downloads/ and try again."
  read -r -p "Press Enter to close"
  exit 1
fi
# splash.py shows the start screen, installs anything missing behind a loading bar, then runs the helper.
python3 splash.py run "$@"
if [ $? -eq 1 ]; then
  read -r -p "Press Enter to close"
fi
