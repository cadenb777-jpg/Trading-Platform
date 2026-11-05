#!/bin/bash
# Double-click to open the Trading Platform desktop app: a start screen with a loading bar sets everything up,
# checks for a newer version, then opens the app.
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null; then
  echo "Python was not found: install it from https://www.python.org/downloads/"; read -r -p "Press Enter to close."; exit 1
fi
python3 launch.py
code=$?
if [ "$code" = "1" ]; then read -r -p "Press Enter to close."; fi
