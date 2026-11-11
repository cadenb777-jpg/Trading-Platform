"""
How the launcher (standard library, doing the start-up work) tells the app's start screen how far it is: a small JSON
file the launcher rewrites and the start screen reads many times a second.

  {"pct": 0-100, "label": "...", "state": "working" | "ready" | "restart" | "failed",
   "message": "...", "details": [...], "hints": [...]}

ready: the work is done, the start screen turns into the Terminal-or-Web choice. restart: the update changed the
app's own code, so this copy closes and the launcher opens the new one. failed: the start screen shows what went
wrong. Standard library only.
"""
import json
import os
from pathlib import Path

STATES = ('working', 'ready', 'restart', 'failed')
#: Exit code of an app that closed so the launcher can open the updated copy.
RESTART_APP = 76


def write(path, **fields):
    """Replaces the file in one step (the reader never sees half of it)."""
    path = Path(path)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(fields), encoding='utf-8')
    os.replace(tmp, path)


def read(path):
    """The latest progress, or a neutral one while the file isn't there (or is being replaced)."""
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'pct': 0, 'label': 'Starting...', 'state': 'working'}
    if not isinstance(data, dict) or data.get('state') not in STATES:
        return {'pct': 0, 'label': 'Starting...', 'state': 'working'}
    try:
        data['pct'] = max(0.0, min(100.0, float(data.get('pct', 0))))
    except (TypeError, ValueError):
        data['pct'] = 0.0
    data['label'] = str(data.get('label') or '')
    return data
