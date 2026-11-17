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
import time
from pathlib import Path

STATES = ('working', 'ready', 'restart', 'failed')
#: Exit code of an app that closed so the launcher can open the updated copy.
RESTART_APP = 76


def write(path, **fields):
    """Replaces the file in one step (the reader never sees half of it).

    On Windows the swap is refused (Access is denied) while the start screen has the file open for its read, which it
    does many times a second, so a refused swap is tried again a few times and then the file is written in place (a
    reader that catches it half written shows "Starting..." for one tick). A progress line never stops the start-up:
    a 'working' update that still can't be saved is skipped; ready/restart/failed must arrive, so their error is raised.
    """
    path = Path(path)
    text = json.dumps(fields)
    tmp = path.with_suffix(path.suffix + '.tmp')
    try:
        tmp.write_text(text, encoding='utf-8')
        for attempt in range(10):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                time.sleep(0.03 * (attempt + 1))
        path.write_text(text, encoding='utf-8')
        try:
            tmp.unlink()
        except OSError:
            pass
    except OSError:
        if fields.get('state', 'working') != 'working':
            raise


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
